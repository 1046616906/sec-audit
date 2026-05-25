'use client';

import { useState } from 'react';
import AgentTelemetry from '@/components/agent-telemetry';
import ExecutionTimeline from '@/components/execution-timeline';
import { RiskJudgmentFeed } from '@/components/risk-judgment-feed';
import { DraggableLiveView } from '@/components/draggable-live-view';
import { AuthModal } from '@/components/auth-modal';
import { MenuSelectModal } from '@/components/menu-select-modal';
import { useStore } from '@/lib/store';

export default function Home() {
  const setScanStatus = useStore((s) => s.setScanStatus);
  const scanStatus = useStore((s) => s.scanStatus);
  const setCurrentTaskId = useStore((s) => s.setCurrentTaskId);
  const currentTaskId = useStore((s) => s.currentTaskId);
  const authPageUrl = useStore((s) => s.authPageUrl);

  const [targetUrl, setTargetUrl] = useState('');

  async function handleStartScan() {
    const res = await fetch('/api/scan/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: targetUrl.trim() }),
    });
    if (res.ok) {
      const json = (await res.json()) as { taskId: string };
      setCurrentTaskId(json.taskId);
      setScanStatus('running');
    } else {
      const err = (await res.json()) as { error?: string };
      alert(`Scan failed (${res.status}): ${err.error ?? 'Unknown error'}`);
    }
  }

  async function handleStopScan() {
    if (!currentTaskId) return;
    await fetch('/api/scan/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: currentTaskId }),
    });
    setCurrentTaskId(null);
  }

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
        {scanStatus !== 'running' && scanStatus !== 'paused' ? (
          <button
            onClick={() => void handleStartScan()}
            disabled={!targetUrl}
            className="rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-400 backdrop-blur-xl transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start Scan
          </button>
        ) : (
          <button
            onClick={() => void handleStopScan()}
            className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 backdrop-blur-xl transition-colors hover:bg-red-500/20"
          >
            Stop Scan
          </button>
        )}
      </div>

      {/* Main 3-column layout */}
      <div className="flex flex-1 overflow-hidden gap-3">
        {/* Left column — 20% — Agent Telemetry */}
        <div className="w-[20%] shrink-0">
          <AgentTelemetry />
        </div>

        {/* Center column — 50% — Execution Timeline */}
        <div className="relative w-[50%] shrink-0">
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

        {/* Right column — 30% — Risk Judgment Feed */}
        <div className="w-[30%] shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/40 backdrop-blur-xl p-4">
          <RiskJudgmentFeed />
        </div>
      </div>

      {/* Floating PiP — DraggableLiveView */}
      <DraggableLiveView />

      {/* Auth modal — self-manages open state via scanStatus */}
      <AuthModal />
      {/* Menu select modal — appears when agent discovers navigation menus */}
      <MenuSelectModal />
    </div>
  );
}

