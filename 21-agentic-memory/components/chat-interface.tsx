"use client"

import type React from "react"
import { useEffect, useRef } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { Send, Loader2 } from "lucide-react"
import type { AgentState } from "./dual-agent-demo"
import { cn } from "@/lib/utils"

const markdownComponents: Components = {
  p: ({ node, ...props }) => (
    <p
      {...props}
      className={cn("mb-3 text-base leading-7 text-foreground last:mb-0", props.className)}
    />
  ),
  ul: ({ node, ...props }) => (
    <ul
      {...props}
      className={cn(
        "mb-3 ml-5 list-disc space-y-1 text-base leading-7 text-foreground last:mb-0",
        props.className,
      )}
    />
  ),
  ol: ({ node, ...props }) => (
    <ol
      {...props}
      className={cn(
        "mb-3 ml-5 list-decimal space-y-1 text-base leading-7 text-foreground last:mb-0",
        props.className,
      )}
    />
  ),
  li: ({ node, ...props }) => (
    <li {...props} className={cn("marker:text-muted-foreground", props.className)} />
  ),
  a: ({ node, ...props }) => (
    <a
      {...props}
      className={cn(
        "text-base leading-7 text-primary underline decoration-muted-foreground/50 underline-offset-4 hover:text-primary/80",
        props.className,
      )}
    />
  ),
  code: ({ node, inline, className, children, ...props }: any) => {
    if (inline) {
      return (
        <code
          {...props}
          className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground", className)}
        >
          {children}
        </code>
      )
    }

    return (
      <code
        {...props}
        className={cn("block font-mono text-base text-foreground", className)}
      >
        {children}
      </code>
    )
  },
  pre: ({ node, ...props }) => (
    <pre
      {...props}
      className={cn(
        "mb-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-base leading-7 text-foreground last:mb-0",
        props.className,
      )}
    />
  ),
  strong: ({ node, ...props }) => (
    <strong {...props} className={cn("font-semibold text-foreground", props.className)} />
  ),
  em: ({ node, ...props }) => (
    <em {...props} className={cn("italic text-foreground", props.className)} />
  ),
}

const renderMessageContent = (message: AgentState["messages"][number]) => {
  if (!message.content) {
    return null
  }

  if (message.role === "assistant") {
    return (
      <div className="space-y-3 text-base leading-7 text-foreground">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
          {message.content}
        </ReactMarkdown>
      </div>
    )
  }

  return <p className="text-base whitespace-pre-wrap">{message.content}</p>
}

type ChatInterfaceProps = {
  agentA: AgentState
  agentB: AgentState
  sharedInput: string
  onInputChange: (value: string) => void
  onSendMessage: () => void
  isLoading?: boolean
}

