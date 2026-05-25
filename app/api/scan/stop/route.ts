import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json();

    if (
      typeof body !== "object" ||
      body === null ||
      !("taskId" in body) ||
      typeof (body as Record<string, unknown>).taskId !== "string" ||
      !(body as Record<string, string>).taskId.trim()
    ) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 }
      );
    }

    const { taskId } = body as { taskId: string };

    await db.scanTask.update({
      where: { id: taskId },
      data: { status: "failed" },
    });

    await redis.publish(
      "scan-events",
      JSON.stringify({ type: "SCAN_DONE", data: { summary: "Scan stopped by user" } })
    );

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[scan/stop]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
