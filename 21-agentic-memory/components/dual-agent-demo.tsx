"use client"

import { useEffect, useState } from "react"
import type { AgentConfig, AgentSummary, TokenUsageBreakdown } from "@/types/agents"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChatInterface } from "@/components/chat-interface"
import { ConfigurationPanel } from "@/components/configuration-panel"
import { ContextLifecycle } from "@/components/context-lifecycle"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RotateCcw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { ThemeToggle } from "@/components/theme-toggle"
import { createDefaultAgentConfig, normalizeAgentConfig } from "@/lib/default-agent-config"

export type Message = {
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  toolResults?: string[]
  contextTrimmed?: boolean
  contextSummarized?: boolean
  contextCompacted?: boolean
}

export type TurnContextUsage = {
  turn: number
  tokenUsage: TokenUsageBreakdown
}

export type AgentState = {
  messages: Message[]
  config: AgentConfig
  tokenUsage: TokenUsageBreakdown
  contextUsageByTurn: TurnContextUsage[]
  summary: AgentSummary | null
}

const EMPTY_TOKEN_USAGE: TokenUsageBreakdown = {
  userInput: 0,
  agentOutput: 0,
  tools: 0,
  memory: 0,
  rag: 0,
  basePrompt: 0,
}

const toNumeric = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

const normalizeTokenUsage = (usage?: Partial<TokenUsageBreakdown>): TokenUsageBreakdown => ({
  userInput: toNumeric(usage?.userInput),
  agentOutput: toNumeric(usage?.agentOutput),
  tools: toNumeric(usage?.tools),
  memory: toNumeric(usage?.memory),
  rag: toNumeric(usage?.rag),
  basePrompt: Math.max(0, toNumeric(usage?.basePrompt)),
})

const addTokenUsage = (
  baseline: TokenUsageBreakdown,
  delta: TokenUsageBreakdown,
): TokenUsageBreakdown => ({
  userInput: Math.max(0, baseline.userInput + delta.userInput),
  agentOutput: Math.max(0, baseline.agentOutput + delta.agentOutput),
  tools: Math.max(0, baseline.tools + delta.tools),
  memory: Math.max(0, baseline.memory + delta.memory),
  rag: Math.max(0, baseline.rag + delta.rag),
  basePrompt: Math.max(baseline.basePrompt, delta.basePrompt),
})

const createInitialAgentState = (): AgentState => ({
  messages: [],
  config: createDefaultAgentConfig(),
  tokenUsage: { ...EMPTY_TOKEN_USAGE },
  contextUsageByTurn: [],
  summary: null,
})

