import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { statSync } from "fs"
import path from "path"
import readline from "readline"

import type { AgentConfig, AgentHistoryItem, AgentRunResult, AgentSummary, TokenUsageBreakdown } from "@/types/agents"

type PendingRequest<T> = {
  resolve: (value: T) => void
  reject: (reason?: Error) => void
}

type BridgeResponse = {
  id: number
  status: "ok" | "error"
  result?: unknown
  error?: string
}

type RunCommand = {
  id: number
  type: "run"
  agent_id: string
  message: string
  history: AgentHistoryItem[]
  config: AgentConfig
}

type ResetCommand = {
  id: number
  type: "reset"
}

type ConfigureTrimmingCommand = {
  id: number
  type: "configure_trimming"
  agent_ids: string[]
  enable: boolean
  max_turns?: number
  keep_last?: number
}

type ConfigureSummarizationCommand = {
  id: number
  type: "configure_summarization"
  agent_ids: string[]
  enable: boolean
  max_turns?: number
  keep_last?: number
}

type ConfigureCompactingCommand = {
  id: number
  type: "configure_compacting"
  agent_ids: string[]
  enable: boolean
  trigger?: {
    turns?: number
  }
  keep?: number
  exclude_tools?: string[]
  clear_tool_inputs?: boolean
}

const PYTHON_BIN = process.env.PYTHON_PATH ?? "python3"

class PythonAgentBridge {
  private readonly scriptPath: string
  private readonly requests = new Map<number, PendingRequest<any>>()
  private readonly process: ChildProcessWithoutNullStreams
  private readonly rl: readline.Interface
  private nextId = 1
  private disposed = false

  constructor(scriptPath: string) {
    this.scriptPath = scriptPath
    this.process = spawn(PYTHON_BIN, [this.scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    })

    this.process.on("error", (error) => {
      this.failAll(new Error(`Python agent service failed: ${error.message}`))
    })

    this.process.on("exit", (code, signal) => {
      if (this.disposed) return
      const msg = code !== null ? `exit code ${code}` : `signal ${signal}`
      this.disposed = true
      this.failAll(new Error(`Python agent service stopped (${msg})`))
      bridge = null
    })

    this.rl = readline.createInterface({ input: this.process.stdout })
    this.rl.on("line", (line) => this.handleLine(line))

    this.process.stderr.on("data", (data: Buffer) => {
      const text = data.toString().trim()
      if (text) {
        console.error(`[agents-python] ${text}`)
      }
    })
  }

  runAgent(params: { agentId: string; message: string; history: AgentHistoryItem[]; config: AgentConfig }) {
    return this.sendCommand<AgentRunResult>({
      type: "run",
      agent_id: params.agentId,
      message: params.message,
      history: params.history,
      config: params.config,
    })
  }

  configureTrimmingSessions(params: { agentIds: string[]; enable: boolean; maxTurns?: number; keepLast?: number }) {
    return this.sendCommand<{ ok: boolean }>({
      type: "configure_trimming",
      agent_ids: params.agentIds,
      enable: params.enable,
      max_turns: params.maxTurns,
      keep_last: params.keepLast,
    })
  }

  configureSummarizingSessions(params: {
    agentIds: string[]
    enable: boolean
    maxTurns?: number
    keepLast?: number
  }) {
    return this.sendCommand<{ ok: boolean }>({
      type: "configure_summarization",
      agent_ids: params.agentIds,
      enable: params.enable,
      max_turns: params.maxTurns,
      keep_last: params.keepLast,
    })
  }

  configureCompactingSessions(params: {
    agentIds: string[]
    enable: boolean
    trigger?: {
      turns?: number
    }
    keep?: number
    excludeTools?: string[]
    clearToolInputs?: boolean
  }) {
    return this.sendCommand<{ ok: boolean }>({
      type: "configure_compacting",
      agent_ids: params.agentIds,
      enable: params.enable,
      trigger: params.trigger,
      keep: params.keep,
      exclude_tools: params.excludeTools,
      clear_tool_inputs: params.clearToolInputs,
    })
  }

  reset() {
    return this.sendCommand<{ ok: boolean }>({ type: "reset" })
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.rl.removeAllListeners()
    this.process.removeAllListeners()
    this.failAll(new Error("Python agent service disposed"))
    this.process.kill()
  }

  private sendCommand<T>(
    command:
      | Omit<RunCommand, "id">
      | Omit<ResetCommand, "id">
      | Omit<ConfigureTrimmingCommand, "id">
      | Omit<ConfigureSummarizationCommand, "id">
      | Omit<ConfigureCompactingCommand, "id">,
  ): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error("Python agent service is not available"))
    }

    const id = this.nextId++
    const message = JSON.stringify({ id, ...command })

    return new Promise<T>((resolve, reject) => {
      this.requests.set(id, { resolve, reject })
      this.process.stdin.write(`${message}\n`, (err) => {
        if (err) {
          const error = new Error(`Failed to write to Python agent service: ${err.message}`)
          this.requests.delete(id)
          reject(error)
        }
      })
    })
  }

  private handleLine(line: string) {
    if (!line.trim()) return
    const trimmed = line.trim()

    if (!trimmed.startsWith("{")) {
      console.error(`[agents-python] ${trimmed}`)
      return
    }
    let parsed: BridgeResponse
    try {
      parsed = JSON.parse(trimmed) as BridgeResponse
    } catch (error) {
      console.error("Failed to parse agent service response", trimmed)
      return
    }

    const pending = this.requests.get(parsed.id)
    if (!pending) {
      return
    }

    this.requests.delete(parsed.id)

    if (parsed.status === "ok" && parsed.result !== undefined) {
      pending.resolve(parsed.result as any)
    } else {
      pending.reject(new Error(parsed.error ?? "Unknown error from agent service"))
    }
  }

  private failAll(error: Error) {
    for (const [, pending] of this.requests) {
      pending.reject(error)
    }
    this.requests.clear()
  }
}

