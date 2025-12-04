import { type NextRequest, NextResponse } from "next/server"

import { configureSummarizationSessions } from "@/lib/python-agent-bridge"

export const runtime = "nodejs"

type ConfigureSummarizationPayload = {
  enable?: boolean
  maxTurns?: number
  keepLast?: number
  agentIds?: string[]
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ConfigureSummarizationPayload | null

    if (!body || typeof body.enable !== "boolean") {
      return NextResponse.json(
        { success: false, error: "`enable` boolean is required" },
        { status: 400 },
      )
    }

    await configureSummarizationSessions({
      enable: body.enable,
      maxTurns: typeof body.maxTurns === "number" ? body.maxTurns : undefined,
      keepLast: typeof body.keepLast === "number" ? body.keepLast : undefined,
      agentIds: Array.isArray(body.agentIds) ? body.agentIds.map(String) : undefined,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to configure summarizing sessions:", error)
    const message = error instanceof Error ? error.message : "Failed to configure summarizing sessions"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}