export function DualAgentDemo() {
  const [agentA, setAgentA] = useState<AgentState>(() => createInitialAgentState())

  const [agentB, setAgentB] = useState<AgentState>(() => createInitialAgentState())

  const [sharedInput, setSharedInput] = useState("")
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [isLoadingConfig, setIsLoadingConfig] = useState(true)

  useEffect(() => {
    let isMounted = true

    const loadConfigs = async () => {
      try {
        const response = await fetch("/api/agents/config")
        const data = await response.json()

        if (!response.ok || !data.success) {
          throw new Error(data.error ?? "Failed to load agent configurations")
        }

        if (!isMounted) {
          return
        }

        if (data.agentA) {
          setAgentA((prev) => ({ ...prev, config: normalizeAgentConfig(data.agentA) }))
        }

        if (data.agentB) {
          setAgentB((prev) => ({ ...prev, config: normalizeAgentConfig(data.agentB) }))
        }
      } catch (error) {
        console.error("Error loading agent configs:", error)
        if (isMounted) {
          toast({
            title: "Using default configurations",
            description: "Could not load saved configurations. Defaults applied.",
            variant: "destructive",
          })
        }
      } finally {
        if (isMounted) {
          setIsLoadingConfig(false)
        }
      }
    }

    loadConfigs()

    return () => {
      isMounted = false
    }
  }, [toast])

  const handleSaveConfigs = async () => {
    if (isSavingConfig) return

    setIsSavingConfig(true)
    try {
      const response = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentA: agentA.config,
          agentB: agentB.config,
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Failed to save agent configurations")
      }

      toast({
        title: "Configurations saved",
        description: "Agent settings stored successfully.",
      })
    } catch (error) {
      console.error("Error saving agent configs:", error)
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Could not persist configurations.",
        variant: "destructive",
      })
    } finally {
      setIsSavingConfig(false)
    }
  }

  const handleSendMessage = async () => {
    if (!sharedInput.trim() || isLoading) return

    const userMessage: Message = {
      role: "user",
      content: sharedInput,
      timestamp: Date.now(),
    }

    // Add message to both agents
    setAgentA((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
    }))

    setAgentB((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
    }))

    const currentInput = sharedInput
    setSharedInput("")
    setIsLoading(true)

    try {
      const response = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: currentInput,
          agentAConfig: agentA.config,
          agentBConfig: agentB.config,
          agentAHistory: agentA.messages.map((m) => ({ role: m.role, content: m.content })),
          agentBHistory: agentB.messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      })

      const data = await response.json()

      if (data.success) {
        const responseA: Message = {
          role: "assistant",
          content: data.agentA.response,
          timestamp: Date.now(),
          toolResults: data.agentA.toolResults,
          contextTrimmed: Boolean(data.agentA.contextTrimmed),
          contextSummarized: Boolean(data.agentA.contextSummarized),
          contextCompacted: Boolean(data.agentA.contextCompacted),
        }

        const responseB: Message = {
          role: "assistant",
          content: data.agentB.response,
          timestamp: Date.now(),
          toolResults: data.agentB.toolResults,
          contextTrimmed: Boolean(data.agentB.contextTrimmed),
          contextSummarized: Boolean(data.agentB.contextSummarized),
          contextCompacted: Boolean(data.agentB.contextCompacted),
        }

        setAgentA((prev) => {
          const nextTurn = prev.contextUsageByTurn.length + 1
          const turnUsage = normalizeTokenUsage(data.agentA.tokenUsage)

          return {
            ...prev,
            messages: [...prev.messages, responseA],
            tokenUsage: addTokenUsage(prev.tokenUsage, turnUsage),
            contextUsageByTurn: [...prev.contextUsageByTurn, { turn: nextTurn, tokenUsage: turnUsage }],
            summary: data.agentA.summary ?? null,
          }
        })

        setAgentB((prev) => {
          const nextTurn = prev.contextUsageByTurn.length + 1
          const turnUsage = normalizeTokenUsage(data.agentB.tokenUsage)

          return {
            ...prev,
            messages: [...prev.messages, responseB],
            tokenUsage: addTokenUsage(prev.tokenUsage, turnUsage),
            contextUsageByTurn: [...prev.contextUsageByTurn, { turn: nextTurn, tokenUsage: turnUsage }],
            summary: data.agentB.summary ?? null,
          }
        })
      } else {
        toast({
          title: "Error",
          description: "Failed to get response from agents",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error sending message:", error)
      toast({
        title: "Error",
        description: "Failed to communicate with agents",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleReset = async () => {
    try {
      const response = await fetch("/api/agents/reset", {
        method: "POST",
      })

      const data = await response.json()

      if (data.success) {
        setAgentA(createInitialAgentState())

        setAgentB(createInitialAgentState())

        toast({
          title: "Reset Complete",
          description: "Both agents have been reset",
        })
      }
    } catch (error) {
      console.error("Error resetting agents:", error)
      toast({
        title: "Error",
        description: "Failed to reset agents",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">IT Troubleshooting Dual Agent Demo</h1>
            <p className="text-sm text-muted-foreground">
              Compare agents side-by-side with context engineering techniques.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">OpenAI Agents SDK</span>
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset Agents
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        <Tabs defaultValue="chat" className="flex flex-1 flex-col">
          <div className="border-b border-border bg-card px-6">
            <TabsList className="bg-transparent">
            <TabsTrigger value="chat">Chat Interface</TabsTrigger>
            <TabsTrigger value="config">Configuration</TabsTrigger>
            <TabsTrigger value="lifecycle">Context Lifecycle</TabsTrigger>
              <TabsTrigger value="summary">Context Summary</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="chat" className="flex-1 overflow-hidden p-0">
            <ChatInterface
              agentA={agentA}
              agentB={agentB}
              sharedInput={sharedInput}
              onInputChange={setSharedInput}
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
            />
          </TabsContent>

          <TabsContent value="config" className="flex-1 overflow-auto p-6">
            <ConfigurationPanel
              agentA={agentA}
              agentB={agentB}
              onUpdateAgentA={(config) => setAgentA((prev) => ({ ...prev, config }))}
              onUpdateAgentB={(config) => setAgentB((prev) => ({ ...prev, config }))}
              onSave={handleSaveConfigs}
              isSaving={isSavingConfig || isLoadingConfig}
            />
          </TabsContent>

          <TabsContent value="lifecycle" className="flex-1 overflow-auto p-6">
            <ContextLifecycle agentA={agentA} agentB={agentB} />
          </TabsContent>

          <TabsContent value="summary" className="flex-1 overflow-auto p-6">
            <div className="space-y-6 text-base md:text-lg">
              <div>
                <h2 className="text-3xl font-bold text-foreground">Context Summary</h2>
                <p className="text-base text-muted-foreground md:text-lg">
                  Review the latest summarization outputs when memory summarization is enabled for each agent.
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {[{ title: "Agent A", summary: agentA.summary }, { title: "Agent B", summary: agentB.summary }].map(
                  ({ title, summary }) => (
                    <Card key={title} className="bg-card">
                      <CardHeader>
                        <CardTitle className="text-2xl">{title}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {summary ? (
                          <div className="space-y-4">
                            <Card>
                              <CardHeader>
                                <CardTitle className="text-lg">Shadow line</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <p className="whitespace-pre-wrap text-base text-foreground md:text-lg">
                                  {summary.shadow_line}
                                </p>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardHeader>
                                <CardTitle className="text-lg">Summary text</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <p className="whitespace-pre-wrap text-base text-foreground md:text-lg">
                                  {summary.summary_text}
                                </p>
                              </CardContent>
                            </Card>
                          </div>
                        ) : (
                          <p className="text-base text-muted-foreground md:text-lg">Summary is not available.</p>
                        )}
                      </CardContent>
                    </Card>
                  ),
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
