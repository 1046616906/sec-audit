import type { Page } from "playwright";
import { v4 as uuidv4 } from "uuid";
import type { LogEntry, MenuItem } from "../lib/types";
import { createRedisClient } from "../lib/redis";

// Read at call time, not at module load time, so dotenv has already run
function getApiConfig() {
  return {
    url: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1") + "/chat/completions",
    key: process.env.OPENAI_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "gpt-4o-mini",
  };
}

// OpenAI-compatible types for the manual loop
type AssistantMessage = { role: "assistant"; content: string | null; tool_calls?: ToolCall[] };
type ToolMessage = { role: "tool"; tool_call_id: string; content: string };
type UserMessage = { role: "user"; content: string };
type Message = UserMessage | AssistantMessage | ToolMessage;

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatResponse = {
  choices: Array<{
    message: AssistantMessage;
    finish_reason: string;
  }>;
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_dom",
      description: "Read the current page DOM as plain text (up to 4000 chars).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "click_element",
      description: "Click an element on the page. STRONGLY PREFER passing 'text' (the visible label) — text-based location is far more robust than CSS selectors against SPA re-renders. Use 'selector' only to disambiguate when multiple elements share the same text, or for elements without visible text.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The visible text/label of the element to click. ALWAYS pass this when the element has visible text." },
          selector: { type: "string", description: "Optional CSS selector — only as a disambiguator when multiple elements share the same text, or as fallback for icon-only elements. NEVER fabricate selectors with nth-child or positional indexes." },
          description: { type: "string", description: "What this element is (e.g. 'expand sidebar menu')" },
        },
        required: ["description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "report_menu_items",
      description: "Call this when you have identified the main navigation menu items. Report all discovered menu items so the user can choose which modules to scan.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description: "List of discovered menu/navigation items",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Unique identifier (use slugified label)" },
                label: { type: "string", description: "Display name of the menu item — this is the PRIMARY locator, must match the visible text exactly" },
                selector: { type: "string", description: "Optional CSS selector — only as a tie-breaker if multiple menu items share the same label. NEVER use nth-child or positional indexes." },
                description: { type: "string", description: "Brief description of what this module does" },
              },
              required: ["id", "label", "description"],
            },
          },
        },
        required: ["items"],
      },
    },
  },
];

function makeLogEvent(level: LogEntry["level"], message: string): object {
  return {
    type: "LOG",
    data: {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      tag: "AGENT",
      message,
    } satisfies LogEntry,
  };
}

async function callApi(messages: Message[], signal?: AbortSignal): Promise<AssistantMessage> {
  const { url, key, model } = getApiConfig();

  // Retry transient network/timeout failures. User cancellation propagates
  // through `signal` and bypasses the retry loop immediately.
  const MAX_ATTEMPTS = 3;
  const BACKOFFS_MS = [1000, 2000, 4000];
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error("cancelled");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: TOOLS,
          max_tokens: 2048,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        // 4xx (except 429) won't get better with retries — fail fast.
        const isRetryable = res.status === 429 || res.status >= 500;
        const err = new Error(`API error ${res.status}: ${body}`);
        if (!isRetryable) throw err;
        lastErr = err;
      } else {
        const data = (await res.json()) as ChatResponse;
        return data.choices[0].message;
      }
    } catch (err: unknown) {
      // External cancellation — surface immediately, don't retry.
      if (signal?.aborted) throw new Error("cancelled");
      lastErr = err;
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onExternalAbort);
    }

    // Backoff before next attempt (skip after the final failure).
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, BACKOFFS_MS[attempt]));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("LLM request failed after retries");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("cancelled");
}

