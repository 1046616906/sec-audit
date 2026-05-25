import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const taskId = req.nextUrl.searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json({ error: "taskId query param is required" }, { status: 400 });
    }

    const vulnerabilities = await db.vulnerability.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ vulnerabilities });
  } catch (err) {
    console.error("[scan/results]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
