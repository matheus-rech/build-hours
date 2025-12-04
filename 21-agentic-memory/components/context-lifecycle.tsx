"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { AgentState } from "./dual-agent-demo"

type ContextLifecycleProps = {
  agentA: AgentState
  agentB: AgentState
}

const TOKEN_SERIES = [
  { key: "basePrompt", label: "System Instructions", color: "#800000" },
  { key: "userInput", label: "User Input", color: "rgb(59, 130, 246)" },
  { key: "agentOutput", label: "Agent Output", color: "rgb(34, 197, 94)" },
  { key: "tools", label: "Tools", color: "rgb(168, 85, 247)" },
  { key: "memory", label: "Memory", color: "rgb(249, 115, 22)" },
] as const

type ChartDatum = {
  turn: number
} & Record<(typeof TOKEN_SERIES)[number]["key"], number>

const ZERO_POINT: ChartDatum = {
  turn: 0,
  basePrompt: 0,
  userInput: 0,
  agentOutput: 0,
  tools: 0,
  memory: 0,
}

const buildChartData = (agent: AgentState): ChartDatum[] => {
  const totals = {
    basePrompt: ZERO_POINT.basePrompt,
    userInput: ZERO_POINT.userInput,
    agentOutput: ZERO_POINT.agentOutput,
    tools: ZERO_POINT.tools,
    memory: ZERO_POINT.memory,
  }

  const cumulativePoints = agent.contextUsageByTurn.map(({ turn, tokenUsage }) => {
    totals.basePrompt = Math.max(totals.basePrompt, tokenUsage.basePrompt)
    totals.userInput += tokenUsage.userInput
    totals.agentOutput += tokenUsage.agentOutput
    totals.tools += tokenUsage.tools
    totals.memory += tokenUsage.memory

    totals.basePrompt = Math.max(0, totals.basePrompt)
    totals.userInput = Math.max(0, totals.userInput)
    totals.agentOutput = Math.max(0, totals.agentOutput)
    totals.tools = Math.max(0, totals.tools)
    totals.memory = Math.max(0, totals.memory)

    return {
      turn,
      basePrompt: totals.basePrompt,
      userInput: totals.userInput,
      agentOutput: totals.agentOutput,
      tools: totals.tools,
      memory: totals.memory,
    }
  })

  return [{ ...ZERO_POINT }, ...cumulativePoints]
}

const renderLegendPayload = () =>
  TOKEN_SERIES.map((series) => ({
    value: series.label,
    id: series.key,
    type: "square" as const,
    color: series.color,
  }))

const ContextLifecycleChart = ({ title, agent }: { title: string; agent: AgentState }) => {
  const chartData = buildChartData(agent)
  const memoryModes: string[] = []
  if (agent.config.memoryTrimming) {
    memoryModes.push("Trimming active")
  }
  if (agent.config.memorySummarization) {
    memoryModes.push("Summarization active")
  }
  if (agent.config.memoryCompacting) {
    memoryModes.push("Compacting active")
  }

  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <div className="mt-1 flex flex-wrap gap-2">
          {memoryModes.length === 0 ? (
            <span className="rounded-full border border-border/60 bg-muted/70 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              No automation
            </span>
          ) : (
            memoryModes.map((mode) => (
              <span
                key={mode}
                className="rounded-full border border-border/60 bg-muted/70 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {mode}
              </span>
            ))
          )}
        </div>
      </CardHeader>
      <CardContent>
        {agent.contextUsageByTurn.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No turns recorded yet. Send a message to populate the lifecycle view.
          </div>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ left: 24, right: 24, top: 16, bottom: 16 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="turn"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  label={{ value: "Turn", position: "insideBottomRight", offset: -8, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  label={{ value: "Tokens", angle: -90, position: "insideLeft", offset: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <Tooltip content={<LifecycleTooltip />} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="square"
                  wrapperStyle={{ paddingBottom: 12 }}
                  payload={renderLegendPayload()}
                />
                {TOKEN_SERIES.map((series) => (
                  <Area
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    stackId="tokens"
                    stroke={series.color}
                    strokeWidth={2}
                    fill={series.color}
                    fillOpacity={0.35}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

type TooltipProps = {
  active?: boolean
  label?: number
  payload?: Array<{
    dataKey: string
    value: number
  }>
}

const LifecycleTooltip = ({ active, payload, label }: TooltipProps) => {
  if (!active || !payload || payload.length === 0 || typeof label !== "number") {
    return null
  }

  const total = payload.reduce((sum, entry) => sum + (entry.value ?? 0), 0)

  return (
    <div className="rounded-lg border border-border bg-card/95 p-3 shadow-md">
      <p className="text-sm font-medium text-foreground">Turn {label}</p>
      <p className="text-xs text-muted-foreground">Total: {total} tokens</p>
      <div className="mt-2 space-y-1 text-xs">
        {TOKEN_SERIES.map((series) => {
          const datum = payload.find((entry) => entry.dataKey === series.key)
          if (!datum || datum.value === 0) {
            return null
          }

          return (
            <div key={series.key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-foreground">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: series.color }} />
                {series.label}
              </span>
              <span className="font-mono text-foreground">{datum.value}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ContextLifecycle({ agentA, agentB }: ContextLifecycleProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Context Lifecycle</h2>
        <p className="text-sm text-muted-foreground">
          Track how each turn contributes to the context window across token categories.
        </p>
      </div>

      <ContextLifecycleChart title="Agent A" agent={agentA} />
      <ContextLifecycleChart title="Agent B" agent={agentB} />
    </div>
  )
}

