import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"

import {
  createDefaultAgentConfig,
  normalizeAgentConfig,
  type PersistedAgentConfigs,
} from "@/lib/default-agent-config"

export const runtime = "nodejs"

const CONFIG_FILE_PATH = path.join(process.cwd(), "state", "agent-config.json")

async function ensureConfigDirectory() {
  const directory = path.dirname(CONFIG_FILE_PATH)
  await fs.mkdir(directory, { recursive: true })
}

async function saveConfigsToDisk(configs: PersistedAgentConfigs) {
  await ensureConfigDirectory()
  await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(configs, null, 2), "utf-8")
}

async function readConfigsFromDisk(): Promise<PersistedAgentConfigs> {
  try {
    const raw = await fs.readFile(CONFIG_FILE_PATH, "utf-8")
    const parsed = JSON.parse(raw) as Partial<PersistedAgentConfigs>

    return {
      agentA: normalizeAgentConfig(parsed.agentA),
      agentB: normalizeAgentConfig(parsed.agentB),
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException

    if (err.code === "ENOENT" || error instanceof SyntaxError) {
      const defaults: PersistedAgentConfigs = {
        agentA: createDefaultAgentConfig(),
        agentB: createDefaultAgentConfig(),
      }
      await saveConfigsToDisk(defaults)
      return defaults
    }

    throw error
  }
}

export async function GET() {
  try {
    const configs = await readConfigsFromDisk()
    return NextResponse.json({ success: true, ...configs })
  } catch (error) {
    console.error("Failed to load agent configurations:", error)
    return NextResponse.json(
      { success: false, error: "Failed to load agent configurations" },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<PersistedAgentConfigs> | null

    const configs: PersistedAgentConfigs = {
      agentA: normalizeAgentConfig(body?.agentA),
      agentB: normalizeAgentConfig(body?.agentB),
    }

    await saveConfigsToDisk(configs)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to save agent configurations:", error)
    const message = error instanceof Error ? error.message : "Failed to save agent configurations"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}


