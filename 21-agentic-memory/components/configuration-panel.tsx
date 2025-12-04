"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { AgentConfig } from "@/types/agents"
import type { AgentState } from "./dual-agent-demo"

type AgentKey = "agentA" | "agentB"

type ConfigurationPanelProps = {
  agentA: AgentState
  agentB: AgentState
  onUpdateAgentA: (config: AgentConfig) => void
  onUpdateAgentB: (config: AgentConfig) => void
  onSave: () => void
  isSaving: boolean
}

export function ConfigurationPanel({
  agentA,
  agentB,
  onUpdateAgentA,
  onUpdateAgentB,
  onSave,
  isSaving,
}: ConfigurationPanelProps) {
  const DEFAULT_COMPACTING_TRIGGER_TURNS = 4
  const DEFAULT_SUMMARIZATION_KEEP_TURNS = 3
  const DEFAULT_SUMMARIZATION_TRIGGER_TURNS = 5
  const sanitizePositiveInt = (value: unknown): number | undefined => {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed)
    }
    return undefined
  }
  const getAgentConfig = (agentKey: AgentKey) => (agentKey === "agentA" ? agentA.config : agentB.config)

  const updateAgentConfig = (agentKey: AgentKey, nextConfig: AgentConfig) => {
    if (agentKey === "agentA") {
      onUpdateAgentA(nextConfig)
    } else {
      onUpdateAgentB(nextConfig)
    }
  }

  const handleAgentMemoryTrimmingChange = async (agentKey: AgentKey, checked: boolean) => {
    const currentConfig = getAgentConfig(agentKey)
    // Enforce mutual exclusivity: enabling trimming disables summarization and compacting
    const nextConfig = {
      ...currentConfig,
      memoryTrimming: checked,
      memorySummarization: checked ? false : currentConfig.memorySummarization,
      memoryCompacting: checked ? false : currentConfig.memoryCompacting,
    }

    updateAgentConfig(agentKey, nextConfig)

    let maxTurns: number | undefined
    let keepLast: number | undefined
    if (checked && Number.isFinite(nextConfig.memoryMaxTurns)) {
      maxTurns = nextConfig.memoryMaxTurns
    }
    if (checked && Number.isFinite(nextConfig.memoryKeepRecentTurns)) {
      keepLast = nextConfig.memoryKeepRecentTurns
    }

    try {
      const response = await fetch("/api/agents/trimming", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable: checked, maxTurns, keepLast, agentIds: [agentKey] }),
      })
      if (!response.ok) {
        console.error(`Failed to update trimming for ${agentKey}: received status`, response.status)
      }
      // If we enabled trimming, ensure summarization and compacting are disabled at the backend
      if (checked) {
        const resp2 = await fetch("/api/agents/summarization", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enable: false, agentIds: [agentKey] }),
        })
        if (!resp2.ok) {
          console.error(`Failed to disable summarization for ${agentKey}: received status`, resp2.status)
        }
        const resp3 = await fetch("/api/agents/compacting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enable: false, agentIds: [agentKey] }),
        })
        if (!resp3.ok) {
          console.error(`Failed to disable compacting for ${agentKey}: received status`, resp3.status)
        }
      }
    } catch (error) {
      console.error(`Failed to update trimming for ${agentKey}:`, error)
    }
  }

  const handleAgentMemorySummarizationChange = async (agentKey: AgentKey, checked: boolean) => {
    const currentConfig = getAgentConfig(agentKey)

    // Enforce mutual exclusivity: enabling summarization disables trimming and compacting
    const nextConfig: AgentConfig = {
      ...currentConfig,
      memorySummarization: checked,
      memoryTrimming: checked ? false : currentConfig.memoryTrimming,
      memoryCompacting: checked ? false : currentConfig.memoryCompacting,
    }

    let maxTurns: number | undefined
    let keepLast: number | undefined
    if (checked) {
      const sanitizedKeep =
        sanitizePositiveInt(nextConfig.summarizationKeepRecentTurns) ?? DEFAULT_SUMMARIZATION_KEEP_TURNS
      const sanitizedTriggerCandidate =
        sanitizePositiveInt(nextConfig.summarizationTriggerTurns) ?? DEFAULT_SUMMARIZATION_TRIGGER_TURNS
      const normalizedTrigger = Math.max(sanitizedTriggerCandidate, sanitizedKeep)

      nextConfig.summarizationKeepRecentTurns = sanitizedKeep
      nextConfig.summarizationTriggerTurns = normalizedTrigger
      keepLast = sanitizedKeep
      maxTurns = normalizedTrigger
    }

    updateAgentConfig(agentKey, nextConfig)

    try {
      const response = await fetch("/api/agents/summarization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable: checked, maxTurns, keepLast, agentIds: [agentKey] }),
      })
      if (!response.ok) {
        console.error(`Failed to update summarizing sessions for ${agentKey}: received status`, response.status)
      }
      // If we enabled summarization, ensure trimming and compacting are disabled at the backend
      if (checked) {
        const resp2 = await fetch("/api/agents/trimming", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enable: false, agentIds: [agentKey] }),
        })
        if (!resp2.ok) {
          console.error(`Failed to disable trimming for ${agentKey}: received status`, resp2.status)
        }
        const resp3 = await fetch("/api/agents/compacting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enable: false, agentIds: [agentKey] }),
        })
        if (!resp3.ok) {
          console.error(`Failed to disable compacting for ${agentKey}: received status`, resp3.status)
        }
      }
    } catch (error) {
      console.error(`Failed to update summarizing sessions for ${agentKey}:`, error)
    }
  }

  const handleSummarizationSettingsChange = async (agentKey: AgentKey, updates: Partial<AgentConfig>) => {
    const currentConfig = getAgentConfig(agentKey)
    const mergedConfig: AgentConfig = { ...currentConfig, ...updates }

    const sanitizedKeep =
      sanitizePositiveInt(mergedConfig.summarizationKeepRecentTurns) ?? DEFAULT_SUMMARIZATION_KEEP_TURNS
    const sanitizedTriggerCandidate =
      sanitizePositiveInt(mergedConfig.summarizationTriggerTurns) ?? DEFAULT_SUMMARIZATION_TRIGGER_TURNS
    const normalizedTrigger = Math.max(sanitizedTriggerCandidate, sanitizedKeep)

    const nextConfig: AgentConfig = {
      ...mergedConfig,
      summarizationKeepRecentTurns: sanitizedKeep,
      summarizationTriggerTurns: normalizedTrigger,
    }

    updateAgentConfig(agentKey, nextConfig)

    if (!nextConfig.memorySummarization) {
      return
    }

    try {
      const response = await fetch("/api/agents/summarization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enable: true,
          maxTurns: nextConfig.summarizationTriggerTurns,
          keepLast: nextConfig.summarizationKeepRecentTurns,
          agentIds: [agentKey],
        }),
      })
      if (!response.ok) {
        console.error(`Failed to update summarizing session limits for ${agentKey}: received status`, response.status)
      }
    } catch (error) {
      console.error(`Failed to update summarizing session limits for ${agentKey}:`, error)
    }
  }

  const handleAgentMemoryCompactingChange = async (agentKey: AgentKey, checked: boolean) => {
    const currentConfig = getAgentConfig(agentKey)
    const shouldApplyDefaultTrigger =
      checked &&
      (!Number.isFinite(currentConfig.compactingTriggerTurns) ||
        currentConfig.compactingTriggerTurns === null ||
        currentConfig.compactingTriggerTurns <= 0)
    const normalizedTriggerTurns = shouldApplyDefaultTrigger
      ? DEFAULT_COMPACTING_TRIGGER_TURNS
      : currentConfig.compactingTriggerTurns

    const nextConfig = {
      ...currentConfig,
      memoryCompacting: checked,
      memorySummarization: checked ? false : currentConfig.memorySummarization,
      memoryTrimming: checked ? false : currentConfig.memoryTrimming,
      compactingTriggerTurns: checked ? normalizedTriggerTurns : currentConfig.compactingTriggerTurns,
    }

    updateAgentConfig(agentKey, nextConfig)

    const sanitizeTriggerValue = (value: number | null) => {
      if (typeof value !== "number") {
        return undefined
      }
      return Number.isFinite(value) && value > 0 ? value : undefined
    }

    const triggerTurns = sanitizeTriggerValue(nextConfig.compactingTriggerTurns)

    const payload = {
      enable: checked,
      agentIds: [agentKey],
      trigger: triggerTurns !== undefined ? { turns: triggerTurns } : undefined,
      keep: nextConfig.compactingKeepTurns,
      excludeTools: nextConfig.compactingExcludeTools,
      clearToolInputs: nextConfig.compactingClearToolInputs,
    }

    try {
      const response = await fetch("/api/agents/compacting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        console.error(`Failed to update compacting for ${agentKey}: received status`, response.status)
      }
      if (checked) {
        // Ensure trimming and summarization are disabled on the backend as well
        const disableTrimming = fetch("/api/agents/trimming", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enable: false, agentIds: [agentKey] }),
        })
        const disableSummarization = fetch("/api/agents/summarization", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enable: false, agentIds: [agentKey] }),
        })
        await Promise.allSettled([disableTrimming, disableSummarization])
      }
    } catch (error) {
      console.error(`Failed to update compacting for ${agentKey}:`, error)
    }
  }

  const handleCompactingSettingsChange = async (agentKey: AgentKey, updates: Partial<AgentConfig>) => {
    const currentConfig = getAgentConfig(agentKey)
    const nextConfig = { ...currentConfig, ...updates }

    if (!nextConfig.memoryCompacting) {
      return
    }

    const sanitizeTriggerValue = (value: number | null) => {
      if (typeof value !== "number") {
        return undefined
      }
      return Number.isFinite(value) && value > 0 ? value : undefined
    }

    const triggerTurns = sanitizeTriggerValue(nextConfig.compactingTriggerTurns)

    const payload = {
      enable: true,
      agentIds: [agentKey],
      trigger: triggerTurns !== undefined ? { turns: triggerTurns } : undefined,
      keep: nextConfig.compactingKeepTurns,
      excludeTools: nextConfig.compactingExcludeTools,
      clearToolInputs: nextConfig.compactingClearToolInputs,
    }

    try {
      const response = await fetch("/api/agents/compacting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        console.error(`Failed to update compacting configuration for ${agentKey}: received status`, response.status)
      }
    } catch (error) {
      console.error(`Failed to update compacting configuration for ${agentKey}:`, error)
    }
  }

  return (
    <div className="space-y-6 text-base md:text-lg">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Agent A Configuration */}
        <AgentConfigCard
          title="Agent A"
          config={agentA.config}
          onUpdate={onUpdateAgentA}
          onMemoryTrimmingChange={(checked) => {
            void handleAgentMemoryTrimmingChange("agentA", checked)
          }}
          onMemorySummarizationChange={(checked) => {
            void handleAgentMemorySummarizationChange("agentA", checked)
          }}
          onSummarizationSettingsChange={(updates) => {
            void handleSummarizationSettingsChange("agentA", updates)
          }}
          onMemoryCompactingChange={(checked) => {
            void handleAgentMemoryCompactingChange("agentA", checked)
          }}
          onCompactingSettingsChange={(updates) => {
            void handleCompactingSettingsChange("agentA", updates)
          }}
          accentColor="primary"
        />

        {/* Agent B Configuration */}
        <AgentConfigCard
          title="Agent B"
          config={agentB.config}
          onUpdate={onUpdateAgentB}
          onMemoryTrimmingChange={(checked) => {
            void handleAgentMemoryTrimmingChange("agentB", checked)
          }}
          onMemorySummarizationChange={(checked) => {
            void handleAgentMemorySummarizationChange("agentB", checked)
          }}
          onSummarizationSettingsChange={(updates) => {
            void handleSummarizationSettingsChange("agentB", updates)
          }}
          onMemoryCompactingChange={(checked) => {
            void handleAgentMemoryCompactingChange("agentB", checked)
          }}
          onCompactingSettingsChange={(updates) => {
            void handleCompactingSettingsChange("agentB", updates)
          }}
          accentColor="accent"
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={isSaving} className="min-w-[200px]">
          {isSaving ? "Saving..." : "Save Configurations"}
        </Button>
      </div>
    </div>
  )
}

