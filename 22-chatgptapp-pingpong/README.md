# Ping Pong ChatGPT App

A Ping Pong widget for ChatGPT Apps SDK. Move your mouse (or touch/drag) to control your paddle and play solo or with a friend.

This repo is a demo app. Multiplayer mode uses Liveblocks to handle realtime event streaming between clients (for example, paddle movement and game state updates).

## Local setup

```bash
npm install
cp .env.example .env
```

`.env` is gitignored; put secrets (like `LIVEBLOCKS_SECRET_KEY`) there and never commit it.
```bash
LIVEBLOCKS_PUBLIC_KEY=pk_live_...
LIVEBLOCKS_SECRET_KEY=sk_live_...
APP_BASE_URL=https://<random>.trycloudflare.com
```

## Expose localhost over HTTPS (Cloudflare Quick Tunnel)

ChatGPT connectors require HTTPS. For local dev, you can use a Cloudflare Quick Tunnel:

1. Install `cloudflared` (Cloudflare Tunnel client). e.g. `brew install cloudflared` 
2. In a separate terminal, run:

```bash
cloudflared tunnel --url http://localhost:8787
```

3. Copy the `https://<random>.trycloudflare.com` URL it prints.

## Multiplayer (Liveblocks)

For the host-authoritative multiplayer demo, Liveblocks is used for realtime event streaming.

After you start your tunnel and have a public URL, add that to your `.env`:
ewew
```bash
LIVEBLOCKS_PUBLIC_KEY=pk_live_...
LIVEBLOCKS_SECRET_KEY=sk_live_...
APP_BASE_URL=https://<random>.trycloudflare.com
```

Note: if you change `.env` while the server is running, restart `npm run start`.

## Start the server

```bash
npm run start
```

`public/liveblocks-client.mjs` is generated from the `@liveblocks/client` npm package (build step runs automatically on `npm run start`).

The MCP server will run locally at `http://localhost:8787/mcp` and publicly at `https://<random>.trycloudflare.com/mcp` (via your tunnel).

## Add to ChatGPT (Developer mode)

1. Enable developer mode in ChatGPT: **Settings → Apps & Connectors → Advanced settings → Developer mode**.
2. Create a connector: **Settings → Connectors → Create**.
3. Set the connector URL to your public `/mcp` endpoint (for example `https://<random>.trycloudflare.com/mcp`).
4. In a chat where the connector is enabled, ask ChatGPT to call the `launch_game` tool.

The widget will appear and you can play immediately.