/** Wait for user to select menu items via Redis key. Returns selected item IDs (empty = skip). */
async function waitForMenuSelection(taskId: string, signal?: AbortSignal): Promise<string[]> {
  const redisClient = createRedisClient();
  const key = `menu-select:${taskId}`;
  try {
    // Poll up to 10 minutes (300 x 2s)
    for (let i = 0; i < 300; i++) {
      throwIfAborted(signal);
      const raw = await redisClient.get(key);
      if (raw !== null) {
        await redisClient.del(key);
        return JSON.parse(raw) as string[];
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    }
    return []; // timeout — skip
  } finally {
    await redisClient.quit();
  }
}

async function handleAuthIfNeeded(
  page: Page,
  taskId: string,
  publishEvent: (event: object) => Promise<void>,
): Promise<void> {
  // Check for password input — the only reliable signal for a login page
  const passwordInputCount = await page.locator('input[type="password"]').count();
  if (passwordInputCount === 0) return;

  await publishEvent({ type: "AUTH_REQUIRED", data: { pageUrl: page.url(), captchaType: "unknown" } });
  await publishEvent({ type: "TELEMETRY", data: { capability: "autoLoginDetection", active: true } });

  const redisClient = createRedisClient();
  const redisKey = `auth:${taskId}`;

  try {
    let credentials: { username: string; password: string } | null = null;
    for (let attempt = 0; attempt < 150; attempt++) {
      const raw = await redisClient.get(redisKey);
      if (raw !== null) {
        credentials = JSON.parse(raw) as { username: string; password: string };
        await redisClient.del(redisKey);
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    }

    if (credentials !== null) {
      // Fill username — try common field patterns
      const usernameSelectors = [
        'input[name="username"]',
        'input[name="account"]',
        'input[name="loginName"]',
        'input[type="text"]:not([type="password"])',
        'input[type="email"]',
      ];
      for (const sel of usernameSelectors) {
        try {
          const count = await page.locator(sel).count();
          if (count > 0) {
            await page.fill(sel, credentials.username);
            break;
          }
        } catch { /* try next */ }
      }

      await page.fill('input[type="password"]', credentials.password);
      await page.keyboard.press("Enter");

      // Wait for navigation to complete after login
      try {
        await page.waitForURL((url) => !url.href.includes("login"), { waitUntil: "networkidle", timeout: 10000 });
      } catch {
        // URL didn't change or timeout — SPA may have updated in place
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() =>
          page.waitForTimeout(3000)
        );
      }
    }
  } finally {
    await redisClient.quit();
    await publishEvent({ type: "TELEMETRY", data: { capability: "autoLoginDetection", active: false } });
  }
}

async function executeTool(
  name: string,
  args: string,
  page: Page,
  taskId: string,
  publishEvent: (event: object) => Promise<void>,
): Promise<{ result: string; menuItems?: MenuItem[] }> {
  if (name === "read_dom") {
    // SPA: wait for network idle before reading DOM to ensure content is rendered
    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch {
      await page.waitForTimeout(1000);
    }

    // Extract both plain text AND structured nav info so AI can distinguish
    // expandable menus from navigable links
    const { bodyText, navStructure } = await page.evaluate(() => {
      const text = document.body.innerText.slice(0, 3000);

      // Extract nav/sidebar elements with their tag, text, href, and aria attributes.
      // CRITICAL: only include VISIBLE elements — hidden/collapsed children are excluded.
      const navElements = Array.from(
        document.querySelectorAll(
          'nav a, nav li, aside a, aside li, [class*="menu"] a, [class*="menu"] li, ' +
          '[class*="sidebar"] a, [class*="sidebar"] li, [class*="nav"] a, [class*="nav"] li, ' +
          '[role="navigation"] a, [role="menuitem"], [role="treeitem"]'
        )
      ).filter((el) => {
        // Filter out elements that are not visible in the viewport
        const htmlEl = el as HTMLElement;
        if (htmlEl.offsetWidth === 0 && htmlEl.offsetHeight === 0) return false;
        if (htmlEl.offsetParent === null) return false;
        const style = window.getComputedStyle(htmlEl);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        return true;
      }).slice(0, 60).map((el) => {
        const tag = el.tagName.toLowerCase();
        const text = (el as HTMLElement).innerText?.trim().slice(0, 50) ?? "";
        const href = (el as HTMLAnchorElement).href ?? "";
        const hasChildren = el.querySelector("ul, ol, [class*='sub'], [class*='child']") !== null;
        const isExpanded = el.getAttribute("aria-expanded");
        const classes = el.className?.toString().slice(0, 80) ?? "";
        // Build a unique CSS selector
        const id = el.id ? `#${el.id}` : "";
        const selector = id || `.${classes.split(" ").filter(Boolean).slice(0, 2).join(".")}` || tag;
        return { tag, text, href, hasChildren, isExpanded, selector };
      }).filter(item => item.text.length > 0);

      return { bodyText: text, navStructure: JSON.stringify(navElements) };
    });

    await handleAuthIfNeeded(page, taskId, publishEvent);

    return {
      result: `PAGE TEXT:\n${bodyText}\n\nNAV STRUCTURE (use these selectors):\n${navStructure}`,
    };
  }

  if (name === "click_element") {
    let parsed: { text?: string; selector?: string; description?: string };
    try {
      parsed = JSON.parse(args) as { text?: string; selector?: string; description?: string };
    } catch {
      return { result: "Error: invalid arguments" };
    }
    const text = parsed.text?.trim() ?? "";
    const selector = parsed.selector?.trim() ?? "";
    const desc = parsed.description ?? text ?? selector;

    if (!text && !selector) {
      return { result: "Error: must provide at least 'text' or 'selector'" };
    }

    try {
      // Locate the element with text-first strategy:
      // 1. text only           → getByText (exact-ish, then loose)
      // 2. text + selector     → locator(selector).filter({ hasText: text }) for disambiguation
      // 3. selector only       → locator(selector) — fallback for icon-only elements
      let locator;
      if (text && selector) {
        locator = page.locator(selector).filter({ hasText: text }).first();
      } else if (text) {
        // Try exact match first; if zero matches, fall back to substring match
        const exact = page.getByText(text, { exact: true }).first();
        if ((await exact.count()) > 0) {
          locator = exact;
        } else {
          locator = page.getByText(text, { exact: false }).first();
        }
      } else {
        locator = page.locator(selector).first();
      }

      await locator.click({ timeout: 5000 });

      // SPA: wait for network idle after click, fallback to 2s timeout
      try {
        await page.waitForLoadState("networkidle", { timeout: 5000 });
      } catch {
        await page.waitForTimeout(2000);
      }
      const dom = await page.evaluate(() => document.body.innerText.slice(0, 4000));
      return { result: `Clicked "${desc}". Updated DOM:\n${dom}` };
    } catch {
      const what = text ? `text "${text}"` : `selector "${selector}"`;
      return { result: `Error: ${what} not found or not clickable` };
    }
  }

  if (name === "report_menu_items") {
    let parsed: { items?: MenuItem[] };
    try {
      parsed = JSON.parse(args) as { items?: MenuItem[] };
    } catch {
      return { result: "Error: invalid arguments" };
    }
    const items = parsed.items ?? [];
    return { result: `Reported ${items.length} menu items.`, menuItems: items };
  }

  return { result: `Error: unknown tool "${name}"` };
}

export async function runAgent(
  page: Page,
  taskId: string,
  publishEvent: (event: object) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  await publishEvent({ type: "TELEMETRY", data: { capability: "aiDomParsing", active: true } });

  const messages: Message[] = [
    {
      role: "user",
      content: `You are a security auditing agent for task ${taskId}.

Your ONLY job right now is to identify the top-level navigation menu items and report them.

STRICT INSTRUCTIONS:
1. Call read_dom to read the current page.
2. Find the MAIN NAVIGATION — typically a left sidebar or top nav bar with the app's major modules.
   - IGNORE: user avatar, logout, language switcher, notification bell, breadcrumbs.
   - LOOK FOR: sidebar items, top-level tabs representing major functional areas.
3. Call report_menu_items with the TOP-LEVEL visible items ONLY.
   - Do NOT expand collapsed sub-menus.
   - Do NOT recurse into children.
   - If a menu item has children (hasChildren=true), report the PARENT item itself — the user will decide whether to scan it.
   - The "label" field MUST match the visible menu text exactly — it will be used for text-based location.
   - Only include "selector" if multiple menus share the same label and you need to disambiguate.
   - NEVER use nth-child, nth-of-type, or any positional CSS indexes — they break on SPA re-renders.
4. If the page has no navigation at all (e.g. a plain login form), stop without calling report_menu_items.

You MUST use tools. Do not respond with plain text.`,
    },
  ];

  try {
    // Pre-flight: handle login/captcha BEFORE starting the AI loop
    // so the AI always sees the post-login page on its first read_dom call.
    await handleAuthIfNeeded(page, taskId, publishEvent);

    // Phase 1: discover menus and report them
    let menuItems: MenuItem[] | null = null;
    let stepCount = 0;

    while (menuItems === null) {
      throwIfAborted(signal);
      stepCount++;
      const assistant = await callApi(messages, signal);
      messages.push(assistant);

      if (!assistant.tool_calls || assistant.tool_calls.length === 0) {
        if (stepCount >= 4) {
          // AI gave text twice without calling tools — truly no menu
          await publishEvent(makeLogEvent("info",
            assistant.content
              ? `Analysis: ${assistant.content.slice(0, 300)}`
              : "No navigation menu found. Interceptor will monitor API responses."
          ));
          return;
        }
        // First time — force it to use tools
        messages.push({
          role: "user",
          content: "You must use the tools provided. Call read_dom first, then report_menu_items if you find any navigation. Do not respond with plain text.",
        });
        continue;
      }

      for (const tc of assistant.tool_calls) {
        const { result, menuItems: discovered } = await executeTool(
          tc.function.name, tc.function.arguments, page, taskId, publishEvent,
        );

        await publishEvent(makeLogEvent("info", `[${tc.function.name}] ${result.slice(0, 150)}`));
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });

        if (discovered && discovered.length > 0) {
          menuItems = discovered;
          // Publish MENU_DISCOVERED and pause for user selection
          await publishEvent({ type: "MENU_DISCOVERED", data: { items: discovered } });
          await publishEvent(makeLogEvent("info", `Discovered ${discovered.length} menu modules. Waiting for user selection...`));
        }
      }

      // Safety: if agent keeps looping without finding menus after 5 steps, move on
      if (stepCount >= 6 && menuItems === null) {
        await publishEvent(makeLogEvent("info", "No navigation menu detected after exploration. Interceptor will monitor API responses."));
        return;
      }
    }

    // Phase 2: wait for user to select modules
    const selectedIds = await waitForMenuSelection(taskId, signal);

    if (selectedIds.length === 0) {
      await publishEvent(makeLogEvent("info", "User skipped module selection. Scan complete."));
      return;
    }

    const selectedItems = menuItems.filter((m) => selectedIds.includes(m.id));

    // Deduplicate: if both a parent and its child are selected, keep only the parent
    // (the parent scan will cover the child automatically via deep exploration)
    const deduped = selectedItems.filter((item) => {
      // Keep item unless another selected item's selector is a prefix of this one
      // (simple heuristic: if item.id contains another item's id as prefix, it's a child)
      return !selectedItems.some(
        (other) => other.id !== item.id && item.id.startsWith(other.id + "-")
      );
    });

    if (deduped.length < selectedItems.length) {
      await publishEvent(makeLogEvent("info",
        `Deduplicated selection: ${selectedItems.length} → ${deduped.length} modules (child modules covered by parent scan)`
      ));
    }

    await publishEvent(makeLogEvent("info", `Scanning ${deduped.length} modules: ${deduped.map((m) => m.label).join(", ")}`));

    // Phase 3: deep-scan each selected module
    const initialUrl = page.url();

    for (const item of deduped) {
      throwIfAborted(signal);
      await publishEvent(makeLogEvent("info", `▶ Entering module: ${item.label}`));

      // Push sitemap node for this module
      await publishEvent({
        type: "SITEMAP",
        data: {
          node: {
            id: `module-${item.id}`,
            url: page.url(),
            label: item.label,
            explored: false,
            children: [],
          },
        },
      });

      try {
        // Navigate back to initial page before each module to reset SPA state
        // so previously recorded selectors are valid again
        if (page.url() !== initialUrl) {
          await page.goto(initialUrl, { waitUntil: "networkidle" }).catch(() =>
            page.waitForTimeout(2000)
          );
        }

        // Extra settle time for SPA menus to re-render after navigation reset
        await page.waitForTimeout(1000);

        let clicked = false;
        try {
          // Text-first: locate menu by visible label, fall back to selector only if needed
          const textLocator = page.getByText(item.label, { exact: true }).first();
          if ((await textLocator.count()) > 0) {
            await textLocator.click({ timeout: 5000 });
            clicked = true;
          } else if (item.selector) {
            await page.click(item.selector, { timeout: 5000 });
            clicked = true;
          } else {
            // Loose text match as last resort
            await page.getByText(item.label, { exact: false }).first().click({ timeout: 5000 });
            clicked = true;
          }
        } catch {
          // Selector / text not found after reset — SPA menu is collapsed.
          // Try expanding parent menus by clicking any collapsed sub-menu toggle.
          await publishEvent(makeLogEvent("warn", `[${item.label}] Not found after reset, attempting parent menu expansion...`));
          try {
            // Click the first collapsed sub-menu parent visible in the sidebar
            await page.click(
              '[class*="sub-menu"]:not([class*="is-opened"]), [class*="el-sub-menu"]:not([class*="is-opened"]), [class*="submenu"]:not([aria-expanded="true"])',
              { timeout: 3000 },
            );
            await page.waitForTimeout(1000);
            // Retry text-first after expansion
            const retry = page.getByText(item.label, { exact: true }).first();
            if ((await retry.count()) > 0) {
              await retry.click({ timeout: 5000 });
            } else if (item.selector) {
              await page.click(item.selector, { timeout: 5000 });
            } else {
              await page.getByText(item.label, { exact: false }).first().click({ timeout: 5000 });
            }
            clicked = true;
          } catch {
            await publishEvent(makeLogEvent("warn", `[${item.label}] Could not navigate to module — skipping.`));
          }
        }

        if (!clicked) continue;
        try {
          await page.waitForLoadState("networkidle", { timeout: 5000 });
        } catch {
          await page.waitForTimeout(2000);
        }

        // Screenshot after entering module
        const screenshot = await page.screenshot({ type: "png" });
        await publishEvent({ type: "FRAME", data: { base64: screenshot.toString("base64") } });

        // Mark sitemap node as explored
        await publishEvent({
          type: "SITEMAP",
          data: {
            node: {
              id: `module-${item.id}`,
              url: page.url(),
              label: item.label,
              explored: true,
              children: [],
            },
          },
        });

        // Deep exploration loop for this module — AI explores sub-pages autonomously
        const moduleMessages: Message[] = [
          {
            role: "user",
            content: `You are now inside the "${item.label}" module (${item.description}).

read_dom returns two sections:
- PAGE TEXT: visible text content
- NAV STRUCTURE: JSON array of nav elements with fields:
  - "text": display label — THIS IS YOUR PRIMARY LOCATOR. Pass it as the "text" arg to click_element.
  - "href": if non-empty, this is a NAVIGABLE LINK — click it via its text
  - "hasChildren": if true, this is an EXPANDABLE PARENT MENU — click it to expand, then read_dom again
  - "isExpanded": "true" means already expanded, "false" or null means collapsed
  - "selector": only use this as a tie-breaker when multiple items share the same text

CLICK RULES (critical):
- ALWAYS pass the "text" argument to click_element — it is far more reliable than CSS selectors against SPA re-renders.
- Only pass "selector" in addition to "text" when multiple elements share the same visible text.
- NEVER fabricate selectors with nth-child, nth-of-type, or positional indexes — they will fail.

Your job:
1. Call read_dom to see the current state.
2. For each item in NAV STRUCTURE:
   - If hasChildren=true and isExpanded≠"true": click_element with its text to expand it, then read_dom again
   - If href is non-empty: click_element with its text to navigate to it, then read_dom to capture the page
3. Continue until all sub-pages and sub-sections are explored.
4. When done, stop calling tools and give a brief security summary.`,
          },
        ];

        let moduleStep = 0;
        const maxModuleSteps = 15;

        while (moduleStep < maxModuleSteps) {
          throwIfAborted(signal);
          moduleStep++;
          const assistant = await callApi(moduleMessages, signal);
          moduleMessages.push(assistant);

          if (!assistant.tool_calls || assistant.tool_calls.length === 0) {
            // AI finished exploring this module
            if (assistant.content) {
              await publishEvent(makeLogEvent("info", `[${item.label}] ${assistant.content.slice(0, 400)}`));
            }
            break;
          }

          for (const tc of assistant.tool_calls) {
            const { result } = await executeTool(tc.function.name, tc.function.arguments, page, taskId, publishEvent);
            await publishEvent(makeLogEvent("info", `[${item.label}] [${tc.function.name}] ${result.slice(0, 120)}`));
            moduleMessages.push({ role: "tool", tool_call_id: tc.id, content: result });

            // Push sitemap for any sub-page navigation
            if (tc.function.name === "click_element") {
              let parsedArgs: { description?: string } = {};
              try { parsedArgs = JSON.parse(tc.function.arguments) as { description?: string }; } catch { /* ignore */ }
              await publishEvent({
                type: "SITEMAP",
                data: {
                  node: {
                    id: `module-${item.id}-step-${moduleStep}`,
                    url: page.url(),
                    label: `${item.label} › ${parsedArgs.description ?? "sub-page"}`,
                    explored: true,
                    children: [],
                  },
                },
              });
              // Screenshot after each navigation
              try {
                const subScreenshot = await page.screenshot({ type: "png" });
                await publishEvent({ type: "FRAME", data: { base64: subScreenshot.toString("base64") } });
              } catch { /* page may be transitioning */ }
            }
          }
        }

        if (moduleStep >= maxModuleSteps) {
          await publishEvent(makeLogEvent("info", `[${item.label}] Reached max exploration steps.`));
        }

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await publishEvent(makeLogEvent("warn", `Failed to scan module "${item.label}": ${msg}`));
      }
    }

    await publishEvent(makeLogEvent("info", `Completed scanning ${deduped.length} modules.`));

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error in agent";
    await publishEvent(makeLogEvent("error", `Agent failed for task ${taskId}: ${message}`));
    throw err;
  } finally {
    await publishEvent({ type: "TELEMETRY", data: { capability: "aiDomParsing", active: false } });
  }
}
