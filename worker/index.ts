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

type LogEvent = { type: "LOG"; data: LogEntry };
type FrameEvent = { type: "FRAME"; data: { base64: string } };
type ScanEvent = LogEvent | FrameEvent;

const publisher = createRedisClient();

async function publish(event: ScanEvent | object): Promise<void> {
  await publisher.publish(SCAN_CHANNEL, JSON.stringify(event));
}

function makeLog(level: LogEntry["level"], message: string): LogEvent {
  return {
    type: "LOG",
    data: {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      tag: "WORKER",
      message,
    },
  };
}

async function processScan(job: Job<ScanJobData>): Promise<void> {
  const { taskId, targetUrl } = job.data;
  let browser: Browser | null = null;
  let pagesExplored = 0;
  let vulnerabilitiesFound = 0;

  let targetHostname: string;
  try {
    targetHostname = new URL(targetUrl).hostname;
  } catch {
    await publish(makeLog("error", `Scan rejected: invalid targetUrl "${targetUrl}"`));
    await db.scanTask.update({ where: { id: taskId }, data: { status: "failed" } });
    return;
  }

  await publish(makeLog("info", `Starting scan for ${targetUrl}`));

  try {
    browser = await chromium.launch();
    const page = await browser.newPage();

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

    // SPA: wait for network to be idle after initial navigation
    await page.goto(targetUrl, { waitUntil: "networkidle" });

    // Initial screenshot
    const screenshotBuffer = await page.screenshot({ type: "png" });
    await publish({ type: "FRAME", data: { base64: screenshotBuffer.toString("base64") } });

    // Periodic screenshot every 5 seconds during agent run
    let screenshotInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
      void page.screenshot({ type: "png" }).then((buf) => {
        void publish({ type: "FRAME", data: { base64: buf.toString("base64") } });
      }).catch(() => { /* page may be closing */ });
    }, 5000);

    try {
      // Run AI agent exploration loop
      await runAgent(page, taskId, publish);
    } finally {
      if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
      }
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
    ));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error during scan";
    await publish(makeLog("error", `Scan failed for ${targetUrl}: ${message}`));
    await db.scanTask.update({ where: { id: taskId }, data: { status: "failed" } });
  } finally {
    if (browser) await browser.close();
  }
}

const worker = new Worker<ScanJobData>("scan-queue", processScan, {
  connection: redis,
});

worker.on("completed", (job: Job<ScanJobData>) => {
  console.log(`[WORKER] Job ${job.id} completed`);
});

worker.on("failed", (job: Job<ScanJobData> | undefined, err: Error) => {
  console.error(`[WORKER] Job ${job?.id ?? "unknown"} failed:`, err.message);
});

console.log("[WORKER] Listening on scan-queue...");
