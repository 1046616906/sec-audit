export type LogEntry = {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
};

export type RiskEntry = {
  id: string;
  url: string;
  field: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  reasoning: string;
  confidence: number;
};

export type TelemetryStatus = {
  aiDomParsing: boolean;
  autoLoginDetection: boolean;
  deepIntercepting: boolean;
};

export type SitemapNode = {
  id: string;
  url: string;
  label: string;
  explored: boolean;
  children: SitemapNode[];
};

export type ScanStatus = 'idle' | 'running' | 'paused' | 'menu_select' | 'done' | 'cancelled';

/** A discovered menu item the user can choose to scan */
export type MenuItem = {
  id: string;
  label: string;
  selector: string;
  description: string;
};

export type CaptchaType = 'image' | 'slider' | 'sms' | 'email' | 'unknown';

export type AuthRequiredEvent = {
  pageUrl: string;
  captchaType: CaptchaType;
  captchaImageBase64?: string;
};
