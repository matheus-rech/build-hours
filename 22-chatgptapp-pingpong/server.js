import "dotenv/config";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Liveblocks } from "@liveblocks/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const pingpongHtml = readFileSync("public/pingpong.html", "utf8");
let liveblocksClientModule = null;
try {
  liveblocksClientModule = readFileSync("public/liveblocks-client.mjs", "utf8");
} catch (error) {
  console.warn("Liveblocks client bundle missing:", error?.message || error);
}
const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
const liveblocksPublicKey = process.env.LIVEBLOCKS_PUBLIC_KEY;
const liveblocksAuthUrl = appBaseUrl
  ? `${appBaseUrl}/api/liveblocks-auth`
  : null;
const liveblocks =
  process.env.LIVEBLOCKS_SECRET_KEY &&
  new Liveblocks({ secret: process.env.LIVEBLOCKS_SECRET_KEY });

const LIVEBLOCKS_COOKIE_NAME = "pingpong_user_id";
const LIVEBLOCKS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const getRequestOrigin = (req) =>
  typeof req.headers.origin === "string" ? req.headers.origin : null;

const isSecureRequest = (req) => {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto.split(",")[0].trim() === "https";
  }
  return Boolean(req.socket?.encrypted);
};

const parseCookies = (cookieHeader) => {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce((acc, part) => {
    const trimmed = part.trim();
    if (!trimmed) return acc;
    const index = trimmed.indexOf("=");
    if (index === -1) return acc;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    if (!key) return acc;
    try {
      acc[key] = decodeURIComponent(value);
    } catch {
      acc[key] = value;
    }
    return acc;
  }, {});
};

const isValidUserId = (value) =>
  typeof value === "string" && /^[a-z0-9-]{8,64}$/i.test(value);

