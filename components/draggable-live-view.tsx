'use client';

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/lib/store';

type WindowState = 'open' | 'collapsed' | 'hidden';

export function DraggableLiveView() {
  const liveFrame = useStore((s) => s.liveFrame);
  const constraintsRef = useRef<HTMLDivElement>(null);
  const [windowState, setWindowState] = useState<WindowState>('open');

  if (windowState === 'hidden') {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setWindowState('open')}
          className="px-3 py-1.5 text-xs font-mono font-semibold text-green-400 border border-green-500/50 rounded-md bg-black/70 backdrop-blur-xl hover:bg-black/90 hover:border-green-400 transition-colors"
        >
          ● Live
        </button>
      </div>
    );
  }

  return (
    <div
      ref={constraintsRef}
      className="fixed inset-0 z-40 pointer-events-none"
    >
      <motion.div
        drag
        dragConstraints={constraintsRef}
        dragTransition={{ bounceStiffness: 300, bounceDamping: 20 }}
        dragElastic={0.1}
        initial={{ x: 0, y: 0 }}
        className="absolute bottom-4 right-4 pointer-events-auto w-80 rounded-xl border border-zinc-700/50 bg-black/60 backdrop-blur-xl shadow-2xl shadow-black/60 overflow-hidden"
        style={{ cursor: 'grab' }}
        whileDrag={{ cursor: 'grabbing' }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-700/50 select-none">
          {/* macOS control buttons */}
          <button
            onClick={() => setWindowState('hidden')}
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors flex-shrink-0"
            title="Close"
            aria-label="Close live view"
          />
          <button
            onClick={() =>
              setWindowState((prev) =>
                prev === 'collapsed' ? 'open' : 'collapsed'
              )
            }
            className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-400 transition-colors flex-shrink-0"
            title="Minimize"
            aria-label="Minimize live view"
          />
          <button
            onClick={() => setWindowState('open')}
            className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-400 transition-colors flex-shrink-0"
            title="Expand"
            aria-label="Expand live view"
          />
          <span className="ml-2 text-xs font-mono text-zinc-400 tracking-widest uppercase">
            Live View
          </span>
          {liveFrame && (
            <span className="ml-auto flex items-center gap-1 text-xs font-mono text-green-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </span>
          )}
        </div>

        {/* Content — hidden when collapsed */}
        {windowState === 'open' && (
          <div className="relative w-full aspect-video bg-zinc-950/80">
            {liveFrame ? (
              <img
                src={`data:image/png;base64,${liveFrame}`}
                alt="Live browser frame"
                className="w-full h-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="flex flex-col items-center justify-center w-full h-full gap-2">
                <div className="w-2 h-2 rounded-full bg-zinc-600 animate-pulse" />
                <span className="text-xs font-mono text-zinc-600">
                  Awaiting frame…
                </span>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
