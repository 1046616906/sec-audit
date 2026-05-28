import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

const SCAN_CONTROL_CHANNEL = "scan-control";

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

    // 1. Cancel flag — worker polls this between long-running steps.
    //    EX 1 hour is enough; the flag is meaningless once the task is gone.
    await redis.set(`scan:cancel:${taskId}`, "1", "EX", 3600);

    // 2. Pub/sub interrupt for in-flight long IO (page.goto, AI calls, sleeps).
    await redis.publish(
      SCAN_CONTROL_CHANNEL,
      JSON.stringify({ type: "CANCEL", taskId }),
    );

    // 3. Mark DB as cancelled. Worker's finally block will respect this and
    //    not overwrite back to completed/failed.
    await db.scanTask.update({
      where: { id: taskId },
      data: { status: "cancelled" },
    });

    // 4. UI hint — the active SSE stream will deliver this and the frontend
    //    will move the matching task back to idle.
    await redis.publish(
      "scan-events",
      JSON.stringify({
        type: "SCAN_DONE",
        taskId,
        data: { summary: "Scan stopped by user" },
      }),
    );

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[scan/stop]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
