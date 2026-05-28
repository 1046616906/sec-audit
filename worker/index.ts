// Load .env before any other imports so all env vars are available
import { config } from "dotenv";
config({ override: true });

import { Worker, Job } from "bullmq";
import { chromium, Browser } from "playwright";
import { v4 as uuidv4 } from "uuid";
import { redis, createRedisClient } from "../lib/redis";
import { ScanJobData } from "../lib/queue";
import { db } from "../lib/db";
import type { LogEntry } from "../lib/types";
import { runAgent } from "./agent";
import { registerInterceptor } from "./interceptor";
import { analyzeMetadata } from "./analyzer";

const SCAN_CHANNEL = "scan-events";
const CONTROL_CHANNEL = "scan-control";

type LogEvent = { type: "LOG"; data: LogEntry };
type FrameEvent = { type: "FRAME"; data: { base64: string } };
type ScanEvent = LogEvent | FrameEvent;

const publisher = createRedisClient();

// One subscriber for the whole worker process — fans out CANCEL events to
// per-job AbortControllers. ioredis subscriber connections cannot issue
// regular commands, so we keep this isolated.
const controlSubscriber = createRedisClient();
const cancelControllers = new Map<string, AbortController>();

void controlSubscriber.subscribe(CONTROL_CHANNEL).catch((err) => {
  console.error("[WORKER] failed to subscribe to scan-control:", err);
});

controlSubscriber.on("message", (_channel: string, raw: string) => {
  try {
    const msg = JSON.parse(raw) as { type?: string; taskId?: string };
    if (msg.type === "CANCEL" && typeof msg.taskId === "string") {
      const ctrl = cancelControllers.get(msg.taskId);
      if (ctrl && !ctrl.signal.aborted) {
        ctrl.abort(new Error("Scan cancelled by user"));
      }
    }
  } catch {
    /* malformed control message — ignore */
  }
});

async function publishRaw(event: ScanEvent | object): Promise<void> {
  await publisher.publish(SCAN_CHANNEL, JSON.stringify(event));
}

function makeLog(level: LogEntry["level"], message: string, taskId: string): LogEvent & { taskId: string } {
  return {
    type: "LOG",
    taskId,
    data: {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      tag: "WORKER",
      message,
    },
  };
}

async function isCancelled(taskId: string): Promise<boolean> {
  const flag = await redis.get(`scan:cancel:${taskId}`);
  return flag !== null;
}

