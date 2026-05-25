'use client';

import { motion, type Variants } from 'framer-motion';
import { useStore } from '@/lib/store';
import type { SitemapNode } from '@/lib/types';

// Breathing pulse animation for active status dots
const breathingVariants: Variants = {
  active: {
    scale: [1, 1.4, 1],
    opacity: [0.7, 1, 0.7],
    transition: {
      duration: 1.8,
      repeat: Infinity,
      ease: 'easeInOut' as const,
    },
  },
  inactive: {
    scale: 1,
    opacity: 0.25,
  },
};

type CapabilityIndicatorProps = {
  label: string;
  active: boolean;
};

function CapabilityIndicator({ label, active }: CapabilityIndicatorProps) {
  return (
    <div className="flex items-center gap-3 py-2">
      <motion.span
        className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
        style={{
          backgroundColor: active ? '#22d3ee' : '#3f3f46',
          boxShadow: active ? '0 0 8px 2px rgba(34,211,238,0.6)' : 'none',
        }}
        variants={breathingVariants}
        animate={active ? 'active' : 'inactive'}
      />
      <span
        className="font-mono text-xs tracking-widest uppercase"
        style={{ color: active ? '#a1f0ff' : '#52525b' }}
      >
        {label}
      </span>
      <span
        className="ml-auto font-mono text-[10px] tracking-wider"
        style={{ color: active ? '#22d3ee' : '#3f3f46' }}
      >
        {active ? 'ACTIVE' : 'IDLE'}
      </span>
    </div>
  );
}

type SitemapNodeItemProps = {
  node: SitemapNode;
  depth: number;
};

function SitemapNodeItem({ node, depth }: SitemapNodeItemProps) {
  return (
    <li>
      <div
        className="flex items-center gap-2 py-1 font-mono text-[11px]"
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {/* Tree connector */}
        {depth > 0 && (
          <span className="text-zinc-600 select-none">{'└─'}</span>
        )}
        {/* Explored checkmark */}
        {node.explored ? (
          <span style={{ color: '#22d3ee' }}>✓</span>
        ) : (
          <span className="text-zinc-600">○</span>
        )}
        <span
          className="truncate flex-1 min-w-0"
          style={{ color: node.explored ? '#d4d4d8' : '#71717a' }}
          title={node.url}
        >
          {node.label || node.url}
        </span>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <SitemapNodeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function AgentTelemetry() {
  const telemetry_status = useStore((s) => s.telemetry_status);
  const sitemapNodes = useStore((s) => s.sitemapNodes);

  return (
    <div
      className="flex flex-col h-full gap-4 p-4 rounded-xl overflow-hidden"
      style={{
        background: 'rgba(9,9,11,0.75)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(63,63,70,0.5)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-zinc-800">
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-zinc-500">
          Agent Telemetry
        </span>
        <span
          className="ml-auto font-mono text-[9px] tracking-widest"
          style={{ color: '#22d3ee' }}
        >
          SYS::MONITOR
        </span>
      </div>

      {/* Capability indicators */}
      <div className="flex flex-col divide-y divide-zinc-800/60">
        <CapabilityIndicator
          label="AI DOM Parsing"
          active={telemetry_status.aiDomParsing}
        />
        <CapabilityIndicator
          label="Auto-Login Detection"
          active={telemetry_status.autoLoginDetection}
        />
        <CapabilityIndicator
          label="Deep Intercepting"
          active={telemetry_status.deepIntercepting}
        />
      </div>

      {/* Sitemap section */}
      <div className="flex flex-col flex-1 min-h-0 gap-2 mt-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-zinc-500">
            Sitemap
          </span>
          <span className="ml-auto font-mono text-[9px] text-zinc-600">
            {sitemapNodes.length} node{sitemapNodes.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div
          className="flex-1 overflow-y-auto rounded-lg p-2 min-h-0"
          style={{
            background: 'rgba(24,24,27,0.6)',
            border: '1px solid rgba(63,63,70,0.4)',
          }}
        >
          {sitemapNodes.length === 0 ? (
            <p className="font-mono text-[10px] text-zinc-600 text-center py-4 tracking-widest">
              — NO DATA —
            </p>
          ) : (
            <ul className="space-y-0.5">
              {sitemapNodes.map((node) => (
                <SitemapNodeItem key={node.id} node={node} depth={0} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
