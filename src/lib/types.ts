export type WindowId =
  | "claude_session"
  | "claude_weekly_all"
  | "claude_weekly_fable"
  | "codex_five_hour"
  | "codex_weekly"
  | "codex_spark_weekly";

export interface LimitWindow {
  id: WindowId;
  used_percent: number;
  resets_at: number | null;
  available: boolean;
}

export interface UsageSnapshot {
  provider: "claude" | "codex";
  plan: string;
  plan_raw: string;
  source: "live" | "cache";
  updated_at: number;
  windows: LimitWindow[];
  error: string | null;
}

export interface UsageReport {
  claude: UsageSnapshot;
  codex: UsageSnapshot;
}

export interface Settings {
  language: "en" | "ko";
  theme: "light" | "dark" | "system";
  refresh_interval_secs: number;
  notify_thresholds: number[];
}
