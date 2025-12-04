import { NextResponse } from "next/server"

import { resetPythonAgentState } from "@/lib/python-agent-bridge"

export const runtime = "nodejs"

export async function POST() {
  try {
    await resetPythonAgentState()

    return NextResponse.json({
      success: true,
      message: "Agent sessions reset successfully",
    })
  } catch (error) {
    console.error("Error resetting agents:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to reset agents" },
      { status: 500 },
    )
  }
}