type AgentConfigCardProps = {
  title: string
  config: AgentConfig
  onUpdate: (config: AgentConfig) => void
  accentColor: "primary" | "accent"
  onMemoryTrimmingChange?: (checked: boolean) => void
  onMemorySummarizationChange?: (checked: boolean) => void
  onSummarizationSettingsChange?: (updates: Partial<AgentConfig>) => void
  onMemoryCompactingChange?: (checked: boolean) => void
  onCompactingSettingsChange?: (updates: Partial<AgentConfig>) => void
}

function AgentConfigCard({
  title,
  config,
  onUpdate,
  accentColor,
  onMemoryTrimmingChange,
  onMemorySummarizationChange,
  onSummarizationSettingsChange,
  onMemoryCompactingChange,
  onCompactingSettingsChange,
}: AgentConfigCardProps) {
  const [memoryMaxTurnsInput, setMemoryMaxTurnsInput] = useState<string>(() =>
    Number.isFinite(config.memoryMaxTurns) ? String(config.memoryMaxTurns) : "",
  )
  const [memoryKeepTurnsInput, setMemoryKeepTurnsInput] = useState<string>(() =>
    Number.isFinite(config.memoryKeepRecentTurns) ? String(config.memoryKeepRecentTurns) : "",
  )
  const [summarizationTriggerInput, setSummarizationTriggerInput] = useState<string>(() =>
    Number.isFinite(config.summarizationTriggerTurns) ? String(config.summarizationTriggerTurns) : "",
  )
  const [summarizationKeepInput, setSummarizationKeepInput] = useState<string>(() =>
    Number.isFinite(config.summarizationKeepRecentTurns) ? String(config.summarizationKeepRecentTurns) : "",
  )
  const [compactingTurnsInput, setCompactingTurnsInput] = useState<string>(() =>
    Number.isFinite(config.compactingTriggerTurns) && config.compactingTriggerTurns !== null
      ? String(config.compactingTriggerTurns)
      : "",
  )
  const [compactingKeepTurnsInput, setCompactingKeepTurnsInput] = useState<string>(() =>
    Number.isFinite(config.compactingKeepTurns) ? String(config.compactingKeepTurns) : "",
  )
  const [compactingExcludeToolsInput, setCompactingExcludeToolsInput] = useState<string>(() =>
    config.compactingExcludeTools.length > 0 ? config.compactingExcludeTools.join(", ") : "",
  )

  const accentTextClass = accentColor === "primary" ? "text-primary" : "text-accent"
  const accentOutlineClass = accentColor === "primary" ? "border-primary/40" : "border-accent/40"
  const accentDotClass = accentColor === "primary" ? "bg-primary" : "bg-accent"

  useEffect(() => {
    setMemoryMaxTurnsInput(Number.isFinite(config.memoryMaxTurns) ? String(config.memoryMaxTurns) : "")
  }, [config.memoryMaxTurns])

  useEffect(() => {
    setMemoryKeepTurnsInput(
      Number.isFinite(config.memoryKeepRecentTurns) ? String(config.memoryKeepRecentTurns) : "",
    )
  }, [config.memoryKeepRecentTurns])

  useEffect(() => {
    setSummarizationTriggerInput(
      Number.isFinite(config.summarizationTriggerTurns) ? String(config.summarizationTriggerTurns) : "",
    )
  }, [config.summarizationTriggerTurns])

  useEffect(() => {
    setSummarizationKeepInput(
      Number.isFinite(config.summarizationKeepRecentTurns) ? String(config.summarizationKeepRecentTurns) : "",
    )
  }, [config.summarizationKeepRecentTurns])

  useEffect(() => {
    setCompactingTurnsInput(
      Number.isFinite(config.compactingTriggerTurns) && config.compactingTriggerTurns !== null
        ? String(config.compactingTriggerTurns)
        : "",
    )
  }, [config.compactingTriggerTurns])

  useEffect(() => {
    setCompactingKeepTurnsInput(Number.isFinite(config.compactingKeepTurns) ? String(config.compactingKeepTurns) : "")
  }, [config.compactingKeepTurns])

  useEffect(() => {
    setCompactingExcludeToolsInput(
      config.compactingExcludeTools.length > 0 ? config.compactingExcludeTools.join(", ") : "",
    )
  }, [config.compactingExcludeTools])

  const updateConfig = (updates: Partial<AgentConfig>) => {
    onUpdate({ ...config, ...updates })
  }

  const updateSummarizationConfig = (updates: Partial<AgentConfig>) => {
    const next = { ...config, ...updates }
    onUpdate(next)
    onSummarizationSettingsChange?.(updates)
  }

  const updateCompactingConfig = (updates: Partial<AgentConfig>) => {
    const next = { ...config, ...updates }
    onUpdate(next)
    onCompactingSettingsChange?.(updates)
  }

  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle
          className={`text-xl text-center ${accentTextClass}`}
        >
          <span className="inline-flex items-center justify-center gap-2">
            {title}
            {(config.memoryTrimming ||
              config.memorySummarization ||
              config.memoryCompacting ||
              config.memoryInjection) && (
              <span className="rounded-xl bg-orange-500 px-3 py-1 text-sm font-semibold uppercase text-white">
                + Memory
              </span>
            )}
          </span>
        </CardTitle>
        <div className="mt-1 text-center text-base text-muted-foreground">
          {`${config.model} • ${config.reasoningLevel} reasoning`}
          {config.memoryTrimming && <span>{" • trimming"}</span>}
          {config.memorySummarization && <span>{" • summarization"}</span>}
          {config.memoryCompacting && <span>{" • compacting"}</span>}
          {config.memoryInjection && <span>{" • injection"}</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Model Selector */}
        <div className="space-y-2">
          <Label>Model</Label>
          <Select
            value={config.model}
            onValueChange={(value) =>
              updateConfig({
                model: value as AgentConfig["model"],
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gpt-5.1">GPT-5.1</SelectItem>
              <SelectItem value="gpt-5">GPT-5</SelectItem>
              <SelectItem value="gpt-5-mini">GPT-5 Mini</SelectItem>
              <SelectItem value="gpt-5-nano">GPT-5 Nano</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Reasoning Level */}
        <div className="space-y-2">
          <Label>Reasoning Level</Label>
          <Select
            value={config.reasoningLevel}
            onValueChange={(value) =>
              updateConfig({
                reasoningLevel: value as AgentConfig["reasoningLevel"],
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="minimal">Minimal</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Verbosity Level */}
        <div className="space-y-2">
          <Label>Verbosity Level</Label>
          <Select
            value={config.verbosityLevel}
            onValueChange={(value) =>
              updateConfig({
                verbosityLevel: value as AgentConfig["verbosityLevel"],
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Memory Controls */}
        <div className="space-y-6 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">Memory Controls</h3>

          <div className={`space-y-4 rounded-md border bg-muted/20 p-4 shadow-sm ${accentOutlineClass}`}>
            <div className="flex items-center gap-3 border-b border-border/60 pb-2">
              <span className={`h-2.5 w-2.5 rounded-full ${accentDotClass}`} aria-hidden="true" />
              <h4 className={`text-base font-semibold uppercase tracking-wide ${accentTextClass}`}>In-Session</h4>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor={`trimming-${title}`}>Trimming</Label>
                <Switch
                  id={`trimming-${title}`}
                  checked={config.memoryTrimming}
                  onCheckedChange={(checked) => {
                    if (onMemoryTrimmingChange) {
                      onMemoryTrimmingChange(checked)
                    } else {
                      updateConfig({ memoryTrimming: checked })
                    }
                  }}
                />
              </div>

              {config.memoryTrimming && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Max Turns</Label>
                    <Input
                      type="number"
                      value={memoryMaxTurnsInput}
                      onChange={(e) => {
                        const nextValue = e.target.value
                        setMemoryMaxTurnsInput(nextValue)

                        if (nextValue === "") {
                          return
                        }

                        const parsedValue = Number.parseInt(nextValue, 10)
                        if (!Number.isNaN(parsedValue)) {
                          updateConfig({ memoryMaxTurns: parsedValue })
                        }
                      }}
                      onBlur={() => {
                        if (memoryMaxTurnsInput === "") {
                          setMemoryMaxTurnsInput(
                            Number.isFinite(config.memoryMaxTurns) ? String(config.memoryMaxTurns) : "",
                          )
                        }
                      }}
                      min={1}
                      max={50}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Keep Recent Turns</Label>
                    <Input
                      type="number"
                      value={memoryKeepTurnsInput}
                      onChange={(e) => {
                        const nextValue = e.target.value
                        setMemoryKeepTurnsInput(nextValue)

                        if (nextValue === "") {
                          return
                        }

                        const parsedValue = Number.parseInt(nextValue, 10)
                        if (!Number.isNaN(parsedValue) && parsedValue > 0) {
                          updateConfig({ memoryKeepRecentTurns: parsedValue })
                        }
                      }}
                      onBlur={() => {
                        if (memoryKeepTurnsInput === "") {
                          setMemoryKeepTurnsInput(
                            Number.isFinite(config.memoryKeepRecentTurns)
                              ? String(config.memoryKeepRecentTurns)
                              : "",
                          )
                        }
                      }}
                      min={1}
                      max={50}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <Label htmlFor={`compacting-${title}`}>Compacting</Label>
                <Switch
                  id={`compacting-${title}`}
                  checked={config.memoryCompacting}
                  onCheckedChange={(checked) => {
                    if (onMemoryCompactingChange) {
                      onMemoryCompactingChange(checked)
                    } else {
                      updateCompactingConfig({ memoryCompacting: checked })
                    }
                  }}
                />
              </div>

              {config.memoryCompacting && (
                <div className="space-y-4 rounded-md border border-border/50 bg-muted/10 p-4">
                  <div className="text-sm text-muted-foreground">
                    Configure the trigger that decides when tool outputs are compacted based on conversation turns.
                    Leave the trigger blank to ignore it.
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`compacting-turns-${title}`}>
                        Compaction Trigger (turns)
                      </Label>
                      <Input
                        id={`compacting-turns-${title}`}
                        type="number"
                        min={1}
                        value={compactingTurnsInput}
                        onChange={(event) => {
                          const nextValue = event.target.value
                          setCompactingTurnsInput(nextValue)

                          if (nextValue === "") {
                            updateCompactingConfig({ compactingTriggerTurns: null })
                            return
                          }

                          const parsed = Number.parseInt(nextValue, 10)
                          if (!Number.isNaN(parsed)) {
                            updateCompactingConfig({ compactingTriggerTurns: parsed })
                          }
                        }}
                        onBlur={() => {
                          if (compactingTurnsInput === "") {
                            setCompactingTurnsInput(
                              Number.isFinite(config.compactingTriggerTurns) &&
                                config.compactingTriggerTurns !== null
                                ? String(config.compactingTriggerTurns)
                                : "",
                            )
                          }
                        }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`compacting-keep-${title}`}>Keep Recent Turns</Label>
                      <Input
                        id={`compacting-keep-${title}`}
                        type="number"
                        min={1}
                        value={compactingKeepTurnsInput}
                        onChange={(event) => {
                          const nextValue = event.target.value
                          setCompactingKeepTurnsInput(nextValue)

                          const parsed = Number.parseInt(nextValue, 10)
                          if (!Number.isNaN(parsed) && parsed > 0) {
                            updateCompactingConfig({ compactingKeepTurns: parsed })
                          }
                        }}
                        onBlur={() => {
                          if (compactingKeepTurnsInput === "") {
                            setCompactingKeepTurnsInput(
                              Number.isFinite(config.compactingKeepTurns)
                                ? String(config.compactingKeepTurns)
                                : "",
                            )
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`compacting-exclude-tools-${title}`}>Exclude Tools</Label>
                    <Input
                      id={`compacting-exclude-tools-${title}`}
                      value={compactingExcludeToolsInput}
                      placeholder="Comma-separated tool names"
                      onChange={(event) => {
                        const nextValue = event.target.value
                        setCompactingExcludeToolsInput(nextValue)

                        const tools = nextValue
                          .split(",")
                          .map((tool) => tool.trim())
                          .filter((tool) => tool.length > 0)

                        updateCompactingConfig({ compactingExcludeTools: tools })
                      }}
                      onBlur={() => {
                        setCompactingExcludeToolsInput(
                          config.compactingExcludeTools.length > 0
                            ? config.compactingExcludeTools.join(", ")
                            : "",
                        )
                      }}
                    />
                    <p className="text-sm text-muted-foreground">
                      Tools listed here will never be compacted. Matching is case-insensitive.
                    </p>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-border/50 bg-background/60 px-3 py-2">
                    <div>
                      <p className="text-base font-medium text-foreground">Clear Tool Inputs</p>
                      <p className="text-sm text-muted-foreground">
                        When enabled, both tool parameters and results are compacted.
                      </p>
                    </div>
                    <Switch
                      id={`compacting-clear-inputs-${title}`}
                      checked={config.compactingClearToolInputs}
                      onCheckedChange={(checked) => {
                        updateCompactingConfig({ compactingClearToolInputs: checked })
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <Label htmlFor={`summarization-${title}`}>Summarization</Label>
                <Switch
                  id={`summarization-${title}`}
                  checked={config.memorySummarization}
                  onCheckedChange={(checked) => {
                    if (onMemorySummarizationChange) {
                      onMemorySummarizationChange(checked)
                    } else {
                      updateConfig({ memorySummarization: checked })
                    }
                  }}
                />
              </div>

              {config.memorySummarization && (
                <div className="space-y-4 rounded-md border border-border/50 bg-muted/10 p-4">
                  <div className="text-sm text-muted-foreground">
                    Summarizes earlier turns once the conversation reaches the trigger and injects the summary into the context while keeping the recent turns verbatim.
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`summarization-trigger-${title}`}>Summarization Trigger (Turns)</Label>
                      <Input
                        id={`summarization-trigger-${title}`}
                        type="number"
                        min={1}
                        max={50}
                        value={summarizationTriggerInput}
                        onChange={(event) => {
                          const nextValue = event.target.value
                          setSummarizationTriggerInput(nextValue)

                          if (nextValue === "") {
                            return
                          }

                          const parsed = Number.parseInt(nextValue, 10)
                          if (!Number.isNaN(parsed) && parsed > 0) {
                            updateSummarizationConfig({ summarizationTriggerTurns: parsed })
                          }
                        }}
                        onBlur={() => {
                          if (summarizationTriggerInput === "") {
                            setSummarizationTriggerInput(
                              Number.isFinite(config.summarizationTriggerTurns)
                                ? String(config.summarizationTriggerTurns)
                                : "",
                            )
                          }
                        }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`summarization-keep-${title}`}>Keep Recent Turns</Label>
                      <Input
                        id={`summarization-keep-${title}`}
                        type="number"
                        min={1}
                        max={50}
                        value={summarizationKeepInput}
                        onChange={(event) => {
                          const nextValue = event.target.value
                          setSummarizationKeepInput(nextValue)

                          if (nextValue === "") {
                            return
                          }

                          const parsed = Number.parseInt(nextValue, 10)
                          if (!Number.isNaN(parsed) && parsed > 0) {
                            updateSummarizationConfig({ summarizationKeepRecentTurns: parsed })
                          }
                        }}
                        onBlur={() => {
                          if (summarizationKeepInput === "") {
                            setSummarizationKeepInput(
                              Number.isFinite(config.summarizationKeepRecentTurns)
                                ? String(config.summarizationKeepRecentTurns)
                                : "",
                            )
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={`space-y-4 rounded-md border bg-muted/20 p-4 shadow-sm ${accentOutlineClass}`}>
            <div className="flex items-center gap-3 border-b border-border/60 pb-2">
              <span className={`h-2.5 w-2.5 rounded-full ${accentDotClass}`} aria-hidden="true" />
              <h4 className={`text-base font-semibold uppercase tracking-wide ${accentTextClass}`}>Cross-Session</h4>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor={`memory-injection-${title}`}>Memory Injection</Label>
                <p className="text-sm text-muted-foreground">
                  When enabled, prior session summary is injected into this agent&apos;s system prompt.
                </p>
              </div>
              <Switch
                id={`memory-injection-${title}`}
                checked={Boolean(config.memoryInjection)}
                onCheckedChange={(checked) => {
                  updateConfig({ memoryInjection: checked })
                }}
              />
            </div>
          </div>
        </div>

      </CardContent>
    </Card>
  )
}
