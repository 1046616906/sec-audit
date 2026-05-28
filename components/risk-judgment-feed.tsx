'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useActiveTask } from '@/lib/store';
import type { RiskEntry } from '@/lib/types';
import { Progress } from '@/components/ui/progress';

const RISK_CONFIG: Record<
  RiskEntry['riskLevel'],
  { label: string; glowVar: string; badgeClass: string }
> = {
  critical: {
    label: 'CRITICAL',
    glowVar: 'var(--glow-critical)',
    badgeClass: 'bg-red-500/20 text-red-400 border border-red-500/40',
  },
  high: {
    label: 'HIGH',
    glowVar: 'var(--glow-high)',
    badgeClass: 'bg-orange-500/20 text-orange-400 border border-orange-500/40',
  },
  medium: {
    label: 'MEDIUM',
    glowVar: 'var(--glow-medium)',
    badgeClass: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
  },
  low: {
    label: 'LOW',
    glowVar: 'var(--glow-low)',
    badgeClass: 'bg-blue-500/20 text-blue-400 border border-blue-500/40',
  },
};

const PROGRESS_COLOR: Record<RiskEntry['riskLevel'], string> = {
  critical: '#ff4444',
  high: '#ff8800',
  medium: '#ffcc00',
  low: '#4488ff',
};

function RiskCard({ entry }: { entry: RiskEntry }) {
  const cfg = RISK_CONFIG[entry.riskLevel];
  const progressColor = PROGRESS_COLOR[entry.riskLevel];
  const confidencePct = Math.round(entry.confidence * 100);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="rounded-lg border border-zinc-700/60 bg-zinc-900/70 backdrop-blur-xl p-4 space-y-3"
      style={{
        boxShadow: `0 0 12px 1px ${cfg.glowVar}44, inset 0 0 0 1px ${cfg.glowVar}22`,
      }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold tracking-widest font-mono ${cfg.badgeClass}`}
        >
          {cfg.label}
        </span>
        <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[60%] text-right">
          {entry.field}
        </span>
      </div>

      {/* Intercepted URL */}
      <p className="text-xs font-mono text-zinc-300 break-all leading-relaxed">
        <span className="text-zinc-600 select-none">URL › </span>
        {entry.url}
      </p>

      {/* Confidence bar */}
      <div className="space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono text-zinc-500 tracking-wider uppercase">
            AI Confidence
          </span>
          <span
            className="text-[10px] font-mono font-semibold"
            style={{ color: progressColor }}
          >
            {confidencePct}%
          </span>
        </div>
        <Progress
          value={confidencePct}
          className="h-1.5 bg-zinc-800"
          style={
            {
              '--progress-color': progressColor,
            } as React.CSSProperties
          }
        />
      </div>

      {/* AI reasoning */}
      <p className="text-[11px] text-zinc-400 leading-relaxed font-mono border-t border-zinc-700/50 pt-2">
        <span className="text-zinc-600 select-none">⟩ </span>
        {entry.reasoning}
      </p>
    </motion.div>
  );
}

export function RiskJudgmentFeed() {
  const active = useActiveTask();
  const risks = active?.risks ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Column header */}
      <div className="flex items-center gap-2 px-1 pb-3 border-b border-zinc-800 mb-4 shrink-0">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <h2 className="text-xs font-mono font-semibold tracking-widest text-zinc-400 uppercase">
          Risk Judgment Feed
        </h2>
        <span className="ml-auto text-[10px] font-mono text-zinc-600">
          {risks.length} entries
        </span>
      </div>

      {/* Waterfall */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-zinc-700">
        <AnimatePresence initial={false} mode="popLayout">
          {risks.length === 0 ? (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center text-xs font-mono text-zinc-600 mt-12"
            >
              awaiting risk signals...
            </motion.p>
          ) : (
            [...risks].reverse().map((entry) => (
              <RiskCard key={entry.id} entry={entry} />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
