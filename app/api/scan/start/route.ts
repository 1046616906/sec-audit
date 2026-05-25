import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scanQueue } from "@/lib/queue";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json();

    if (
      typeof body !== "object" ||
      body === null ||
      !("targetUrl" in body) ||
      typeof (body as Record<string, unknown>).targetUrl !== "string" ||
      !(body as Record<string, string>).targetUrl.trim()
    ) {
      return NextResponse.json(
        { error: "targetUrl is required" },
        { status: 400 }
      );
    }

    const { targetUrl } = body as { targetUrl: string };
    const taskId = crypto.randomUUID();

    await db.scanTask.create({
      data: { id: taskId, targetUrl, status: "running" },
    });

    await scanQueue.add("scan", { taskId, targetUrl });

    return NextResponse.json({ taskId }, { status: 200 });
  } catch (err) {
    console.error("[scan/start]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
