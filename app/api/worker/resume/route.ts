import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json();

    if (
      typeof body !== "object" ||
      body === null ||
      !("taskId" in body) ||
      typeof (body as Record<string, unknown>).taskId !== "string"
    ) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const taskId = b.taskId as string;
    const username = typeof b.username === "string" ? b.username : null;
    const password = typeof b.password === "string" ? b.password : null;
    const captchaCode = typeof b.captchaCode === "string" ? b.captchaCode : null;

    if (username !== null && password !== null) {
      await redis.set(
        `auth:${taskId}`,
        JSON.stringify({ username, password }),
        "EX",
        120,
      );
    }

    if (captchaCode !== null) {
      await redis.set(`captcha:${taskId}`, captchaCode, "EX", 120);
    }

    if (username === null && password === null && captchaCode === null) {
      return NextResponse.json(
        { error: "At least one of username+password or captchaCode is required" },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[worker/resume]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
