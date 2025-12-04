import { type NextRequest, NextResponse } from "next/server"

import { configureTrimmingSessions } from "@/lib/python-agent-bridge"

export const runtime = "nodejs"

type ConfigureTrimmingPayload = {
  enable?: boolean
  maxTurns?: number
  keepLast?: number
  agentIds?: string[]
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ConfigureTrimmingPayload | null

    if (!body || typeof body.enable !== "boolean") {
      return NextResponse.json(
        { success: false, error: "`enable` boolean is required" },
        { status: 400 },
      )
    }

    await configureTrimmingSessions({
      enable: body.enable,
      maxTurns: typeof body.maxTurns === "number" ? body.maxTurns : undefined,
      keepLast: typeof body.keepLast === "number" ? body.keepLast : undefined,
      agentIds: Array.isArray(body.agentIds) ? body.agentIds.map(String) : undefined,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to configure trimming sessions:", error)
    const message = error instanceof Error ? error.message : "Failed to configure trimming sessions"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}


