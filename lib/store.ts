'use client';

import { create } from 'zustand';
import type {
  LogEntry,
  RiskEntry,
  TelemetryStatus,
  SitemapNode,
  ScanStatus,
  MenuItem,
  CaptchaType,
} from './types';

/** Per-task state — everything that used to be flat lives here, keyed by taskId. */
export type TaskState = {
  taskId: string;
  targetUrl: string;
  scanStatus: ScanStatus;
  logs: LogEntry[];
  risks: RiskEntry[];
  liveFrame: string;
  telemetry_status: TelemetryStatus;
  sitemapNodes: SitemapNode[];
  authPageUrl: string | null;
  menuItems: MenuItem[];
  captchaType: CaptchaType | null;
  captchaImageBase64: string | null;
  /** PiP visibility — user can close & reopen each task's live window independently. */
  pipVisible: boolean;
  createdAt: number;
};

type StoreState = {
  /** All known tasks, keyed by taskId. */
  tasks: Record<string, TaskState>;
  /** The task whose state the main UI columns reflect. null = no task selected. */
  activeTaskId: string | null;
};

type StoreActions = {
  /** Create or replace a task entry. */
  upsertTask: (taskId: string, targetUrl: string, status?: ScanStatus) => void;
  /** Remove a task entirely (e.g. on dismiss). */
  removeTask: (taskId: string) => void;
  setActiveTaskId: (taskId: string | null) => void;
  setPipVisible: (taskId: string, visible: boolean) => void;

  // Per-task mutations — all take taskId. Silent no-op if task doesn't exist.
  addLog: (taskId: string, entry: LogEntry) => void;
  addRisk: (taskId: string, entry: RiskEntry) => void;
  setLiveFrame: (taskId: string, base64: string) => void;
  setTelemetry: (taskId: string, status: Partial<TelemetryStatus>) => void;
  upsertSitemapNode: (taskId: string, node: SitemapNode) => void;
  setScanStatus: (taskId: string, status: ScanStatus) => void;
  setAuthPageUrl: (taskId: string, url: string | null) => void;
  setMenuItems: (taskId: string, items: MenuItem[]) => void;
  setCaptchaType: (taskId: string, type: CaptchaType | null) => void;
  setCaptchaImageBase64: (taskId: string, b64: string | null) => void;

  reset: () => void;
};

const emptyTelemetry: TelemetryStatus = {
  aiDomParsing: false,
  autoLoginDetection: false,
  deepIntercepting: false,
};

function makeEmptyTask(taskId: string, targetUrl: string, status: ScanStatus): TaskState {
  return {
    taskId,
    targetUrl,
    scanStatus: status,
    logs: [],
    risks: [],
    liveFrame: '',
    telemetry_status: { ...emptyTelemetry },
    sitemapNodes: [],
    authPageUrl: null,
    menuItems: [],
    captchaType: null,
    captchaImageBase64: null,
    pipVisible: true,
    createdAt: Date.now(),
  };
}

function upsertNode(nodes: SitemapNode[], node: SitemapNode): SitemapNode[] {
  const idx = nodes.findIndex((n) => n.id === node.id);
  if (idx !== -1) {
    const updated = [...nodes];
    updated[idx] = node;
    return updated;
  }
  return [...nodes, node];
}

/** Apply a per-task mutation. Silent no-op if task doesn't exist. */
function patchTask(
  state: StoreState,
  taskId: string,
  patch: (t: TaskState) => Partial<TaskState>,
): Partial<StoreState> {
  const existing = state.tasks[taskId];
  if (!existing) return {};
  return {
    tasks: {
      ...state.tasks,
      [taskId]: { ...existing, ...patch(existing) },
    },
  };
}

export const useStore = create<StoreState & StoreActions>((set) => ({
  tasks: {},
  activeTaskId: null,

  upsertTask: (taskId, targetUrl, status = 'running') =>
    set((state) => {
      const existing = state.tasks[taskId];
      const next: TaskState = existing
        ? { ...existing, targetUrl, scanStatus: status }
        : makeEmptyTask(taskId, targetUrl, status);
      return {
        tasks: { ...state.tasks, [taskId]: next },
        // First task auto-becomes active; subsequent tasks don't steal focus.
        activeTaskId: state.activeTaskId ?? taskId,
      };
    }),

  removeTask: (taskId) =>
    set((state) => {
      if (!(taskId in state.tasks)) return {};
      const next = { ...state.tasks };
      delete next[taskId];
      const remainingIds = Object.keys(next);
      const newActive =
        state.activeTaskId === taskId
          ? (remainingIds[0] ?? null)
          : state.activeTaskId;
      return { tasks: next, activeTaskId: newActive };
    }),

  setActiveTaskId: (taskId) => set({ activeTaskId: taskId }),

  setPipVisible: (taskId, visible) =>
    set((state) => patchTask(state, taskId, () => ({ pipVisible: visible }))),

  addLog: (taskId, entry) =>
    set((state) => patchTask(state, taskId, (t) => ({ logs: [...t.logs, entry] }))),

  addRisk: (taskId, entry) =>
    set((state) =>
      patchTask(state, taskId, (t) => {
        const exists = t.risks.some(
          (r) => r.url === entry.url && r.field === entry.field && r.riskLevel === entry.riskLevel,
        );
        if (exists) return {};
        return { risks: [...t.risks, entry] };
      }),
    ),

  setLiveFrame: (taskId, base64) =>
    set((state) => patchTask(state, taskId, () => ({ liveFrame: base64 }))),

  setTelemetry: (taskId, status) =>
    set((state) =>
      patchTask(state, taskId, (t) => ({
        telemetry_status: { ...t.telemetry_status, ...status },
      })),
    ),

  upsertSitemapNode: (taskId, node) =>
    set((state) =>
      patchTask(state, taskId, (t) => ({
        sitemapNodes: upsertNode(t.sitemapNodes, node),
      })),
    ),

  setScanStatus: (taskId, status) =>
    set((state) => patchTask(state, taskId, () => ({ scanStatus: status }))),

  setAuthPageUrl: (taskId, url) =>
    set((state) => patchTask(state, taskId, () => ({ authPageUrl: url }))),

  setMenuItems: (taskId, items) =>
    set((state) => patchTask(state, taskId, () => ({ menuItems: items }))),

  setCaptchaType: (taskId, type) =>
    set((state) => patchTask(state, taskId, () => ({ captchaType: type }))),

  setCaptchaImageBase64: (taskId, b64) =>
    set((state) => patchTask(state, taskId, () => ({ captchaImageBase64: b64 }))),

  reset: () => set({ tasks: {}, activeTaskId: null }),
}));

/* --------------------------------------------------------------------------
 * Convenience selectors — keep components terse.
 * -------------------------------------------------------------------------- */

/** Returns the currently-active task's state, or null if none. */
export function useActiveTask(): TaskState | null {
  return useStore((s) => (s.activeTaskId ? s.tasks[s.activeTaskId] ?? null : null));
}

/** Returns the active taskId, or null. */
export function useActiveTaskId(): string | null {
  return useStore((s) => s.activeTaskId);
}

/** Returns all tasks as an unsorted, stable-reference Record.
 *  Sort in the component with useMemo to keep selector output referentially stable —
 *  returning a fresh array from a Zustand selector triggers infinite re-renders. */
export function useTasksRecord(): Record<string, TaskState> {
  return useStore((s) => s.tasks);
}
