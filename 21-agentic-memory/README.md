# Dual Agent AI Demo

A dual-agent evaluation playground that runs two OpenAI Agents side by side with independent configuration, shared prompts, and tool telemetry.

## Highlights

- Side-by-side chat UI with shared input and live tool traces.
- Persistent Python agent service (`scripts/agent_service.py`) driven through an NDJSON bridge.
- Configurable agent profiles stored in `state/agent-config.json`.
- Mocked tool backends for policy lookup and commerce order retrieval, plus stubs for ticketing and scheduler flows.
- Instrumented memory trimming and summarization toggles with token usage estimation.

## Architecture

**Frontend**  
Next.js 15 app (React Server Components) with shadcn/ui and Tailwind CSS v4.

**Backend**  
Next.js API routes proxy to a long-lived Python process (`lib/python-agent-bridge.ts`). Requests are serialized to NDJSON commands consumed by `scripts/agent_service.py`, which uses the OpenAI Agents SDK (`Runner`) with `AsyncOpenAI`.

**Data & State**  
Agent configuration is persisted to `state/agent-config.json`. Python-side tool state (tickets, approvals, scheduled jobs) lives in memory and can be reset via API.

## Prerequisites

- Node.js 20+ and npm
- Python 3.10+ available as `python3` (override with `PYTHON_PATH`)
- `OPENAI_API_KEY` environment variable for the Agents SDK
- Python packages: `openai`, `openai-agents`

## Setup

1. Install Node dependencies:
   ```bash
   npm install
   ```
