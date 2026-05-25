import type { Page } from "playwright";
import { v4 as uuidv4 } from "uuid";
import { createRedisClient } from "../lib/redis";
import type { LogEntry, CaptchaType } from "../lib/types";

function makeLogEvent(level: LogEntry["level"], message: string): object {
  return {
    type: "LOG",
    data: {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      tag: "CAPTCHA",
      message,
    } satisfies LogEntry,
  };
}

function getApiConfig(): { url: string; key: string; model: string } {
  return {
    url: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1") + "/chat/completions",
    key: process.env.OPENAI_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "gpt-4o-mini",
  };
}

type VisionResponse = {
  choices: Array<{ message: { content: string | null } }>;
};

async function recognizeImageCaptcha(base64: string): Promise<string> {
  const { url, key, model } = getApiConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 32,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "What characters are shown in this captcha image? Reply with only the characters, no spaces, no punctuation.",
              },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${base64}` },
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Vision API error ${res.status}`);
    const data = (await res.json()) as VisionResponse;
    return (data.choices[0]?.message.content ?? "").trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function pollRedisKey(key: string, timeoutMs: number): Promise<string | null> {
  const client = createRedisClient();
  const intervalMs = 2000;
  const maxAttempts = Math.ceil(timeoutMs / intervalMs);
  try {
    for (let i = 0; i < maxAttempts; i++) {
      const val = await client.get(key);
      if (val !== null) {
        await client.del(key);
        return val;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
  } finally {
    await client.quit();
  }
}

async function detectCaptchaType(page: Page): Promise<CaptchaType | null> {
  return page.evaluate((): CaptchaType | null => {
    const has = (selector: string) => document.querySelector(selector) !== null;

    if (
      has('img[src*="captcha"]') ||
      has('img[src*="verify"]') ||
      has('canvas[class*="captcha"]')
    ) return "image";

    if (
      has('[class*="slide-verify"]') ||
      has('[class*="sliderContainer"]') ||
      has('[class*="nc-lang-cnt"]') ||
      has('.nc_iconfont.btn_slide')
    ) return "slider";

    // A captcha code input must be explicitly labeled as a verification code —
    // NOT a password field, NOT a generic username/email field.
    // Require placeholder or name to contain 验证码 or "captcha" (not just "code")
    // to avoid matching login username fields named "code" or "account".
    const captchaCodeInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[placeholder*="验证码"], input[name*="captcha"], input[id*="captcha"], ' +
        'input[placeholder*="captcha"], input[placeholder*="Captcha"], ' +
        'input[placeholder*="verification"], input[placeholder*="Verification"]'
      )
    ).filter((el) => el.type !== "password");

    if (captchaCodeInputs.length === 0) return null;

    // Only classify as sms/email if there's ALSO a phone/email input on the same form
    // AND no password input (a login form with phone+password is NOT an SMS captcha)
    const hasPassword = has('input[type="password"]');

    if (!hasPassword) {
      if (has('input[type="tel"], input[name*="phone"], input[name*="mobile"], input[placeholder*="手机"]')) {
        return "sms";
      }
      if (has('input[type="email"], input[name*="email"], input[placeholder*="邮箱"]')) {
        return "email";
      }
    }

    return "unknown";
  });
}

async function handleImageCaptcha(
  page: Page,
  taskId: string,
  publishEvent: (e: object) => Promise<void>,
): Promise<boolean> {
  const CAPTCHA_IMG_SELECTOR = 'img[src*="captcha"], img[src*="verify"], canvas[class*="captcha"]';
  const CODE_INPUT_SELECTOR = 'input[placeholder*="验证码"], input[placeholder*="code"], input[name*="captcha"], input[id*="captcha"]';

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const el = page.locator(CAPTCHA_IMG_SELECTOR).first();
      const screenshotBuf = await el.screenshot({ timeout: 5000 });
      const base64 = screenshotBuf.toString("base64");

      await publishEvent(makeLogEvent("info", `Image captcha detected, attempt ${attempt}/3 — calling AI Vision...`));
      const code = await recognizeImageCaptcha(base64);

      if (!code) {
        await publishEvent(makeLogEvent("warn", `AI Vision returned empty result on attempt ${attempt}`));
        continue;
      }

      await publishEvent(makeLogEvent("info", `AI Vision result: "${code}" — filling captcha input`));
      await page.fill(CODE_INPUT_SELECTOR, code);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2000);

      // Check if captcha input is gone (success) or still present (failure)
      const stillPresent = await page.locator(CODE_INPUT_SELECTOR).count();
      if (stillPresent === 0) {
        await publishEvent(makeLogEvent("info", "Image captcha solved automatically"));
        return true;
      }
      await publishEvent(makeLogEvent("warn", `Captcha still present after attempt ${attempt}, retrying...`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await publishEvent(makeLogEvent("warn", `Image captcha attempt ${attempt} error: ${msg}`));
    }
  }

  // All auto retries failed — fall back to human
  await publishEvent(makeLogEvent("warn", "Auto captcha solving failed after 3 attempts — requesting human input"));
  try {
    const el = page.locator(CAPTCHA_IMG_SELECTOR).first();
    const buf = await el.screenshot({ timeout: 3000 });
    const b64 = buf.toString("base64");
    await publishEvent({
      type: "AUTH_REQUIRED",
      data: { pageUrl: page.url(), captchaType: "image", captchaImageBase64: b64 },
    });
  } catch {
    await publishEvent({
      type: "AUTH_REQUIRED",
      data: { pageUrl: page.url(), captchaType: "image" },
    });
  }

  const code = await pollRedisKey(`captcha:${taskId}`, 5 * 60 * 1000);
  if (code) {
    try {
      await page.fill(CODE_INPUT_SELECTOR, code);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);
    } catch {
      // best effort
    }
  }
  return true;
}