function TokenBar({
  tokenUsage,
  agentName,
  turnCount,
}: {
  tokenUsage: AgentState["tokenUsage"]
  agentName: string
  turnCount: number
}) {
  const total =
    tokenUsage.userInput +
    tokenUsage.agentOutput +
    tokenUsage.tools +
    tokenUsage.memory +
    tokenUsage.basePrompt
  const maxTokens = 8000
  const reserveTokens = maxTokens - total

  const getPercentage = (value: number) => (value / maxTokens) * 100

  return (
    <Card className="mx-4 my-3 border-border/50 bg-card/50 p-4">
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">{agentName} Context Usage</span>
            <span className="font-mono text-base font-medium text-foreground">
              {total} / {maxTokens} tokens
            </span>
          </div>
          <div className="mt-1 flex justify-between text-md text-muted-foreground">
            <span>Turns</span>
            <span className="font-mono">
              {turnCount} {turnCount === 1 ? "turn" : "turns"}
            </span>
          </div>
        </div>

        <div className="flex h-8 overflow-hidden rounded-lg border-2 border-border bg-muted/30">
          {total === 0 ? (
            <div className="flex w-full items-center justify-center">
              <span className="text-sm text-muted-foreground">No context used yet</span>
            </div>
          ) : (
            <>
              {tokenUsage.basePrompt > 0 && (
                <div
                  className="bg-[#800000] transition-all hover:opacity-80"
                  style={{ width: `${getPercentage(tokenUsage.basePrompt)}%` }}
                  title={`System Instructions: ${tokenUsage.basePrompt} tokens`}
                />
              )}
              {tokenUsage.userInput > 0 && (
                <div
                  className="bg-blue-500 transition-all hover:opacity-80"
                  style={{ width: `${getPercentage(tokenUsage.userInput)}%` }}
                  title={`User Input: ${tokenUsage.userInput} tokens`}
                />
              )}
              {tokenUsage.agentOutput > 0 && (
                <div
                  className="bg-green-500 transition-all hover:opacity-80"
                  style={{ width: `${getPercentage(tokenUsage.agentOutput)}%` }}
                  title={`Agent Output: ${tokenUsage.agentOutput} tokens`}
                />
              )}
              {tokenUsage.tools > 0 && (
                <div
                  className="bg-purple-500 transition-all hover:opacity-80"
                  style={{ width: `${getPercentage(tokenUsage.tools)}%` }}
                  title={`Tools: ${tokenUsage.tools} tokens`}
                />
              )}
              {tokenUsage.memory > 0 && (
                <div
                  className="bg-orange-500 transition-all hover:opacity-80"
                  style={{ width: `${getPercentage(tokenUsage.memory)}%` }}
                  title={`Memory: ${tokenUsage.memory} tokens`}
                />
              )}
              {reserveTokens > 0 && (
                <div
                  className="bg-muted transition-all"
                  style={{ width: `${getPercentage(reserveTokens)}%` }}
                  title={`Reserve: ${reserveTokens} tokens`}
                />
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm bg-[#800000]" />
            <span className="text-muted-foreground">System Instructions ({tokenUsage.basePrompt})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm bg-blue-500" />
            <span className="text-muted-foreground">User Input ({tokenUsage.userInput})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm bg-green-500" />
            <span className="text-muted-foreground">Agent Output ({tokenUsage.agentOutput})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm bg-purple-500" />
            <span className="text-muted-foreground">Tools ({tokenUsage.tools})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm bg-orange-500" />
            <span className="text-muted-foreground">Memory ({tokenUsage.memory})</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

export function ChatInterface({
  agentA,
  agentB,
  sharedInput,
  onInputChange,
  onSendMessage,
  isLoading = false,
}: ChatInterfaceProps) {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isLoading) {
      e.preventDefault()
      onSendMessage()
    }
  }

  const agentAEndRef = useRef<HTMLDivElement | null>(null)
  const agentBEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    agentAEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [agentA.messages, isLoading])

  useEffect(() => {
    agentBEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [agentB.messages, isLoading])

  const agentATurnCount = agentA.contextUsageByTurn.length
  const agentBTurnCount = agentB.contextUsageByTurn.length
  const agentAHasMemory =
    agentA.config.memoryTrimming ||
    agentA.config.memorySummarization ||
    agentA.config.memoryCompacting ||
    agentA.config.memoryInjection
  const agentBHasMemory =
    agentB.config.memoryTrimming ||
    agentB.config.memorySummarization ||
    agentB.config.memoryCompacting ||
    agentB.config.memoryInjection

  return (
    <div className="flex h-full flex-col">
      <div className="relative grid flex-1 min-h-0 grid-cols-2 overflow-hidden bg-border">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 z-10 -translate-x-1/2 w-1 bg-border"
        />
        <div className="flex min-h-0 flex-col bg-background">
          <div className="border-b border-border bg-card px-4 py-3 text-center">
            <h2 className="text-lg font-semibold text-primary">
              <span className="inline-flex items-center justify-center gap-2">
                Agent A
                {agentAHasMemory && (
                  <span className="rounded-xl bg-orange-500 px-3 py-1 text-xs font-semibold uppercase text-white">
                    + Memory
                  </span>
                )}
              </span>
            </h2>
            <p className="text-base font-medium text-foreground">
              {agentA.config.model} • {agentA.config.reasoningLevel} reasoning
              {agentA.config.memoryTrimming && <span>{" • trimming"}</span>}
              {agentA.config.memorySummarization && <span>{" • summarization"}</span>}
              {agentA.config.memoryCompacting && <span>{" • compacting"}</span>}
            {agentA.config.memoryInjection && <span>{" • injection"}</span>}
            </p>
          </div>
          <TokenBar tokenUsage={agentA.tokenUsage} agentName="Agent A" turnCount={agentATurnCount} />
          <ScrollArea
            className={cn(
              "relative flex-1 min-h-0 p-4",
              agentAHasMemory && "z-20 rounded-md border-2 border-orange-500",
            )}
          >
            <div className="space-y-4">
              {agentA.messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-base text-muted-foreground">No messages yet. Send a message to start.</p>
                </div>
              ) : (
                agentA.messages.map((message: AgentState["messages"][number], idx: number) => (
                  <div key={idx} className="space-y-2">
                    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                      <Card
                        className={`max-w-[80%] p-3 ${
                          message.role === "user" ? "bg-primary text-primary-foreground" : "bg-card"
                        }`}
                      >
                        {renderMessageContent(message)}
                        {message.toolResults && message.toolResults.length > 0 && (
                          <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                            {message.toolResults.map((result: string, i: number) => (
                              <p key={i} className="font-mono text-sm text-muted-foreground">
                                {result}
                              </p>
                            ))}
                          </div>
                        )}
                      </Card>
                    </div>
                    {message.role === "assistant" && message.contextTrimmed && (
                      <div className="rounded-md border border-purple-500 bg-purple-500/20 py-1 text-center text-sm font-medium text-purple-700">
                        Context Trimmed
                      </div>
                    )}
                    {message.role === "assistant" && message.contextSummarized && (
                      <div className="rounded-md border border-orange-500 bg-orange-500/20 py-1 text-center text-sm font-medium text-orange-700">
                        Context Summarized
                      </div>
                    )}
                    {message.role === "assistant" && message.contextCompacted && (
                      <div className="rounded-md border border-purple-500 bg-purple-500/20 py-1 text-center text-sm font-medium text-purple-700">
                        Context Compacted
                      </div>
                    )}
                  </div>
                ))
              )}
              {isLoading && agentA.messages[agentA.messages.length - 1]?.role === "user" && (
                <div className="flex justify-start">
                  <Card className="bg-card p-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <p className="text-base text-muted-foreground">Agent A is thinking...</p>
                    </div>
                  </Card>
                </div>
              )}
              <div ref={agentAEndRef} />
            </div>
          </ScrollArea>
        </div>

        <div className="flex min-h-0 flex-col bg-background">
          <div className="border-b border-border bg-card px-4 py-3 text-center">
            <h2 className="text-lg font-semibold text-accent">
              <span className="inline-flex items-center justify-center gap-2">
                Agent B
                {agentBHasMemory && (
                  <span className="rounded-xl bg-orange-500 px-3 py-1 text-xs font-semibold uppercase text-white">
                    + Memory
                  </span>
                )}
              </span>
            </h2>
            <p className="text-base font-medium text-foreground">
              {agentB.config.model} • {agentB.config.reasoningLevel} reasoning
              {agentB.config.memoryTrimming && <span>{" • trimming"}</span>}
              {agentB.config.memorySummarization && <span>{" • summarization"}</span>}
              {agentB.config.memoryCompacting && <span>{" • compacting"}</span>}
            {agentB.config.memoryInjection && <span>{" • injection"}</span>}
            </p>
          </div>
          <TokenBar tokenUsage={agentB.tokenUsage} agentName="Agent B" turnCount={agentBTurnCount} />
          <ScrollArea
            className={cn(
              "relative flex-1 min-h-0 p-4",
              agentBHasMemory && "z-20 rounded-md border-2 border-orange-500",
            )}
          >
            <div className="space-y-4">
              {agentB.messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-base text-muted-foreground">No messages yet. Send a message to start.</p>
                </div>
              ) : (
                agentB.messages.map((message: AgentState["messages"][number], idx: number) => (
                  <div key={idx} className="space-y-2">
                    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                      <Card
                        className={`max-w-[80%] p-3 ${
                          message.role === "user" ? "bg-accent text-accent-foreground" : "bg-card"
                        }`}
                      >
                        {renderMessageContent(message)}
                        {message.toolResults && message.toolResults.length > 0 && (
                          <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                            {message.toolResults.map((result: string, i: number) => (
                              <p key={i} className="font-mono text-sm text-muted-foreground">
                                {result}
                              </p>
                            ))}
                          </div>
                        )}
                      </Card>
                    </div>
                    {message.role === "assistant" && message.contextTrimmed && (
                      <div className="rounded-md border border-purple-500 bg-purple-500/20 py-1 text-center text-sm font-medium text-purple-700">
                        Context Trimmed
                      </div>
                    )}
                    {message.role === "assistant" && message.contextSummarized && (
                      <div className="rounded-md border border-orange-500 bg-orange-500/20 py-1 text-center text-sm font-medium text-orange-700">
                        Context Summarized
                      </div>
                    )}
                    {message.role === "assistant" && message.contextCompacted && (
                      <div className="rounded-md border border-purple-500 bg-purple-500/20 py-1 text-center text-sm font-medium text-purple-700">
                        Context Compacted
                      </div>
                    )}
                  </div>
                ))
              )}
              {isLoading && agentB.messages[agentB.messages.length - 1]?.role === "user" && (
                <div className="flex justify-start">
                  <Card className="bg-card p-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
                      <p className="text-base text-muted-foreground">Agent B is thinking...</p>
                    </div>
                  </Card>
                </div>
              )}
              <div ref={agentBEndRef} />
            </div>
          </ScrollArea>
        </div>
      </div>

      <div className="border-t border-border bg-card p-6">
        <div className="mx-auto max-w-4xl">
          <div className="flex gap-3">
            <Input
              value={sharedInput}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Send a message to both agents..."
              className="flex-1 rounded-lg bg-background text-base md:text-lg h-14 px-5 py-4"
              disabled={isLoading}
            />
            <Button
              onClick={onSendMessage}
              size="icon-lg"
              className="h-14 w-14 rounded-lg"
              disabled={isLoading || !sharedInput.trim()}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            This message will be sent to both Agent A and Agent B simultaneously
          </p>
        </div>
      </div>
    </div>
  )
}
