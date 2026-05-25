/**
 * Tier 1 — Structural Metadata Inspector
 *
 * Registers a Playwright response listener that inspects JSON API responses
 * for structural risk signals. It NEVER reads or forwards response body values —
 * only field names (JSON keys) and response metadata are collected.
 */

import type { Page } from "playwright";
import { v4 as uuidv4 } from "uuid";
import type { LogEntry } from "../lib/types";

/** Structural metadata extracted from a single JSON response. No values included. */
export type InterceptMeta = {
  responseUrl: string;
  httpStatus: number;
  contentType: string;
  /** Top-level JSON keys found in the response object/array items. No values. */
  fieldNames: string[];
  /** Which sensitive field name patterns were matched. */
  sensitiveFields: string[];
  /** Which PII category patterns were detected (by category name, not matched value). */
  piiCategories: string[];
};

const SENSITIVE_FIELD_NAMES = new Set([
  "password", "passwd", "token", "secret", "api_key", "apikey",
  "access_token", "refresh_token", "private_key", "credential",
  "credentials", "auth", "authorization", "ssn", "social_security",
  "credit_card", "card_number", "cvv", "pin",
]);

/**
 * PII category detectors — keyed by category name.
 * These run against the raw body text to detect the PRESENCE of a category,
 * but the matched value is never stored or forwarded.
 */
const PII_PATTERNS: Record<string, RegExp> = {
  email:       /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  phone_cn:    /1[3-9]\d{9}/,
  id_card_cn:  /\d{17}[\dXx]/,
  credit_card: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/,
};

/** Extract top-level keys from a parsed JSON value. Never recurses into values. */
function extractTopLevelKeys(parsed: unknown): string[] {
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return Object.keys(parsed as Record<string, unknown>);
  }
  if (Array.isArray(parsed) && parsed.length > 0) {
    const first = parsed[0];
    if (first !== null && typeof first === "object" && !Array.isArray(first)) {
      return Object.keys(first as Record<string, unknown>);
    }
  }
  return [];
}

function makeLogEvent(level: LogEntry["level"], message: string): object {
  return {
    type: "LOG",
    data: {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      tag: "INTERCEPTOR",
      message,
    } satisfies LogEntry,
  };
}

export function registerInterceptor(
  page: Page,
  onMatch: (meta: InterceptMeta) => Promise<void>,
  publishEvent: (event: object) => Promise<void>,
): void {
  page.on("response", (response) => {
    void (async () => {
      try {
        const contentType = response.headers()["content-type"] ?? "";
        if (!contentType.includes("application/json")) return;

        const httpStatus = response.status();
        const responseUrl = response.url();

        let body: string;
        try {
          body = await response.text();
        } catch {
          return;
        }

        let fieldNames: string[] = [];
        try {
          const parsed: unknown = JSON.parse(body);
          fieldNames = extractTopLevelKeys(parsed);
        } catch {
          return;
        }

        const sensitiveFields = fieldNames.filter(k =>
          SENSITIVE_FIELD_NAMES.has(k.toLowerCase()),
        );

        const piiCategories = Object.entries(PII_PATTERNS)
          .filter(([, pattern]) => pattern.test(body))
          .map(([category]) => category);

        if (sensitiveFields.length === 0 && piiCategories.length === 0) return;

        const meta: InterceptMeta = {
          responseUrl,
          httpStatus,
          contentType,
          fieldNames,
          sensitiveFields,
          piiCategories,
        };

        await onMatch(meta);
      } catch {
        // Never crash the worker
      }
    })();
  });

  void publishEvent({
    type: "TELEMETRY",
    data: { capability: "deepIntercepting", active: true },
  });

  void publishEvent(makeLogEvent("info", "Interceptor active. Monitoring all responses."));
}
