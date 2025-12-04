import { type NextRequest, NextResponse } from "next/server"

import { runPythonAgent } from "@/lib/python-agent-bridge"
import type { AgentConfig, AgentHistoryItem } from "@/types/agents"

export const runtime = "nodejs"

type ChatRequest = {
  message: string
  agentAConfig: AgentConfig
  agentBConfig: AgentConfig
  agentAHistory: AgentHistoryItem[]
  agentBHistory: AgentHistoryItem[]
}

function normalizeHistory(history: AgentHistoryItem[]): AgentHistoryItem[] {
  return history.map((entry) => ({
    role: entry.role,
    content: entry.content,
  }))
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json()
    const { message, agentAConfig, agentBConfig, agentAHistory, agentBHistory } = body

    const historyA = normalizeHistory(agentAHistory)
    const historyB = normalizeHistory(agentBHistory)

    const [agentAResult, agentBResult] = await Promise.all([
      runPythonAgent({ agentId: "agentA", message, history: historyA, config: agentAConfig }),
      runPythonAgent({ agentId: "agentB", message, history: historyB, config: agentBConfig }),
    ])

    return NextResponse.json({
      success: true,
      agentA: {
        response: agentAResult.response,
        toolResults: agentAResult.toolResults,
        tokenUsage: agentAResult.tokenUsage,
        summary: agentAResult.summary,
        contextTrimmed: agentAResult.contextTrimmed,
        contextSummarized: agentAResult.contextSummarized,
        contextCompacted: agentAResult.contextCompacted,
      },
      agentB: {
        response: agentBResult.response,
        toolResults: agentBResult.toolResults,
        tokenUsage: agentBResult.tokenUsage,
        summary: agentBResult.summary,
        contextTrimmed: agentBResult.contextTrimmed,
        contextSummarized: agentBResult.contextSummarized,
        contextCompacted: agentBResult.contextCompacted,
      },
    })
  } catch (error) {
    console.error("Error processing chat:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to process message",
      },
      { status: 500 },
    )
  }
}