async function handleSliderCaptcha(
  page: Page,
  publishEvent: (e: object) => Promise<void>,
): Promise<boolean> {
  const HANDLE_SELECTOR =
    '[class*="slide-verify-slider-mask"], [class*="handler"], .nc_iconfont.btn_slide, [class*="slider-btn"], [class*="drag-btn"]';
  const TRACK_SELECTOR =
    '[class*="slide-verify-slider"], [class*="slider-track"], [class*="nc-lang-cnt"]';

  try {
    const handle = page.locator(HANDLE_SELECTOR).first();
    const track = page.locator(TRACK_SELECTOR).first();

    const handleBox = await handle.boundingBox({ timeout: 5000 });
    const trackBox = await track.boundingBox({ timeout: 5000 });

    if (!handleBox || !trackBox) {
      await publishEvent(makeLogEvent("warn", "Slider handle/track bounding box not found"));
      return false;
    }

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const endX = trackBox.x + trackBox.width - handleBox.width / 2;
    const totalDistance = endX - startX;
    const steps = 15;

    await publishEvent(makeLogEvent("info", `Simulating slider drag (${Math.round(totalDistance)}px across ${steps} steps)`));

    await page.mouse.move(startX, startY);
    await page.mouse.down();

    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      // Ease-in-out curve for natural feel
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const x = startX + totalDistance * eased;
      const yJitter = (Math.random() - 0.5) * 4; // ±2px
      await page.mouse.move(x, startY + yJitter);
      await new Promise<void>((resolve) =>
        setTimeout(resolve, 20 + Math.floor(Math.random() * 40))
      );
    }

    await page.mouse.up();
    await page.waitForTimeout(1500);

    await publishEvent(makeLogEvent("info", "Slider drag complete"));
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await publishEvent(makeLogEvent("warn", `Slider handling error: ${msg}`));
    return false;
  }
}

async function handleCodeCaptcha(
  page: Page,
  taskId: string,
  captchaType: CaptchaType,
  publishEvent: (e: object) => Promise<void>,
): Promise<boolean> {
  const CODE_INPUT_SELECTOR =
    'input[placeholder*="验证码"], input[placeholder*="code"], input[name*="code"], input[id*="captcha"], input[name*="captcha"]';

  // Try to grab a captcha image if present
  let captchaImageBase64: string | undefined;
  try {
    const imgEl = page.locator('img[src*="captcha"], img[src*="verify"]').first();
    const count = await imgEl.count();
    if (count > 0) {
      const buf = await imgEl.screenshot({ timeout: 3000 });
      captchaImageBase64 = buf.toString("base64");
    }
  } catch {
    // no image — that's fine
  }

  await publishEvent({
    type: "AUTH_REQUIRED",
    data: {
      pageUrl: page.url(),
      captchaType,
      ...(captchaImageBase64 !== undefined ? { captchaImageBase64 } : {}),
    },
  });

  const label = captchaType === "sms" ? "SMS" : captchaType === "email" ? "email" : "captcha";
  await publishEvent(makeLogEvent("info", `Waiting for human to submit ${label} code (up to 5 min)...`));

  const code = await pollRedisKey(`captcha:${taskId}`, 5 * 60 * 1000);
  if (!code) {
    await publishEvent(makeLogEvent("warn", `Timed out waiting for ${label} code`));
    return false;
  }

  try {
    await page.fill(CODE_INPUT_SELECTOR, code);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    await publishEvent(makeLogEvent("info", `${label} code submitted`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await publishEvent(makeLogEvent("warn", `Failed to fill ${label} code: ${msg}`));
  }

  return true;
}

export async function detectAndHandleCaptcha(
  page: Page,
  taskId: string,
  publishEvent: (e: object) => Promise<void>,
): Promise<{ handled: boolean; captchaType: CaptchaType }> {
  const captchaType = await detectCaptchaType(page);

  if (captchaType === null) {
    return { handled: false, captchaType: "unknown" };
  }

  await publishEvent(makeLogEvent("info", `Captcha detected: type="${captchaType}"`));

  switch (captchaType) {
    case "image": {
      const handled = await handleImageCaptcha(page, taskId, publishEvent);
      return { handled, captchaType };
    }
    case "slider": {
      const handled = await handleSliderCaptcha(page, publishEvent);
      return { handled, captchaType };
    }
    case "sms":
    case "email":
    case "unknown": {
      const handled = await handleCodeCaptcha(page, taskId, captchaType, publishEvent);
      return { handled, captchaType };
    }
  }
}
