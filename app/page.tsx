'use client';

import { useState } from 'react';
import AgentTelemetry from '@/components/agent-telemetry';
import ExecutionTimeline from '@/components/execution-timeline';
import { RiskJudgmentFeed } from '@/components/risk-judgment-feed';
import { LiveViewLayer } from '@/components/draggable-live-view';
import { AuthModal } from '@/components/auth-modal';
import { MenuSelectModal } from '@/components/menu-select-modal';
import { TaskListSidebar } from '@/components/task-list-sidebar';
import { useStore, useActiveTask } from '@/lib/store';

export default function Home() {
  const upsertTask = useStore((s) => s.upsertTask);
  const setActiveTaskId = useStore((s) => s.setActiveTaskId);
  const removeTask = useStore((s) => s.removeTask);
  const active = useActiveTask();

  const [targetUrl, setTargetUrl] = useState('');

  async function handleStartScan() {
    const url = targetUrl.trim();
    if (!url) return;
    const res = await fetch('/api/scan/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: url }),
    });
    if (res.ok) {
      const json = (await res.json()) as { taskId: string };
      upsertTask(json.taskId, url, 'running');
      setActiveTaskId(json.taskId);
      setTargetUrl('');
    } else {
      const err = (await res.json()) as { error?: string };
      alert(`Scan failed (${res.status}): ${err.error ?? 'Unknown error'}`);
    }
  }

  async function handleStopScan() {
    if (!active) return;
    await fetch('/api/scan/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: active.taskId }),
    });
    // Don't remove the task — keep it visible as 'cancelled' so user can review
    // the partial results. Status will flip to cancelled via SCAN_DONE handler
    // (or the user can dismiss it from the sidebar).
  }

  function handleDismissTask(taskId: string) {
    removeTask(taskId);
  }

  const scanStatus = active?.scanStatus ?? 'idle';
  const authPageUrl = active?.authPageUrl ?? null;
  const isRunning = scanStatus === 'running' || scanStatus === 'paused' || scanStatus === 'menu_select';

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-950 p-3 gap-3">
      {/* Scan control bar */}
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="url"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://target.example.com"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 backdrop-blur-xl focus:border-cyan-500 focus:outline-none"
        />
        <button
          onClick={() => void handleStartScan()}
          disabled={!targetUrl}
          className="rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-400 backdrop-blur-xl transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          + New Scan
        </button>
        {isRunning && (
          <button
            onClick={() => void handleStopScan()}
            className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 backdrop-blur-xl transition-colors hover:bg-red-500/20"
          >
            Stop Active
          </button>
        )}
      </div>

      {/* Main 4-column layout: tasks | telemetry | timeline | risks */}
      <div className="flex flex-1 overflow-hidden gap-3">
        {/* Task list — 16% */}
        <div className="w-[16%] shrink-0">
          <TaskListSidebar onDismiss={handleDismissTask} />
        </div>

        {/* Agent Telemetry — 18% */}
        <div className="w-[18%] shrink-0">
          <AgentTelemetry />
        </div>

        {/* Execution Timeline — 42% */}
        <div className="relative flex-1 min-w-0">
          {scanStatus === 'paused' && (
            <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 backdrop-blur-xl">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-mono text-red-400">
                Scan paused — authentication required
                {authPageUrl ? `: ${authPageUrl}` : ''}
              </span>
            </div>
          )}
          <ExecutionTimeline />
        </div>

        {/* Risk Judgment Feed — 24% */}
        <div className="w-[24%] shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/40 backdrop-blur-xl p-4">
          <RiskJudgmentFeed />
        </div>
      </div>

      {/* Floating PiPs — one per task with pipVisible=true */}
      <LiveViewLayer />

      {/* Modals scope to active task */}
      <AuthModal />
      <MenuSelectModal />
    </div>
  );
}
