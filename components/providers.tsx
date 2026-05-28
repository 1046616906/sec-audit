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

type ActiveTask = { id: string; targetUrl: string; status: string };

function StateHydrator(): null {
  const upsertTask = useStore((s) => s.upsertTask);
  const setActiveTaskId = useStore((s) => s.setActiveTaskId);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/scan/active');
        if (!res.ok) return;
        const json = (await res.json()) as { tasks?: ActiveTask[]; task: ActiveTask | null };
        const list = json.tasks ?? (json.task ? [json.task] : []);
        for (const t of list) {
          upsertTask(t.id, t.targetUrl, t.status as ScanStatus);
        }
        if (list.length > 0) setActiveTaskId(list[0].id);
      } catch {
        // non-critical — silently ignore
      }
    })();
  }, [upsertTask, setActiveTaskId]);

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
