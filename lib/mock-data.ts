import type { LogEntry, RiskEntry, TelemetryStatus, SitemapNode } from './types';

export const MOCK_LOGS: LogEntry[] = [
  {
    id: 'log-1',
    timestamp: '2026-05-14T10:00:01Z',
    level: 'info',
    tag: 'NAVIGATOR',
    message: 'Launching Chromium and navigating to https://target.example.com',
  },
  {
    id: 'log-2',
    timestamp: '2026-05-14T10:00:03Z',
    level: 'warn',
    tag: 'INTERCEPTOR',
    message: 'Suspicious field "token" detected in /api/v1/auth/refresh response',
  },
  {
    id: 'log-3',
    timestamp: '2026-05-14T10:00:05Z',
    level: 'error',
    tag: 'AGENT',
    message: 'DOM parse failed on /dashboard/settings — selector not found',
  },
];

export const MOCK_RISKS: RiskEntry[] = [
  {
    id: 'risk-critical',
    url: 'https://target.example.com/api/v1/users/export',
    field: 'ssn',
    riskLevel: 'critical',
    reasoning:
      'Response contains unmasked Social Security Numbers in plaintext. Direct PII exposure with no encryption or masking applied.',
    confidence: 0.97,
  },
  {
    id: 'risk-high',
    url: 'https://target.example.com/api/v1/auth/refresh',
    field: 'token',
    riskLevel: 'high',
    reasoning:
      'Long-lived bearer token returned in response body. Token has no expiry field and appears to be a persistent session credential.',
    confidence: 0.84,
  },
  {
    id: 'risk-medium',
    url: 'https://target.example.com/api/v1/profile',
    field: 'email',
    riskLevel: 'medium',
    reasoning:
      'User email addresses returned in bulk list endpoint without pagination or access scoping. Potential enumeration vector.',
    confidence: 0.61,
  },
  {
    id: 'risk-low',
    url: 'https://target.example.com/api/v1/config',
    field: 'version',
    riskLevel: 'low',
    reasoning:
      'Internal software version string exposed in public API response. Low severity but aids fingerprinting.',
    confidence: 0.42,
  },
];

// Minimal 1x1 transparent PNG encoded as base64
export const MOCK_LIVE_FRAME =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export const MOCK_TELEMETRY: TelemetryStatus = {
  aiDomParsing: true,
  autoLoginDetection: true,
  deepIntercepting: true,
};

export const MOCK_SITEMAP_NODES: SitemapNode[] = [
  {
    id: 'node-1',
    url: 'https://target.example.com/',
    label: '/',
    explored: true,
    children: [
      {
        id: 'node-1-1',
        url: 'https://target.example.com/dashboard',
        label: '/dashboard',
        explored: true,
        children: [],
      },
      {
        id: 'node-1-2',
        url: 'https://target.example.com/api/v1',
        label: '/api/v1',
        explored: false,
        children: [],
      },
    ],
  },
  {
    id: 'node-2',
    url: 'https://target.example.com/login',
    label: '/login',
    explored: true,
    children: [],
  },
  {
    id: 'node-3',
    url: 'https://target.example.com/admin',
    label: '/admin',
    explored: false,
    children: [],
  },
];
