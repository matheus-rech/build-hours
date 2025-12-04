import type { AgentConfig } from "@/types/agents"

export const defaultAgentConfig: AgentConfig = {
  model: "gpt-5.1",
  reasoningLevel: "low",
  verbosityLevel: "medium",
  memoryTrimming: false,
  memoryMaxTurns: 9,
  memoryKeepRecentTurns: 4,
  memorySummarization: false,
  memoryInjection: false,
  summarizationKeepRecentTurns: 3,
  summarizationTriggerTurns: 5,
  memoryCompacting: false,
  compactingTriggerTurns: null,
  compactingKeepTurns: 2,
  compactingExcludeTools: [],
  compactingClearToolInputs: false,
  eagerness: false,
  toolPreambles: false,
}

export function createDefaultAgentConfig(): AgentConfig {
  return {
    ...defaultAgentConfig,
  }
}

export function normalizeAgentConfig(config?: Partial<AgentConfig>): AgentConfig {
  if (!config) {
    return createDefaultAgentConfig()
  }

  const merged: AgentConfig = {
    ...defaultAgentConfig,
    ...config,
  }

  const pickConfigValue = <K extends keyof AgentConfig>(key: K): AgentConfig[K] =>
    Object.prototype.hasOwnProperty.call(config, key) ? (config[key] as AgentConfig[K]) : merged[key]

  const sanitizeNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") {
      return null
    }
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  const sanitizePositiveInt = (value: unknown, fallback: number): number => {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed)
    }
    return fallback
  }

  const rawExcludeTools = pickConfigValue("compactingExcludeTools")

  const cleanExcludeTools = Array.isArray(rawExcludeTools)
    ? rawExcludeTools
        .map((tool) => String(tool).trim())
        .filter((tool) => tool.length > 0)
    : typeof rawExcludeTools === "string"
      ? rawExcludeTools
          .split(",")
          .map((tool) => tool.trim())
          .filter((tool) => tool.length > 0)
      : merged.compactingExcludeTools

  const sanitizedMemoryKeep = sanitizePositiveInt(
    pickConfigValue("memoryKeepRecentTurns"),
    defaultAgentConfig.memoryKeepRecentTurns,
  )

  const sanitizedCompactingKeep = sanitizePositiveInt(
    pickConfigValue("compactingKeepTurns"),
    defaultAgentConfig.compactingKeepTurns,
  )

  const sanitizedSummarizationKeep = sanitizePositiveInt(
    pickConfigValue("summarizationKeepRecentTurns"),
    defaultAgentConfig.summarizationKeepRecentTurns,
  )

  const sanitizedSummarizationTriggerCandidate = sanitizePositiveInt(
    pickConfigValue("summarizationTriggerTurns"),
    defaultAgentConfig.summarizationTriggerTurns,
  )

  const normalizedSummarizationTrigger = Math.max(
    sanitizedSummarizationTriggerCandidate,
    sanitizedSummarizationKeep,
  )

  return {
    ...merged,
    compactingTriggerTurns: sanitizeNumber(pickConfigValue("compactingTriggerTurns")),
    memoryKeepRecentTurns: sanitizedMemoryKeep,
    compactingKeepTurns: sanitizedCompactingKeep,
    summarizationKeepRecentTurns: sanitizedSummarizationKeep,
    summarizationTriggerTurns: normalizedSummarizationTrigger,
    compactingExcludeTools: cleanExcludeTools,
    compactingClearToolInputs: Boolean(pickConfigValue("compactingClearToolInputs")),
    memoryInjection: Boolean(pickConfigValue("memoryInjection")),
  }
}

export type PersistedAgentConfigs = {
  agentA: AgentConfig
  agentB: AgentConfig
}


