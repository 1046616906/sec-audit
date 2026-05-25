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

type StoreState = {
  logs: LogEntry[];
  risks: RiskEntry[];
  liveFrame: string;
  telemetry_status: TelemetryStatus;
  sitemapNodes: SitemapNode[];
  scanStatus: ScanStatus;
  currentTaskId: string | null;
  authPageUrl: string | null;
  menuItems: MenuItem[];
  captchaType: CaptchaType | null;
  captchaImageBase64: string | null;
};

type StoreActions = {
  addLog: (entry: LogEntry) => void;
  addRisk: (entry: RiskEntry) => void;
  setLiveFrame: (url: string) => void;
  setTelemetry: (status: Partial<TelemetryStatus>) => void;
  upsertSitemapNode: (node: SitemapNode) => void;
  setScanStatus: (status: ScanStatus) => void;
  setCurrentTaskId: (id: string | null) => void;
  setAuthPageUrl: (url: string | null) => void;
  setMenuItems: (items: MenuItem[]) => void;
  setCaptchaType: (type: CaptchaType | null) => void;
  setCaptchaImageBase64: (b64: string | null) => void;
  reset: () => void;
};

const initialState: StoreState = {
  logs: [],
  risks: [],
  liveFrame: '',
  telemetry_status: {
    aiDomParsing: false,
    autoLoginDetection: false,
    deepIntercepting: false,
  },
  sitemapNodes: [],
  scanStatus: 'idle',
  currentTaskId: null,
  authPageUrl: null,
  menuItems: [],
  captchaType: null,
  captchaImageBase64: null,
};

function upsertNode(nodes: SitemapNode[], node: SitemapNode): SitemapNode[] {
  const idx = nodes.findIndex((n) => n.id === node.id);
  if (idx !== -1) {
    const updated = [...nodes];
    updated[idx] = node;
    return updated;
  }
  return [...nodes, node];
}

export const useStore = create<StoreState & StoreActions>((set) => ({
  ...initialState,

  addLog: (entry) =>
    set((state) => ({ logs: [...state.logs, entry] })),

  addRisk: (entry) =>
    set((state) => {
      const exists = state.risks.some(
        (r) => r.url === entry.url && r.field === entry.field && r.riskLevel === entry.riskLevel,
      );
      if (exists) return state;
      return { risks: [...state.risks, entry] };
    }),

  setLiveFrame: (url) => set({ liveFrame: url }),

  setTelemetry: (status) =>
    set((state) => ({
      telemetry_status: { ...state.telemetry_status, ...status },
    })),

  upsertSitemapNode: (node) =>
    set((state) => ({
      sitemapNodes: upsertNode(state.sitemapNodes, node),
    })),

  setScanStatus: (status) => set({ scanStatus: status }),

  setCurrentTaskId: (id) => set({ currentTaskId: id }),

  setAuthPageUrl: (url) => set({ authPageUrl: url }),

  setMenuItems: (items) => set({ menuItems: items }),

  setCaptchaType: (type) => set({ captchaType: type }),

  setCaptchaImageBase64: (b64) => set({ captchaImageBase64: b64 }),

  reset: () => set(initialState),
}));
