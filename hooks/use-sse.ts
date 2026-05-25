'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import type { LogEntry, RiskEntry, TelemetryStatus, SitemapNode, MenuItem, AuthRequiredEvent } from '@/lib/types';

type SSEMessage =
  | { type: 'LOG'; data: LogEntry }
  | { type: 'RISK'; data: RiskEntry }
  | { type: 'FRAME'; data: { base64: string } }
  | { type: 'TELEMETRY'; data: Partial<TelemetryStatus> }
  | { type: 'SITEMAP'; data: { node: SitemapNode } }
  | { type: 'SCAN_DONE'; data: Record<string, never> }
  | { type: 'AUTH_REQUIRED'; data: AuthRequiredEvent }
  | { type: 'MENU_DISCOVERED'; data: { items: MenuItem[] } };

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
    const es = new EventSource('/api/events');

    es.onmessage = (event: MessageEvent<string>) => {
      let msg: SSEMessage;
      try {
        msg = JSON.parse(event.data) as SSEMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'LOG':
          addLog(msg.data);
          break;
        case 'RISK':
          addRisk(msg.data);
          break;
        case 'FRAME':
          setLiveFrame(msg.data.base64);
          break;
        case 'TELEMETRY':
          setTelemetry(msg.data);
          break;
        case 'SITEMAP':
          upsertSitemapNode(msg.data.node);
          break;
        case 'SCAN_DONE':
          setScanStatus('done');
          break;
        case 'AUTH_REQUIRED':
          setScanStatus('paused');
          setAuthPageUrl(msg.data.pageUrl);
          setCaptchaType(msg.data.captchaType);
          setCaptchaImageBase64(msg.data.captchaImageBase64 ?? null);
          break;
        case 'MENU_DISCOVERED':
          setMenuItems(msg.data.items);
          setScanStatus('menu_select');
          break;
      }
    };

    return () => {
      es.close();
    };
  }, [addLog, addRisk, setLiveFrame, setTelemetry, upsertSitemapNode, setScanStatus, setAuthPageUrl, setMenuItems, setCaptchaType, setCaptchaImageBase64]);
}
