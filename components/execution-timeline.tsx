'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/lib/store';
import type { LogEntry } from '@/lib/types';

const levelStyles: Record<LogEntry['level'], string> = {
  info: 'text-cyan-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

const tagStyles: Record<LogEntry['level'], string> = {
  info: 'bg-cyan-950 text-cyan-300 border border-cyan-700',
  warn: 'bg-yellow-950 text-yellow-300 border border-yellow-700',
  error: 'bg-red-950 text-red-300 border border-red-700',
};

function TimelineEntry({ entry }: { entry: LogEntry }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex gap-3 items-start py-2 px-3 rounded-md hover:bg-white/5 transition-colors"
    >
      {/* Timeline connector */}
      <div className="flex flex-col items-center pt-1 shrink-0">
        <div
          className={`w-2 h-2 rounded-full mt-0.5 ${
            entry.level === 'error'
              ? 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.8)]'
              : entry.level === 'warn'
              ? 'bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.6)]'
              : 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]'
          }`}
        />
      </div>

      {/* Content */}
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] text-zinc-500 shrink-0">
            {entry.timestamp}
          </span>
          <span
            className={`font-mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-widest shrink-0 ${tagStyles[entry.level]}`}
          >
            {entry.tag}
          </span>
        </div>
        <p
          className={`font-mono text-xs leading-relaxed break-words ${levelStyles[entry.level]}`}
        >
          {entry.message}
        </p>
      </div>
    </motion.div>
  );
}

export default function ExecutionTimeline() {
  const logs = useStore((s) => s.logs);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 shrink-0">
        <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse" />
        <span className="font-mono text-xs text-zinc-400 uppercase tracking-widest">
          Execution Timeline
        </span>
        <span className="ml-auto font-mono text-[10px] text-zinc-600">
          {logs.length} events
        </span>
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-zinc-900 scrollbar-thumb-zinc-700 px-1 py-2">
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="font-mono text-xs text-zinc-600 animate-pulse">
              awaiting agent activity...
            </span>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {logs.map((entry) => (
              <TimelineEntry key={entry.id} entry={entry} />
            ))}
          </AnimatePresence>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