const buildUserIdCookie = (userId, secure) => {
  const parts = [
    `${LIVEBLOCKS_COOKIE_NAME}=${encodeURIComponent(userId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${LIVEBLOCKS_COOKIE_MAX_AGE}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
};

const applyAuthCorsHeaders = (res, origin) => {
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
};

const widgetCsp = {
  connect_domains: [
    "wss://liveblocks.io",
    "wss://*.liveblocks.io",
    "wss://liveblocks.net",
    "wss://*.liveblocks.net",
    "https://liveblocks.io",
    "https://*.liveblocks.io",
    "https://liveblocks.net",
    "https://*.liveblocks.net",
    "https://unpkg.com",
    "https://cdn.jsdelivr.net",
    appBaseUrl,
  ].filter(Boolean),
  resource_domains: [
    "https://unpkg.com",
    "https://cdn.jsdelivr.net",
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
    appBaseUrl,
  ],
};

const launchGameInputSchema = z.object({
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
});

const reportGameStatsInputSchema = z.object({
  clientId: z.string().min(1),
  timestamp: z.number().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  mode: z.enum(["solo", "multiplayer"]).optional(),
  role: z.enum(["solo", "host", "guest"]).optional(),
  scores: z
    .object({
      left: z.number().optional(),
      right: z.number().optional(),
      playerSide: z.enum(["left", "right"]).optional(),
    })
    .optional(),
  stats: z
    .object({
      rallies: z.number().optional(),
      totalRallyHits: z.number().optional(),
      longestRally: z.number().optional(),
      averageRally: z.number().optional(),
      playerHits: z.number().optional(),
      opponentHits: z.number().optional(),
      pointsWon: z.number().optional(),
      pointsLost: z.number().optional(),
      serves: z.number().optional(),
      durationSeconds: z.number().optional(),
      matchOver: z.boolean().optional(),
    })
    .optional(),
});

const analyzeGameInputSchema = z.object({
  clientId: z.string().optional(),
});

const gameStatsByClient = new Map();
const completedStatsByClient = new Map();
let latestGameStats = null;
let latestCompletedStats = null;

const formatPercent = (value) =>
  Number.isFinite(value) ? `${Math.round(value * 100)}%` : "n/a";

const buildGameInsights = (record) => {
  if (!record) return null;
  const stats = record.stats ?? {};
  const pointsWon = stats.pointsWon ?? 0;
  const pointsLost = stats.pointsLost ?? 0;
  const totalPoints = pointsWon + pointsLost;
  const winRate = totalPoints ? pointsWon / totalPoints : null;
  const playerHits = stats.playerHits ?? 0;
  const opponentHits = stats.opponentHits ?? 0;
  const totalHits = playerHits + opponentHits;
  const playerHitShare = totalHits ? playerHits / totalHits : null;
  const rallies = stats.rallies ?? 0;
  const totalRallyHits = stats.totalRallyHits ?? 0;
  const averageRally =
    stats.averageRally ??
    (rallies ? totalRallyHits / rallies : null);
  const longestRally = stats.longestRally ?? null;

  const tips = [];
  if (totalPoints < 3) {
    tips.push("Play a few more points for a deeper read.");
  } else {
    if (winRate !== null && winRate < 0.45) {
      tips.push("Prioritize defense on the first return to stay in rallies.");
    }
    if (averageRally !== null && averageRally < 3.5) {
      tips.push("Try softer returns to extend rallies and control pace.");
    }
    if (playerHitShare !== null && playerHitShare < 0.45) {
      tips.push("Track the ball earlier and set paddle position sooner.");
    }
    if (longestRally !== null && longestRally < 6) {
      tips.push("Mix angles to keep the opponent moving.");
    }
  }
  if (!tips.length) {
    tips.push("You are steady—mix pace and placement to force errors.");
  }

  const summaryParts = [];
  if (totalPoints) {
    summaryParts.push(`Points: ${pointsWon}-${pointsLost}`);
  }
  if (averageRally !== null) {
    summaryParts.push(`Avg rally: ${averageRally.toFixed(1)} hits`);
  }
  if (longestRally) {
    summaryParts.push(`Longest rally: ${longestRally} hits`);
  }
  summaryParts.push(`Win rate: ${formatPercent(winRate)}`);

  return {
    summary: summaryParts.join(" · "),
    tips,
    metrics: {
      winRate,
      playerHitShare,
      averageRally,
      longestRally,
    },
  };
};

const flipPerspective = (record) => {
  if (!record) return null;
  const stats = record.stats ?? {};
  const playerSide = record.scores?.playerSide;
  const flippedSide =
    playerSide === "left" ? "right" : playerSide === "right" ? "left" : null;
  return {
    ...record,
    scores: playerSide
      ? {
          ...(record.scores ?? {}),
          playerSide: flippedSide,
        }
      : record.scores,
    stats: {
      ...stats,
      playerHits: stats.opponentHits,
      opponentHits: stats.playerHits,
      pointsWon: stats.pointsLost,
      pointsLost: stats.pointsWon,
    },
  };
};

function createPingPongServer() {
  const server = new McpServer({ name: "pingpong-app", version: "0.1.0" });

  server.registerResource(
    "pingpong-widget",
    "ui://widget/pingpong.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://widget/pingpong.html",
          mimeType: "text/html+skybridge",
          text: pingpongHtml,
          _meta: {
            "openai/widgetPrefersBorder": false,
            "openai/widgetCSP": widgetCsp,
          },
        },
      ],
    })
  );

  server.registerTool(
    "launch_game",
    {
      title: "Launch Ping Pong",
      description:
        "Open the Ping Pong widget (solo or multiplayer) and optionally set CPU difficulty.",
      inputSchema: launchGameInputSchema,
      _meta: {
        "openai/outputTemplate": "ui://widget/pingpong.html",
        "openai/toolInvocation/invoking": "Launching Ping Pong",
        "openai/toolInvocation/invoked": "Ping Pong ready",
      },
    },
    async (args) => {
      const difficulty = args?.difficulty ?? "medium";
      const toolMeta = {};
      if (liveblocksPublicKey && liveblocks) {
        toolMeta.liveblocksPublicKey = liveblocksPublicKey;
      }
      if (liveblocksAuthUrl && liveblocks) {
        toolMeta.liveblocksAuthUrl = liveblocksAuthUrl;
      }
      if (appBaseUrl && liveblocks && liveblocksClientModule) {
        toolMeta.liveblocksClientUrl = `${appBaseUrl}${LIVEBLOCKS_CLIENT_PATH}`;
      }
      console.info("launch_game meta", {
        hasPublicKey: Boolean(liveblocksPublicKey),
        hasSecret: Boolean(liveblocks),
        hasAuthUrl: Boolean(liveblocksAuthUrl),
        hasClientBundle: Boolean(liveblocksClientModule),
        appBaseUrl: appBaseUrl ?? "missing",
      });
      return {
        content: [
          {
            type: "text",
            text: `Ping Pong ready. Difficulty: ${difficulty}.`,
          },
        ],
        structuredContent: { difficulty },
        _meta: toolMeta,
      };
    }
  );

  server.registerTool(
    "report_game_stats",
    {
      title: "Report Ping Pong stats",
      description:
        "Internal widget hook: report current match stats for later analysis.",
      inputSchema: reportGameStatsInputSchema,
      _meta: {
        "openai/outputTemplate": "ui://widget/pingpong.html",
        "openai/widgetAccessible": true,
        "openai/visibility": "private",
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async (payload) => {
      const record = {
        ...payload,
        receivedAt: new Date().toISOString(),
      };
      if (payload?.clientId) {
        gameStatsByClient.set(payload.clientId, record);
        if (payload?.stats?.matchOver) {
          completedStatsByClient.set(payload.clientId, record);
        }
      }
      latestGameStats = record;
      if (payload?.stats?.matchOver) {
        latestCompletedStats = record;
      }
      return {
        content: [],
        structuredContent: { ok: true },
      };
    }
  );

  server.registerTool(
    "analyze_game",
    {
      title: "Analyze Ping Pong performance",
      description:
        "Summarize recent stats and return coaching insights for the player.",
      inputSchema: analyzeGameInputSchema,
      _meta: {
        "openai/outputTemplate": "ui://widget/pingpong.html",
        "openai/toolInvocation/invoking": "Reviewing match stats",
        "openai/toolInvocation/invoked": "Analysis ready",
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async ({ clientId } = {}) => {
      const record =
        (clientId && completedStatsByClient.get(clientId)) ||
        (clientId && gameStatsByClient.get(clientId)) ||
        latestCompletedStats ||
        latestGameStats;
      if (!record) {
        return {
          content: [
            {
              type: "text",
              text: "No recent game stats yet. Play a few points, then ask again.",
            },
          ],
          structuredContent: { analysis: null, available: false },
        };
      }
      const playerSide = record?.scores?.playerSide ?? null;
      const otherSide =
        playerSide === "left" ? "right" : playerSide === "right" ? "left" : null;
      const insights = buildGameInsights(record);
      const flippedRecord = flipPerspective(record);
      const flippedInsights = buildGameInsights(flippedRecord);
      const summaries = [];
      if (playerSide && insights?.summary) {
        summaries.push(`${playerSide} player: ${insights.summary}`);
      }
      if (otherSide && flippedInsights?.summary) {
        summaries.push(`${otherSide} player: ${flippedInsights.summary}`);
      }
      return {
        content: [
          {
            type: "text",
            text: summaries.length
              ? `Game analysis — ${summaries.join(" | ")}`
              : `Game analysis: ${insights.summary}`,
          },
        ],
        structuredContent: {
          analysisBySide:
            playerSide && otherSide
              ? {
                  [playerSide]: insights,
                  [otherSide]: flippedInsights,
                }
              : undefined,
          statsBySide:
            playerSide && otherSide
              ? {
                  [playerSide]: record,
                  [otherSide]: flippedRecord,
                }
              : undefined,
        },
        _meta: {
          receivedAt: record.receivedAt,
        },
      };
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
const LIVEBLOCKS_AUTH_PATH = "/api/liveblocks-auth";
const LIVEBLOCKS_CLIENT_PATH = "/liveblocks-client.mjs";

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "OPTIONS" && url.pathname === LIVEBLOCKS_AUTH_PATH) {
    const origin = getRequestOrigin(req);
    applyAuthCorsHeaders(res, origin);
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" }).end(
      "Ping Pong MCP server"
    );
    return;
  }

  if (req.method === "GET" && url.pathname === LIVEBLOCKS_CLIENT_PATH) {
    console.info(`Serving ${LIVEBLOCKS_CLIENT_PATH}`);
    if (!liveblocksClientModule) {
      res
        .writeHead(500, { "content-type": "text/plain" })
        .end("Liveblocks client bundle missing");
      return;
    }
    res
      .writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      })
      .end(liveblocksClientModule);
    return;
  }

  if (req.method === "POST" && url.pathname === LIVEBLOCKS_AUTH_PATH) {
    const origin = getRequestOrigin(req);
    console.info(`Liveblocks auth request from ${origin ?? "unknown"}`);
    applyAuthCorsHeaders(res, origin);
    if (!liveblocks) {
      res.writeHead(500, { "content-type": "text/plain" }).end(
        "LIVEBLOCKS_SECRET_KEY is not set"
      );
      return;
    }
    const body = await readJsonBody(req);
    const room = typeof body?.room === "string" ? body.room : null;
    if (!room) {
      res.writeHead(400, { "content-type": "text/plain" }).end("Missing room");
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    let userId = cookies[LIVEBLOCKS_COOKIE_NAME];
    if (!isValidUserId(userId)) {
      userId = randomUUID();
      res.setHeader(
        "Set-Cookie",
        buildUserIdCookie(userId, isSecureRequest(req))
      );
    }
    const userInfo = { name: `Player ${userId.slice(0, 4)}` };
    try {
      const session = liveblocks.prepareSession(userId, { userInfo });
      session.allow(room, session.FULL_ACCESS);
      session.allow(room, session.READ_ACCESS);
      const { status, body: authBody } = await session.authorize();
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(authBody);
    } catch (error) {
      console.error("Liveblocks auth error:", error);
      res.writeHead(500, { "content-type": "text/plain" }).end("Auth failed");
    }
    return;
  }

  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createPingPongServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(
    `Ping Pong MCP server listening on http://localhost:${port}${MCP_PATH}`
  );
});
