'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import type { LogEntry, RiskEntry, TelemetryStatus, SitemapNode, MenuItem, AuthRequiredEvent } from '@/lib/types';

/** Every event emitted by the worker is tagged with taskId. */
type SSEMessage =
  | { type: 'LOG'; taskId: string; data: LogEntry }
  | { type: 'RISK'; taskId: string; data: RiskEntry }
  | { type: 'FRAME'; taskId: string; data: { base64: string } }
  | { type: 'TELEMETRY'; taskId: string; data: Partial<TelemetryStatus> }
  | { type: 'SITEMAP'; taskId: string; data: { node: SitemapNode } }
  | { type: 'SCAN_DONE'; taskId: string; data: Record<string, never> }
  | { type: 'AUTH_REQUIRED'; taskId: string; data: AuthRequiredEvent }
  | { type: 'MENU_DISCOVERED'; taskId: string; data: { items: MenuItem[] } };

export function useSSE(): void {
  const addLog = useStore((s) => s.addLog);
  const addRisk = useStore((s) => s.addRisk);
  const setLiveFrame = useStore((s) => s.setLiveFrame);
  const setTelemetry = useStore((s) => s.setTelemetry);
  const upsertSitemapNode = useStore((s) => s.upsertSitemapNode);
  const setScanStatus = useStore((s) => s.setScanStatus);
  const setAuthPageUrl = useStore((s) => s.setAuthPageUrl);
  const setMenuItems = useStore((s) => s.setMenuItems);
  const setCaptchaType = useStore((s) => s.setCaptchaType);
  const setCaptchaImageBase64 = useStore((s) => s.setCaptchaImageBase64);

  useEffect(() => {
    // No taskId param → receive the firehose; we route per-event by taskId.
    const es = new EventSource('/api/events');

    es.onmessage = (event: MessageEvent<string>) => {
      let msg: SSEMessage;
      try {
        msg = JSON.parse(event.data) as SSEMessage;
      } catch {
        return;
      }

      const taskId = msg.taskId;
      if (typeof taskId !== 'string' || !taskId) return; // legacy/untagged event — drop

      switch (msg.type) {
        case 'LOG':
          addLog(taskId, msg.data);
          break;
        case 'RISK':
          addRisk(taskId, msg.data);
          break;
        case 'FRAME':
          setLiveFrame(taskId, msg.data.base64);
          break;
        case 'TELEMETRY':
          setTelemetry(taskId, msg.data);
          break;
        case 'SITEMAP':
          upsertSitemapNode(taskId, msg.data.node);
          break;
        case 'SCAN_DONE':
          setScanStatus(taskId, 'done');
          break;
        case 'AUTH_REQUIRED':
          setScanStatus(taskId, 'paused');
          setAuthPageUrl(taskId, msg.data.pageUrl);
          setCaptchaType(taskId, msg.data.captchaType);
          setCaptchaImageBase64(taskId, msg.data.captchaImageBase64 ?? null);
          break;
        case 'MENU_DISCOVERED':
          setMenuItems(taskId, msg.data.items);
          setScanStatus(taskId, 'menu_select');
          break;
      }
    };

    return () => {
      es.close();
    };
  }, [addLog, addRisk, setLiveFrame, setTelemetry, upsertSitemapNode, setScanStatus, setAuthPageUrl, setMenuItems, setCaptchaType, setCaptchaImageBase64]);
}
