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
      description: "Click a CSS selector and wait for the page to update. Use this to expand collapsed menus or navigate.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector to click" },
          description: { type: "string", description: "What this element is (e.g. 'expand sidebar menu')" },
        },
        required: ["selector", "description"],
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
                label: { type: "string", description: "Display name of the menu item" },
                selector: { type: "string", description: "CSS selector to click this menu item" },
                description: { type: "string", description: "Brief description of what this module does" },
              },
              required: ["id", "label", "selector", "description"],
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

async function callApi(messages: Message[]): Promise<AssistantMessage> {
  const { url, key, model } = getApiConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
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
      throw new Error(`API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as ChatResponse;
    return data.choices[0].message;
  } finally {
    clearTimeout(timeout);
  }
}

/** Wait for user to select menu items via Redis key. Returns selected item IDs (empty = skip). */
async function waitForMenuSelection(taskId: string): Promise<string[]> {
  const redisClient = createRedisClient();
  const key = `menu-select:${taskId}`;
  try {
    // Poll up to 10 minutes (300 x 2s)
    for (let i = 0; i < 300; i++) {
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
    let parsed: { selector?: string; description?: string };
    try {
      parsed = JSON.parse(args) as { selector?: string; description?: string };
    } catch {
      return { result: "Error: invalid arguments" };
    }
    const selector = parsed.selector ?? "";
    try {
      await page.click(selector, { timeout: 5000 });
      // SPA: wait for network idle after click, fallback to 3s timeout
      try {
        await page.waitForLoadState("networkidle", { timeout: 5000 });
      } catch {
        await page.waitForTimeout(2000);
      }
      const dom = await page.evaluate(() => document.body.innerText.slice(0, 4000));
      return { result: `Clicked "${parsed.description ?? selector}". Updated DOM:\n${dom}` };
    } catch {
      return { result: `Error: selector "${selector}" not found or not clickable` };
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
   - Use the selector of the parent item, not its children.
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
      stepCount++;
      const assistant = await callApi(messages);
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
    const selectedIds = await waitForMenuSelection(taskId);

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
          await page.click(item.selector, { timeout: 5000 });
          clicked = true;
        } catch {
          // Selector not found after reset — SPA menu is collapsed.
          // Try expanding parent menus by clicking any collapsed sub-menu toggle.
          await publishEvent(makeLogEvent("warn", `[${item.label}] Selector not found after reset, attempting parent menu expansion...`));
          try {
            // Click the first collapsed sub-menu parent visible in the sidebar
            await page.click(
              '[class*="sub-menu"]:not([class*="is-opened"]), [class*="el-sub-menu"]:not([class*="is-opened"]), [class*="submenu"]:not([aria-expanded="true"])',
              { timeout: 3000 },
            );
            await page.waitForTimeout(1000);
            await page.click(item.selector, { timeout: 5000 });
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
  - "text": display label
  - "href": if non-empty, this is a NAVIGABLE LINK — use click_element to visit it
  - "hasChildren": if true, this is an EXPANDABLE PARENT MENU — use click_element to expand it first, then call read_dom again to see the children
  - "isExpanded": "true" means already expanded, "false" or null means collapsed
  - "selector": CSS selector to use with click_element

Your job:
1. Call read_dom to see the current state.
2. For each item in NAV STRUCTURE:
   - If hasChildren=true and isExpanded≠"true": call click_element to expand it, then read_dom again
   - If href is non-empty: call click_element to navigate to it, then read_dom to capture the page
3. Continue until all sub-pages and sub-sections are explored.
4. When done, stop calling tools and give a brief security summary.`,
          },
        ];

        let moduleStep = 0;
        const maxModuleSteps = 15;

        while (moduleStep < maxModuleSteps) {
          moduleStep++;
          const assistant = await callApi(moduleMessages);
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
