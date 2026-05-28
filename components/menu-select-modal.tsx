'use client';

import { useState } from 'react';
import { useStore, useActiveTask } from '@/lib/store';
import type { MenuItem } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function MenuSelectModal() {
  const active = useActiveTask();
  const setScanStatus = useStore((s) => s.setScanStatus);
  const setMenuItems = useStore((s) => s.setMenuItems);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const scanStatus = active?.scanStatus ?? 'idle';
  const menuItems = active?.menuItems ?? [];
  const currentTaskId = active?.taskId ?? null;
  const isOpen = scanStatus === 'menu_select';

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(menuItems.map((m) => m.id)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function handleSubmit() {
    if (selected.size === 0 || !currentTaskId) return;
    setSubmitting(true);
    try {
      await fetch('/api/worker/menu-select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: currentTaskId, selectedIds: [...selected] }),
      });
      setSelected(new Set());
      setMenuItems(currentTaskId, []);
      setScanStatus(currentTaskId, 'running');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    if (!currentTaskId) return;
    await fetch('/api/worker/menu-select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: currentTaskId, selectedIds: [] }),
    });
    setMenuItems(currentTaskId, []);
    setScanStatus(currentTaskId, 'running');
  }

  return (
    <Dialog open={isOpen}>
      <DialogContent className="max-w-2xl border border-cyan-500/30 bg-zinc-900/95 backdrop-blur-xl text-zinc-100">
        <DialogHeader>
          <DialogTitle className="font-mono text-cyan-400 tracking-widest uppercase text-sm">
            ◈ Menu Modules Discovered
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-xs font-mono">
            Select which modules to deep-scan. Agent will click each selected item and analyze its API responses.
          </DialogDescription>
        </DialogHeader>

        {/* Select all / clear */}
        <div className="flex gap-3 text-xs font-mono">
          <button onClick={selectAll} className="text-cyan-400 hover:text-cyan-300 transition-colors">
            SELECT ALL
          </button>
          <span className="text-zinc-600">|</span>
          <button onClick={clearAll} className="text-zinc-400 hover:text-zinc-300 transition-colors">
            CLEAR
          </button>
          <span className="ml-auto text-zinc-500">{selected.size}/{menuItems.length} selected</span>
        </div>

        {/* Menu items grid */}
        <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
          {menuItems.map((item: MenuItem) => {
            const isSelected = selected.has(item.id);
            return (
              <button
                key={item.id}
                onClick={() => toggleItem(item.id)}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-all ${
                  isSelected
                    ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300'
                    : 'border-zinc-700/50 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                <span className={`mt-0.5 h-4 w-4 shrink-0 rounded border text-xs flex items-center justify-center ${
                  isSelected ? 'border-cyan-500 bg-cyan-500/20 text-cyan-400' : 'border-zinc-600'
                }`}>
                  {isSelected ? '✓' : ''}
                </span>
                <div>
                  <div className="font-mono text-xs font-medium">{item.label}</div>
                  {item.description && (
                    <div className="mt-0.5 text-xs text-zinc-500">{item.description}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => void handleSubmit()}
            disabled={selected.size === 0 || submitting}
            className="flex-1 rounded-lg border border-cyan-500/50 bg-cyan-500/10 py-2 text-sm font-mono font-medium text-cyan-400 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'DISPATCHING...' : `SCAN ${selected.size} MODULE${selected.size !== 1 ? 'S' : ''}`}
          </button>
          <button
            onClick={() => void handleSkip()}
            className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-4 py-2 text-sm font-mono text-zinc-400 transition-colors hover:border-zinc-600"
          >
            SKIP
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
