"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { TokenUsageBreakdown } from "@/types/agents"
import type { AgentState } from "./dual-agent-demo"

type ContextVisualizationProps = {
  agentA: AgentState
  agentB: AgentState
}

export function ContextVisualization({ agentA, agentB }: ContextVisualizationProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-2xl font-bold">Context Visualization</h2>
        <p className="text-sm text-muted-foreground">Token composition and usage over time for both agents</p>
      </div>

      {/* Agent A Visualization */}
      <Card>
        <CardHeader>
          <CardTitle className="text-primary">Agent A Token Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <TokenBar tokenUsage={agentA.tokenUsage} />
          <TokenLegend />
          <TokenStats tokenUsage={agentA.tokenUsage} />
        </CardContent>
      </Card>

      {/* Agent B Visualization */}
      <Card>
        <CardHeader>
          <CardTitle className="text-accent">Agent B Token Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <TokenBar tokenUsage={agentB.tokenUsage} />
          <TokenLegend />
          <TokenStats tokenUsage={agentB.tokenUsage} />
        </CardContent>
      </Card>
    </div>
  )
}

function TokenBar({ tokenUsage }: { tokenUsage: TokenUsageBreakdown }) {
  const total =
    tokenUsage.userInput +
    tokenUsage.agentOutput +
    tokenUsage.tools +
    tokenUsage.memory +
    tokenUsage.rag +
    tokenUsage.basePrompt

  const maxTokens = 8000 // Example context window
  const reserveTokens = maxTokens - total

  const getPercentage = (value: number) => (value / maxTokens) * 100

  return (
    <div className="mb-4 space-y-2">
      <div className="flex h-12 overflow-hidden rounded-lg border border-border">
        {tokenUsage.basePrompt > 0 && (
          <div
            className="bg-[#800000] transition-all"
            style={{ width: `${getPercentage(tokenUsage.basePrompt)}%` }}
            title={`System Instructions: ${tokenUsage.basePrompt} tokens`}
          />
        )}
        {tokenUsage.userInput > 0 && (
          <div
            className="bg-chart-1 transition-all"
            style={{ width: `${getPercentage(tokenUsage.userInput)}%` }}
            title={`User Input: ${tokenUsage.userInput} tokens`}
          />
        )}
        {tokenUsage.agentOutput > 0 && (
          <div
            className="bg-chart-2 transition-all"
            style={{ width: `${getPercentage(tokenUsage.agentOutput)}%` }}
            title={`Agent Output: ${tokenUsage.agentOutput} tokens`}
          />
        )}
        {tokenUsage.tools > 0 && (
          <div
            className="bg-chart-3 transition-all"
            style={{ width: `${getPercentage(tokenUsage.tools)}%` }}
            title={`Tools: ${tokenUsage.tools} tokens`}
          />
        )}
        {tokenUsage.memory > 0 && (
          <div
            className="bg-chart-4 transition-all"
            style={{ width: `${getPercentage(tokenUsage.memory)}%` }}
            title={`Memory: ${tokenUsage.memory} tokens`}
          />
        )}
        {tokenUsage.rag > 0 && (
          <div
            className="bg-chart-5 transition-all"
            style={{ width: `${getPercentage(tokenUsage.rag)}%` }}
            title={`RAG Data: ${tokenUsage.rag} tokens`}
          />
        )}
        {reserveTokens > 0 && (
          <div
            className="bg-muted transition-all"
            style={{ width: `${getPercentage(reserveTokens)}%` }}
            title={`Reserve: ${reserveTokens} tokens`}
          />
        )}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0 tokens</span>
        <span>{maxTokens} tokens (context window)</span>
      </div>
    </div>
  )
}

function TokenLegend() {
  return (
    <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded bg-[#800000]" />
        <span>System Instructions</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded bg-chart-1" />
        <span>User Input</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded bg-chart-2" />
        <span>Agent Output</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded bg-chart-3" />
        <span>Tools</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded bg-chart-4" />
        <span>Memory</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded bg-chart-5" />
        <span>RAG Data</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded bg-muted" />
        <span>Reserve</span>
      </div>
    </div>
  )
}

function TokenStats({ tokenUsage }: { tokenUsage: TokenUsageBreakdown }) {
  const total =
    tokenUsage.userInput +
    tokenUsage.agentOutput +
    tokenUsage.tools +
    tokenUsage.memory +
    tokenUsage.rag +
    tokenUsage.basePrompt

  return (
    <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 md:grid-cols-3">
      <div>
        <p className="text-xs text-muted-foreground">Total Used</p>
        <p className="text-lg font-semibold">{total}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">System Instructions</p>
        <p className="text-lg font-semibold">{tokenUsage.basePrompt}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">User Input</p>
        <p className="text-lg font-semibold">{tokenUsage.userInput}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Agent Output</p>
        <p className="text-lg font-semibold">{tokenUsage.agentOutput}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Tools</p>
        <p className="text-lg font-semibold">{tokenUsage.tools}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Memory</p>
        <p className="text-lg font-semibold">{tokenUsage.memory}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">RAG Data</p>
        <p className="text-lg font-semibold">{tokenUsage.rag}</p>
      </div>
    </div>
  )
}