let bridge: PythonAgentBridge | null = null
let bridgeScriptTimestamp: number | null = null

function readScriptTimestamp(scriptPath: string): number | null {
  try {
    const stats = statSync(scriptPath)
    return stats.mtimeMs
  } catch (error) {
    console.warn(
      "[agents-python] Warning: unable to read agent service timestamp. Live reload for the Python bridge will be disabled until the file is accessible.",
      error,
    )
    return null
  }
}

function disposeBridge() {
  if (!bridge) return
  try {
    bridge.dispose()
  } catch (error) {
    console.error("[agents-python] Warning: failed to dispose existing Python agent bridge:", error)
  } finally {
    bridge = null
  }
}

function getBridge() {
  const scriptPath = path.join(process.cwd(), "scripts", "agent_service.py")
  const currentTimestamp = readScriptTimestamp(scriptPath)

  if (bridge && currentTimestamp !== null && bridgeScriptTimestamp !== null && currentTimestamp !== bridgeScriptTimestamp) {
    disposeBridge()
  }

  if (!bridge) {
    bridge = new PythonAgentBridge(scriptPath)
    bridgeScriptTimestamp = currentTimestamp
  }

  return bridge
}

export function ensurePythonAgentBridge() {
  return getBridge()
}

export async function runPythonAgent(payload: {
  agentId: string
  message: string
  history: AgentHistoryItem[]
  config: AgentConfig
}): Promise<AgentRunResult> {
  const pythonBridge = getBridge()
  const raw = (await pythonBridge.runAgent(payload)) as Record<string, unknown>

  const responseValue = raw["response"]
  const response = typeof responseValue === "string" ? responseValue : ""
  const toolResultsValue = raw["toolResults"]
  const toolResults = Array.isArray(toolResultsValue)
    ? (toolResultsValue as unknown[]).map(String)
    : []

  const tokenUsageRaw = (raw["tokenUsage"] ?? {}) as Record<string, unknown>

  const tokenUsage: TokenUsageBreakdown = {
    userInput: Number(tokenUsageRaw.userInput ?? 0) || 0,
    agentOutput: Number(tokenUsageRaw.agentOutput ?? 0) || 0,
    tools: Number(tokenUsageRaw.tools ?? 0) || 0,
    memory: Number(tokenUsageRaw.memory ?? 0) || 0,
    rag: Number(tokenUsageRaw.rag ?? 0) || 0,
    basePrompt: Number(tokenUsageRaw.basePrompt ?? 0) || 0,
  }

  let summary: AgentSummary | null = null
  const summaryRaw = raw["summary"]
  if (summaryRaw && typeof summaryRaw === "object") {
    const summaryRecord = summaryRaw as Record<string, unknown>
    const shadowLine = typeof summaryRecord.shadow_line === "string" ? summaryRecord.shadow_line : ""
    const summaryText = typeof summaryRecord.summary_text === "string" ? summaryRecord.summary_text : ""
    if (shadowLine || summaryText) {
      summary = {
        shadow_line: shadowLine,
        summary_text: summaryText,
      }
    }
  }

  const contextTrimmedValue = raw["contextTrimmed"]
  const contextTrimmed = Boolean(contextTrimmedValue)
  const contextSummarizedValue = raw["contextSummarized"]
  const contextSummarized = Boolean(contextSummarizedValue)
  const contextCompactedValue = raw["contextCompacted"]
  const contextCompacted = Boolean(contextCompactedValue)

  return { response, toolResults, tokenUsage, summary, contextTrimmed, contextSummarized, contextCompacted }
}

export async function configureTrimmingSessions(options: {
  enable: boolean
  maxTurns?: number
  keepLast?: number
  agentIds?: string[]
}) {
  const pythonBridge = getBridge()
  const agentIds = options.agentIds ?? ["agentA", "agentB"]
  await pythonBridge.configureTrimmingSessions({
    agentIds,
    enable: options.enable,
    maxTurns: options.maxTurns,
    keepLast: options.keepLast,
  })
}

export async function configureSummarizationSessions(options: {
  enable: boolean
  maxTurns?: number
  keepLast?: number
  agentIds?: string[]
}) {
  const pythonBridge = getBridge()
  const agentIds = options.agentIds ?? ["agentA", "agentB"]
  await pythonBridge.configureSummarizingSessions({
    agentIds,
    enable: options.enable,
    maxTurns: options.maxTurns,
    keepLast: options.keepLast,
  })
}

export async function configureCompactingSessions(options: {
  enable: boolean
  trigger?: {
    turns?: number
  }
  keep?: number
  excludeTools?: string[]
  clearToolInputs?: boolean
  agentIds?: string[]
}) {
  const pythonBridge = getBridge()
  const agentIds = options.agentIds ?? ["agentA", "agentB"]
  await pythonBridge.configureCompactingSessions({
    agentIds,
    enable: options.enable,
    trigger: options.trigger,
    keep: options.keep,
    excludeTools: options.excludeTools,
    clearToolInputs: options.clearToolInputs,
  })
}

export async function resetPythonAgentState(): Promise<void> {
  const pythonBridge = getBridge()
  await pythonBridge.reset()
}

