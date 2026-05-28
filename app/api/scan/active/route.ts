import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(): Promise<NextResponse> {
  try {
    const tasks = await db.scanTask.findMany({
      where: { status: { in: ["running", "paused", "menu_select"] } },
      orderBy: { createdAt: "desc" },
    });

    const list = tasks.map((t) => ({
      id: t.id,
      targetUrl: t.targetUrl,
      status: t.status,
    }));

    // Backward-compat: keep `task` (most recent) so any old client still works.
    return NextResponse.json(
      { task: list[0] ?? null, tasks: list },
      { status: 200 },
    );
  } catch (err) {
    console.error("[scan/active]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