async function processScan(job: Job<ScanJobData>): Promise<void> {
  const { taskId, targetUrl } = job.data;
  let browser: Browser | null = null;
  let pagesExplored = 0;
  let vulnerabilitiesFound = 0;

  // Per-job cancellation. The control-channel subscriber will abort this
  // when a CANCEL for our taskId arrives.
  const abortController = new AbortController();
  cancelControllers.set(taskId, abortController);

  // Tag every event with taskId so the SSE consumer can route by task.
  const publish = async (event: ScanEvent | object): Promise<void> => {
    const tagged =
      typeof event === "object" && event !== null && !("taskId" in event)
        ? { ...event, taskId }
        : event;
    await publishRaw(tagged);
  };

  let targetHostname: string;
  try {
    targetHostname = new URL(targetUrl).hostname;
  } catch {
    await publish(makeLog("error", `Scan rejected: invalid targetUrl "${targetUrl}"`, taskId));
    await db.scanTask.update({ where: { id: taskId }, data: { status: "failed" } });
    cancelControllers.delete(taskId);
    return;
  }
  void targetHostname;

  await publish(makeLog("info", `Starting scan for ${targetUrl}`, taskId));

  try {
    // Pre-flight cancel check — stop already pressed before worker picked up.
    if (await isCancelled(taskId)) {
      await publish(makeLog("info", `Scan ${taskId} cancelled before start.`, taskId));
      return;
    }

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--ignore-certificate-errors",
      ],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    // Close the page immediately on cancel — this unblocks any pending
    // page.goto / page.click / waitForLoadState the agent is sitting on.
    abortController.signal.addEventListener("abort", () => {
      browser?.close().catch(() => { /* already closing */ });
    });

    // Register Tier 1 interceptor before navigation
    registerInterceptor(
      page,
      async (meta) => {
        await analyzeMetadata(meta, taskId, publish);
        vulnerabilitiesFound++;
      },
      publish,
    );

    // Push sitemap node when page navigates — deduplicate by URL
    const seenUrls = new Set<string>();
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (!url.startsWith("http")) return;
      if (seenUrls.has(url)) return; // skip duplicate navigations
      seenUrls.add(url);
      pagesExplored++;

      // For SPA hash routes, use the hash fragment as label instead of pathname
      let label: string;
      try {
        const parsed = new URL(url);
        const hash = parsed.hash.replace(/^#\/?/, ""); // strip leading #/
        label = hash || parsed.pathname || url;
      } catch {
        label = url;
      }

      void publish({
        type: "SITEMAP",
        data: {
          node: {
            id: `page-${pagesExplored}`,
            url,
            label,
            explored: true,
            children: [],
          },
        },
      });
    });

    // SPA: networkidle 会被长轮询/ws 卡死，用 domcontentloaded + 手动等待
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("load", { timeout: 30000 }).catch(() => { /* 长连接场景忽略 */ });
    await page.waitForTimeout(1500);

    if (abortController.signal.aborted) throw new Error("cancelled");

    // Initial screenshot
    const screenshotBuffer = await page.screenshot({ type: "png" });
    await publish({ type: "FRAME", data: { base64: screenshotBuffer.toString("base64") } });

    // Periodic screenshot every 5 seconds during agent run
    let screenshotInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (abortController.signal.aborted) return;
      void page.screenshot({ type: "png" }).then((buf) => {
        void publish({ type: "FRAME", data: { base64: buf.toString("base64") } });
      }).catch(() => { /* page may be closing */ });
    }, 5000);

    try {
      // Run AI agent exploration loop
      await runAgent(page, taskId, publish, abortController.signal);
    } finally {
      if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
      }
    }

    // If cancelled during agent run, don't claim completion.
    if (abortController.signal.aborted || (await isCancelled(taskId))) {
      throw new Error("cancelled");
    }

    // Final screenshot after exploration
    const finalScreenshot = await page.screenshot({ type: "png" });
    await publish({ type: "FRAME", data: { base64: finalScreenshot.toString("base64") } });

    await db.scanTask.update({ where: { id: taskId }, data: { status: "completed" } });

    await publish({
      type: "SCAN_DONE",
      data: {
        summary: `Scan complete. Pages explored: ${pagesExplored}. Structural risks found: ${vulnerabilitiesFound}.`,
      },
    });

    await publish(makeLog("info",
      `Scan completed. Pages: ${pagesExplored}, findings: ${vulnerabilitiesFound}`,
      taskId,
    ));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error during scan";
    const wasCancelled = abortController.signal.aborted || (await isCancelled(taskId).catch(() => false));

    if (wasCancelled) {
      await publish(makeLog("info", `Scan cancelled for ${targetUrl}`, taskId));
      // Status was already set to 'cancelled' by /api/scan/stop. Don't overwrite.
      // But if for some reason it's still 'running', flip it.
      try {
        const cur = await db.scanTask.findUnique({ where: { id: taskId } });
        if (cur && cur.status !== "cancelled") {
          await db.scanTask.update({ where: { id: taskId }, data: { status: "cancelled" } });
        }
      } catch { /* db may have been reset */ }
    } else {
      await publish(makeLog("error", `Scan failed for ${targetUrl}: ${message}`, taskId));
      await db.scanTask.update({ where: { id: taskId }, data: { status: "failed" } }).catch(() => { /* ignore */ });
    }
  } finally {
    if (browser) await browser.close().catch(() => { /* already closed by abort */ });
    cancelControllers.delete(taskId);
    await redis.del(`scan:cancel:${taskId}`).catch(() => { /* ignore */ });
  }
}

const worker = new Worker<ScanJobData>("scan-queue", processScan, {
  connection: redis,
  concurrency: 2,
});

worker.on("completed", (job: Job<ScanJobData>) => {
  console.log(`[WORKER] Job ${job.id} completed`);
});

worker.on("failed", (job: Job<ScanJobData> | undefined, err: Error) => {
  console.error(`[WORKER] Job ${job?.id ?? "unknown"} failed:`, err.message);
});

console.log("[WORKER] Listening on scan-queue (concurrency=2)...");
