import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(): Promise<NextResponse> {
  try {
    const task = await db.scanTask.findFirst({
      where: { status: { in: ["running", "paused"] } },
      orderBy: { createdAt: "desc" },
    });

    if (!task) {
      return NextResponse.json({ task: null }, { status: 200 });
    }

    return NextResponse.json(
      { task: { id: task.id, targetUrl: task.targetUrl, status: task.status } },
      { status: 200 },
    );
  } catch (err) {
    console.error("[scan/active]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
