/**
 * Tier 2 — AI Structural Risk Analyzer
 *
 * Receives only structural metadata (field names, PII categories, URL path)
 * from the Tier 1 interceptor — never raw response values or body content.
 */

import { v4 as uuidv4 } from "uuid";
import { db } from "../lib/db";
import type { LogEntry, RiskEntry } from "../lib/types";
import type { InterceptMeta } from "./interceptor";

function getApiConfig() {
  return {
    url: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1") + "/chat/completions",
    key: process.env.OPENAI_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "gpt-4o-mini",
  };
}

type AiAnalysisResult = {
  isRisk: boolean;
  field: string;
  riskLevel: RiskEntry["riskLevel"];
  reasoning: string;
  confidence: number;
};

function makeLogEvent(level: LogEntry["level"], message: string): object {
  return {
    type: "LOG",
    data: {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      tag: "ANALYZER",
      message,
    } satisfies LogEntry,
  };
}

async function callApi(prompt: string): Promise<string> {
  const { url, key, model } = getApiConfig();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  type ChatResponse = { choices: Array<{ message: { content: string } }> };
  const data = (await res.json()) as ChatResponse;
  return data.choices[0].message.content;
}

export async function analyzeMetadata(
  meta: InterceptMeta,
  taskId: string,
  publishEvent: (event: object) => Promise<void>,
): Promise<void> {
  const schemaDescription = [
    `Endpoint URL: ${meta.responseUrl}`,
    `HTTP status: ${meta.httpStatus}`,
    `Content-Type: ${meta.contentType}`,
    `All top-level JSON field names returned: [${meta.fieldNames.join(", ")}]`,
    meta.sensitiveFields.length > 0
      ? `Field names matching sensitive patterns: [${meta.sensitiveFields.join(", ")}]`
      : null,
    meta.piiCategories.length > 0
      ? `PII category patterns detected in response body (values not captured): [${meta.piiCategories.join(", ")}]`
      : null,
  ].filter(Boolean).join("\n");

  let result: AiAnalysisResult;

  try {
    const text = await callApi(
      `You are a security architect reviewing the STRUCTURE of an internal API endpoint — not its data values.

Based solely on the schema metadata below, determine whether this endpoint has an architectural security risk (e.g. returning sensitive field names in its response schema, exposing credential fields, leaking PII field names).

${schemaDescription}

Respond with ONLY a valid JSON object (no markdown, no code fences) with exactly these fields:
- "isRisk": boolean — true if there is an architectural security concern
- "field": string — the most concerning field name (empty string if no risk)
- "riskLevel": one of "critical" | "high" | "medium" | "low"
- "reasoning": string — concise explanation referencing only field names and endpoint structure, never values
- "confidence": number between 0 and 1

Example: {"isRisk":true,"field":"password","riskLevel":"critical","reasoning":"Endpoint returns a field named 'password' in its response schema. Credentials should never appear in API responses.","confidence":0.95}`,
    );

    // Strip markdown fences if present
    const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    result = JSON.parse(cleaned) as AiAnalysisResult;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown AI/parse error";
    await publishEvent(makeLogEvent("error", `Analyzer failed for ${meta.responseUrl}: ${message}`));
    return;
  }

  if (!result.isRisk) return;

  const id = uuidv4();

  try {
    await db.vulnerability.create({
      data: {
        id,
        taskId,
        url: meta.responseUrl,
        field: result.field,
        riskLevel: result.riskLevel,
        reasoning: result.reasoning,
        confidence: result.confidence,
        rawData: JSON.stringify({
          fieldNames: meta.fieldNames,
          sensitiveFields: meta.sensitiveFields,
          piiCategories: meta.piiCategories,
          httpStatus: meta.httpStatus,
        }),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    await publishEvent(makeLogEvent("error", `DB write failed for ${meta.responseUrl}: ${message}`));
    return;
  }

  await publishEvent({
    type: "RISK",
    data: {
      id,
      url: meta.responseUrl,
      field: result.field,
      riskLevel: result.riskLevel,
      reasoning: result.reasoning,
      confidence: result.confidence,
    } satisfies RiskEntry,
  });
}
