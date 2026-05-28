'use client';

import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore, useTasksRecord, type TaskState } from '@/lib/store';

type WindowState = 'open' | 'collapsed';

function shortLabel(task: TaskState): string {
  try {
    const u = new URL(task.targetUrl);
    return u.host;
  } catch {
    return task.targetUrl.slice(0, 24);
  }
}

function PiPWindow({ task, index }: { task: TaskState; index: number }) {
  const constraintsRef = useRef<HTMLDivElement>(null);
  const setPipVisible = useStore((s) => s.setPipVisible);
  const setActiveTaskId = useStore((s) => s.setActiveTaskId);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const [windowState, setWindowState] = useState<WindowState>('open');

  const isActive = activeTaskId === task.taskId;
  // Stagger initial offsets so multiple PiPs don't stack on top of each other.
  const offsetX = -(index * 24);
  const offsetY = -(index * 24);

  return (
    <div ref={constraintsRef} className="fixed inset-0 z-40 pointer-events-none">
      <motion.div
        drag
        dragConstraints={constraintsRef}
        dragTransition={{ bounceStiffness: 300, bounceDamping: 20 }}
        dragElastic={0.1}
        initial={{ x: offsetX, y: offsetY }}
        onMouseDown={() => setActiveTaskId(task.taskId)}
        className={`absolute bottom-4 right-4 pointer-events-auto w-72 rounded-xl border bg-black/60 backdrop-blur-xl shadow-2xl shadow-black/60 overflow-hidden ${
          isActive ? 'border-cyan-500/60 ring-1 ring-cyan-500/30' : 'border-zinc-700/50'
        }`}
        style={{ cursor: 'grab' }}
        whileDrag={{ cursor: 'grabbing' }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-700/50 select-none">
          <button
            onClick={() => setPipVisible(task.taskId, false)}
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors flex-shrink-0"
            title="Close"
            aria-label="Close live view"
          />
          <button
            onClick={() => setWindowState((p) => (p === 'collapsed' ? 'open' : 'collapsed'))}
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
          <span
            className="ml-2 text-[10px] font-mono text-zinc-400 tracking-widest uppercase truncate"
            title={task.targetUrl}
          >
            {shortLabel(task)}
          </span>
          {task.liveFrame && (
            <span className="ml-auto flex items-center gap-1 text-[10px] font-mono text-green-400 shrink-0">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </span>
          )}
        </div>

        {windowState === 'open' && (
          <div className="relative w-full aspect-video bg-zinc-950/80">
            {task.liveFrame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/png;base64,${task.liveFrame}`}
                alt={`Live frame for ${task.targetUrl}`}
                className="w-full h-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="flex flex-col items-center justify-center w-full h-full gap-2">
                <div className="w-2 h-2 rounded-full bg-zinc-600 animate-pulse" />
                <span className="text-xs font-mono text-zinc-600">Awaiting frame…</span>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

export function LiveViewLayer() {
  const tasksRecord = useTasksRecord();
  const visible = useMemo(
    () =>
      Object.values(tasksRecord)
        .filter((t) => t.pipVisible)
        .sort((a, b) => b.createdAt - a.createdAt),
    [tasksRecord],
  );

  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((task, idx) => (
        <PiPWindow key={task.taskId} task={task} index={idx} />
      ))}
    </>
  );
}
