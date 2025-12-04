import { type NextRequest, NextResponse } from "next/server"

import { configureCompactingSessions } from "@/lib/python-agent-bridge"

export const runtime = "nodejs"

type TriggerPayload = {
  turns?: number
}

type ConfigureCompactingPayload = {
  enable?: boolean
  trigger?: TriggerPayload
  keep?: number
  excludeTools?: string[]
  clearToolInputs?: boolean
  agentIds?: string[]
}

const sanitizePositive = (value: unknown): number | undefined => {
  if (typeof value !== "number") {
    return undefined
  }
  if (!Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return Math.floor(value)
}

const sanitizeTrigger = (payload: unknown): TriggerPayload | undefined => {
  if (!payload || typeof payload !== "object") {
    return undefined
  }

  const trigger = payload as TriggerPayload
  const turns = sanitizePositive(trigger.turns)

  const result: TriggerPayload = {}
  if (turns !== undefined) {
    result.turns = turns
  }

  return Object.keys(result).length > 0 ? result : undefined
}

const sanitizeExcludeTools = (value: unknown): string[] | undefined => {
  if (!value) {
    return undefined
  }
  if (!Array.isArray(value)) {
    return undefined
  }
  const tools = value
    .map((tool) => (typeof tool === "string" ? tool.trim() : ""))
    .filter((tool) => tool.length > 0)

  return tools.length > 0 ? tools : []
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ConfigureCompactingPayload | null

    if (!body || typeof body.enable !== "boolean") {
      return NextResponse.json({ success: false, error: "`enable` boolean is required" }, { status: 400 })
    }

    const trigger = sanitizeTrigger(body.trigger)
    const keep = sanitizePositive(body.keep)
    const excludeTools = sanitizeExcludeTools(body.excludeTools)
    const clearToolInputs = typeof body.clearToolInputs === "boolean" ? body.clearToolInputs : undefined
    const agentIds = Array.isArray(body.agentIds) ? body.agentIds.map(String) : undefined

    await configureCompactingSessions({
      enable: body.enable,
      trigger,
      keep,
      excludeTools,
      clearToolInputs,
      agentIds,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to configure compacting sessions:", error)
    const message = error instanceof Error ? error.message : "Failed to configure compacting sessions"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}


