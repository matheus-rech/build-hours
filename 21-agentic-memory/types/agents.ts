export type AgentConfig = {
  model: "gpt-5.1" | "gpt-5" | "gpt-5-mini" | "gpt-5-nano"
  reasoningLevel: "none" | "minimal" | "low" | "medium"
  verbosityLevel: "low" | "medium" | "high"
  memoryTrimming: boolean
  memoryMaxTurns: number
  memoryKeepRecentTurns: number
  memorySummarization: boolean
  memoryInjection: boolean
  summarizationKeepRecentTurns: number
  summarizationTriggerTurns: number
  memoryCompacting: boolean
  compactingTriggerTurns: number | null
  compactingKeepTurns: number
  compactingExcludeTools: string[]
  compactingClearToolInputs: boolean
  eagerness: boolean
  toolPreambles: boolean
}

export type AgentHistoryItem = {
  role: string
  content: string
}

export type TokenUsageBreakdown = {
  userInput: number
  agentOutput: number
  tools: number
  memory: number
  rag: number
  basePrompt: number
}

export type AgentSummary = {
  shadow_line: string
  summary_text: string
}

export type AgentRunResult = {
  response: string
  toolResults: string[]
  tokenUsage: TokenUsageBreakdown
  summary: AgentSummary | null
  contextTrimmed?: boolean
  contextSummarized?: boolean
  contextCompacted?: boolean
}

