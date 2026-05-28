'use client';

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, useTasksRecord, type TaskState } from '@/lib/store';
import type { ScanStatus } from '@/lib/types';

const STATUS_STYLE: Record<ScanStatus, { dot: string; label: string; text: string }> = {
  idle: { dot: 'bg-zinc-600', label: 'IDLE', text: 'text-zinc-500' },
  running: { dot: 'bg-cyan-400 animate-pulse shadow-[0_0_6px_rgba(34,211,238,0.8)]', label: 'RUN', text: 'text-cyan-400' },
  paused: { dot: 'bg-red-500 animate-pulse', label: 'AUTH', text: 'text-red-400' },
  menu_select: { dot: 'bg-yellow-400 animate-pulse', label: 'PICK', text: 'text-yellow-400' },
  done: { dot: 'bg-emerald-500', label: 'DONE', text: 'text-emerald-400' },
  cancelled: { dot: 'bg-zinc-500', label: 'STOP', text: 'text-zinc-400' },
};

function shortHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 24);
  }
}

function TaskCard({
  task,
  isActive,
  onSelect,
  onTogglePip,
  onDismiss,
}: {
  task: TaskState;
  isActive: boolean;
  onSelect: () => void;
  onTogglePip: () => void;
  onDismiss: () => void;
}) {
  const style = STATUS_STYLE[task.scanStatus];
  const isFinished = task.scanStatus === 'done' || task.scanStatus === 'cancelled';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      onClick={onSelect}
      className={`group cursor-pointer rounded-lg border px-3 py-2 transition-colors ${
        isActive
          ? 'border-cyan-500/60 bg-cyan-500/10'
          : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full shrink-0 ${style.dot}`} />
        <span
          className={`flex-1 truncate font-mono text-xs ${
            isActive ? 'text-cyan-300' : 'text-zinc-300'
          }`}
          title={task.targetUrl}
        >
          {shortHost(task.targetUrl)}
        </span>
        <span className={`font-mono text-[9px] tracking-widest shrink-0 ${style.text}`}>
          {style.label}
        </span>
      </div>

      {/* Stats row */}
      <div className="mt-1.5 flex items-center gap-2 font-mono text-[9px] text-zinc-500">
        <span>{task.logs.length} logs</span>
        <span>·</span>
        <span>{task.risks.length} risks</span>
        <span>·</span>
        <span>{task.sitemapNodes.length} pages</span>
      </div>

      {/* Action row — visible on hover or when active */}
      <div
        className={`mt-1.5 flex gap-1.5 transition-opacity ${
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePip();
          }}
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
            task.pipVisible
              ? 'border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20'
              : 'border-zinc-700 bg-zinc-800/40 text-zinc-500 hover:border-zinc-600'
          }`}
        >
          {task.pipVisible ? '◉ PiP' : '○ PiP'}
        </button>
        {isFinished && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 font-mono text-[9px] text-red-400 transition-colors hover:bg-red-500/20"
          >
            ✕ DISMISS
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function TaskListSidebar({ onDismiss }: { onDismiss: (taskId: string) => void }) {
  const tasksRecord = useTasksRecord();
  const tasks = useMemo(
    () => Object.values(tasksRecord).sort((a, b) => b.createdAt - a.createdAt),
    [tasksRecord],
  );
  const activeTaskId = useStore((s) => s.activeTaskId);
  const setActiveTaskId = useStore((s) => s.setActiveTaskId);
  const setPipVisible = useStore((s) => s.setPipVisible);

  return (
    <div
      className="flex flex-col h-full gap-3 rounded-xl p-3 overflow-hidden"
      style={{
        background: 'rgba(9,9,11,0.75)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(63,63,70,0.5)',
      }}
    >
      <div className="flex items-center gap-2 pb-2 border-b border-zinc-800 shrink-0">
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-zinc-500">
          Tasks
        </span>
        <span className="ml-auto font-mono text-[9px] text-zinc-600">
          {tasks.length} active
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-zinc-700">
        {tasks.length === 0 ? (
          <p className="font-mono text-[10px] text-zinc-600 text-center py-4 tracking-widest">
            — NO TASKS —
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {tasks.map((t) => (
              <TaskCard
                key={t.taskId}
                task={t}
                isActive={t.taskId === activeTaskId}
                onSelect={() => setActiveTaskId(t.taskId)}
                onTogglePip={() => setPipVisible(t.taskId, !t.pipVisible)}
                onDismiss={() => onDismiss(t.taskId)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