2. Install Python dependencies:
   ```bash
   pip install openai openai-agents
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
   The Next.js server automatically spawns the Python agent bridge on demand.

4. Visit [http://localhost:3000](http://localhost:3000) and send a message to broadcast it to Agent A and Agent B.

## Runtime Behavior

- Each agent run builds a `Customer Support Assistant` persona with model, reasoning effort, verbosity, memory, and tool options supplied by the UI.
- Memory trimming and summarization toggles map to `TrimmingSession` and `SummarizingSession` implementations in `scripts/agent_service.py`.
- Tool output and token estimates are derived at run time and surfaced back to the UI for visualization.
- The active tool registry includes `SearchPolicy` and `GetOrder`. Additional ticketing and scheduler tools are implemented but disabled by default; uncomment them in `TOOL_REGISTRY` to expose them in the demo.

## Context Management & Token Accounting

### Modes

- Trimming (`TrimmingSession`): keeps only the last N user turns. When older context is trimmed, the demo computes a negative token delta for the removed messages so the UI can show a decrease in context usage.
- Summarization (`SummarizingSession`): when user turns exceed the configured context limit, the earlier prefix of the conversation is summarized. The summarized messages are removed from the active history, only the last K user turns are kept, and two synthetic items are inserted at the boundary:
  - a shadow user “instruction” line (prompting the model to use the summary)
  - an assistant message containing the summary text
- Compacting (`CompactingSession`): once the number of user-anchored turns crosses the configured trigger, the session walks the oldest turns (excluding the most recent `keep` turns) and replaces bulky tool call results—and optionally their inputs—with lightweight placeholders. This preserves conversational intent while freeing context. Tool names and call ids are left intact so the model can reference past actions, and placeholder content is rendered back to the UI to explain what was compacted.

Defaults (can be adjusted via the configuration endpoints/UI): keep last K=3 user turns; summarize once more than 5 user turns would be retained.

### Token counting logic

This demo estimates tokens from character counts using a simple rule of thumb: ceil(len(text) / 4).

Per run we return a `tokenUsage` breakdown with these categories:

- userInput: tokens from all user messages in the provided history for this run (including the most recent user message)
- agentOutput: tokens from the assistant’s final response text
- tools: tokens from tool results produced during the run
- rag: subset of tool tokens attributed to retrieval-like calls (e.g., `SearchPolicy`)
- memory: tokens added only when summarization occurs, equal to the summary text token estimate (the shadow line is not counted toward memory)

Context removal deltas:

- When trimming or summarization removes messages from history, the service computes how many tokens were removed by role and returns them as negative deltas in `userInput`, `agentOutput`, `tools`, and `rag`. This makes the “Context Lifecycle” chart dip on those turns, accurately reflecting reduced active context.

Notes:

- Token estimates are heuristic and intended for visualization/intuition. They do not reflect exact tokenizer counts.
- The totals shown in the “Context Visualization” bar and the “Context Lifecycle” chart are cumulative across turns; negative deltas reduce the cumulative totals when context is trimmed or summarized.

## Demo Scripts

Use these scripts while screen sharing to illustrate how each context strategy behaves.

### Example: Connectivity Troubleshooting With Order Lookup

1. Greet the agents and capture the user’s name: 

> Hi! Thanks, my name is Emre.

2. Provide device and location context with a troubleshooting blocker: 

> I have a MacBook Pro 2020 that I bought in Oregon. It’s not connecting to the internet.

3. Emphasize the frustration and ask for guided help: 

> Wow, it’s too much, I’ve already tried FAQs but no luck. Walk me step by step.

4. Pause the troubleshooting to request account data: 

> Wait, before that can you show me my orders? ORD-12345.

## API Surface

- `POST /api/agents/chat` – normalizes agent histories and streams the prompt to the Python bridge for both agents in parallel.
- `GET /api/agents/config` – reads persisted agent defaults from disk (creating them on first run).
- `POST /api/agents/config` – persists updated agent configurations.
- `POST /api/agents/reset` – clears Python-side tool stores and session caches.

## Resetting & Troubleshooting

- Use the "Reset Agents" control (or call the reset route) to flush in-memory ticket/order/scheduler data and restart conversational context.
- Check the terminal running `npm run dev` for `[agents-python]` logs emitted by the Python process.
- If the Python bridge exits unexpectedly, the next API call will respawn it.

## Customization

- Tweak default agent settings in `lib/default-agent-config.ts`.
- Modify the agent persona or tool list inside `scripts/agent_service.py`.
- Extend the UI or context visualizations under `app/` to add new metrics or controls.

## License

Built for OpenAI solutions architects to demonstrate agent capabilities to customers.


# Demo Guide

## Demo Overview
- Dual-agent workspace lets you run two OpenAI Agents side by side with shared prompts, mirrored histories, and synchronized tool traces for comparative evaluation of memory strategies and model settings.
- UI is built in Next.js 15 with React 19, TypeScript, Tailwind CSS v4, and shadcn/ui primitives; the entire experience lives inside a single-page `DualAgentDemo` layout combining chat, configuration, and visualization panes.
- Backend logic stays inside Next.js API routes, but all agent execution is proxied to a long-lived Python worker, keeping Node.js lightweight while enabling reuse of the OpenAI Agents SDK.
- Local state such as default personas, tool toggles, and summaries persists to `state/` so the demo feels stateful across reloads yet can be reset from the UI.

## Frontend Stack
- Renders with React Server Components + client islands; `app/page.tsx` hosts `DualAgentDemo`, while client components like `chat-interface.tsx` handle streaming, markdown rendering, and token bars.
- shadcn/ui and Radix compose the component library (buttons, cards, accordions) and Tailwind v4 provides styling with utility classes and CSS variables.
- `ConfigurationPanel` manages model selection, reasoning depth, verbosity, and mutually exclusive memory modes per agent, dispatching REST calls to the backend when toggles change.

```52:101:components/configuration-panel.tsx
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
    // ... existing code ...
```
- Token usage, context lifecycle charts, and compacted summary overlays are React visualizations fed by per-turn telemetry coming back from the Python service.

## Agent Runtime Flow
- `/api/agents/chat` normalizes each agent’s history and issues two parallel `runPythonAgent` calls; results return streamed tool logs, token breakdowns, and optional summaries.
- `lib/python-agent-bridge.ts` keeps a singleton Python subprocess alive, speaks NDJSON over stdin/stdout, detects script hot reloads, and multiplexes requests with per-call promises.

```75:158:lib/python-agent-bridge.ts
    this.process = spawn(PYTHON_BIN, [this.scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    })
    // ...
    return this.sendCommand<{ ok: boolean }>({
      type: "configure_compacting",
      agent_ids: params.agentIds,
      enable: params.enable,
      trigger: params.trigger,
      keep: params.keep,
      exclude_tools: params.excludeTools,
      clear_tool_inputs: params.clearToolInputs,
    })
