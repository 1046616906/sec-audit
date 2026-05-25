'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import '@/lib/store';
import { useSSE } from '@/hooks/use-sse';
import { useStore } from '@/lib/store';
import type { ScanStatus } from '@/lib/types';

function SSEMount(): null {
  useSSE();
  return null;
}

function StateHydrator(): null {
  const setCurrentTaskId = useStore((s) => s.setCurrentTaskId);
  const setScanStatus = useStore((s) => s.setScanStatus);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/scan/active');
        if (!res.ok) return;
        const json = (await res.json()) as {
          task: { id: string; targetUrl: string; status: string } | null;
        };
        if (json.task) {
          setCurrentTaskId(json.task.id);
          setScanStatus(json.task.status as ScanStatus);
        }
      } catch {
        // non-critical — silently ignore
      }
    })();
  }, [setCurrentTaskId, setScanStatus]);

  return null;
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <>
      <SSEMount />
      <StateHydrator />
      {children}
    </>
  );
}
