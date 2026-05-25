import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json();
    if (
      typeof body !== "object" || body === null ||
      !("taskId" in body) || !("selectedIds" in body)
    ) {
      return NextResponse.json({ error: "taskId and selectedIds are required" }, { status: 400 });
    }
    const { taskId, selectedIds } = body as { taskId: string; selectedIds: string[] };
    await redis.set(`menu-select:${taskId}`, JSON.stringify(selectedIds), "EX", 300);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[worker/menu-select]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