```
- `scripts/agent_service.py` hosts the OpenAI Agents `Runner`, instantiates tool registries, and implements trimming, summarizing, and compacting session subclasses (compacting logic extended in `scripts/compacting_session.py`).
- Responses return normalized token usage plus flags (`contextTrimmed`, `contextSummarized`, `contextCompacted`) so the UI can explain why context changed.

## Memory & Context Management
- Trimming keeps the last _N_ user turns and emits negative token deltas when history is pruned; summarization replaces older turns with a synthetic shadow instruction + assistant summary; compacting rewrites bulky tool outputs into placeholders once thresholds are crossed.
- Configuration endpoints (`/api/agents/trimming`, `/summarization`, `/compacting`) call the bridge to flip strategies per agent with guards that keep only one strategy active at a time.
- Token accounting is heuristic (`ceil(len(text)/4)`) but consistent across runs, giving clear visuals in the “Context Usage” bars and “Context Lifecycle” charts.

## Data & Tools
- Default agent personas live in `lib/default-agent-config.ts` and are persisted to `state/agent-config.json`; updates via the panel write back through `/api/agents/config`.
- Python holds mock data stores for policies, orders, tickets, approvals, and scheduling; `reset` clears them so repeated demos start clean without restarting the dev server.
- Tool registry exposes `SearchPolicy` and `GetOrder` by default, with ticketing and scheduler tools scaffolded but toggled off; each tool call is logged and surfaced in the UI’s tool trace.

## Ops Notes
- Development workflow: `npm run dev` (spawns Next.js and the Python bridge automatically), plus `pip install openai openai-agents` and `OPENAI_API_KEY`.
- Bridge respawns automatically if it exits; stderr is piped with `[agents-python]` tags for quick debugging in the Next.js console.
- Demo scripts in `README.md` give a narrative for showcasing context strategies, and the UI has a “Reset Agents” control to clear both histories and Python-side state before rerunning scenarios.


## Demo Prompts

### Intro
1. Hi! 
2. My laptop fan is making weird noises while playing games. Is it normal?
3. Before that, I want to see my orders. My order number is ORD-12345

### Context Burst
1. Hi!
2. I am having an overheating issue on my laptop.
3. Thanks, before that, I want to see the refund policy for my Macbook Pro 2014.
4. Thanks, I have internet connection issues.

### Trimming (6-3)
1. hi!
2. I want to see the refund policy for my Macbook Pro 2014 I bought a month ago.
3. Can we also check my order? My order number is ORD-12345
4. Thanks, I am having an issue with the internet connection.
5. I tried to load an internet page and still see 404 errors.
6. It's happening on Safari.
7. TRIMMED

### Compaction (4-2)

1. Firstly, I want to see the refund policy for my Macbook Pro 2014.
2. I also want to see my orders. My order number is ORD-12345
3. Here is my problem, I am having issues with the internet connection.
4. I am still getting 404 error.
5. I use safari to open google
6. TRIMMED
7. yes google shows 404 too
8. What is DNS?

### Summarization (5-3)
1. Hi, I am having internet connection issues
2. I have a 2014 macbook pro 14 inch. I live in the US and bought this macbook from Amsterdam. I just received it from a battery change service and just updated the OS version last week. They asked me to update the OS version to MacOS Sequoia. 
3. I already tried hard reset after checking the FAQ docs but it did not work.
4. Wifi icon is not active
5. I tried it already, is it a software issue?
6. It says no connection
SUMMARIZED

### Injection
1. Hi!
2. I still have the same macbook, how can i update it to macos tahoe?
