export type WindowId =
  | "claude_session"
  | "claude_weekly_all"
  | "claude_weekly_fable"
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

export interface MonthlySummary {
  year_month: string;
  provider: "claude" | "codex";
  /**
   * Display-normalized buckets — these four always sum to `total_tokens`.
   * For Codex, `input_tokens` has its cached reads stripped out and
   * `cache_read_tokens` comes from the raw `cached_input_tokens`.
   */
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** `input_tokens + output_tokens` — the headline number. */
  direct_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  cost_estimable: boolean;
}

export interface MonthlyDetail {
  year_month: string;
  provider: "claude" | "codex";
  model: string;
  /** Log-verbatim buckets. For Codex, `raw_input_tokens` includes cache reads. */
  raw_input_tokens: number;
  raw_output_tokens: number;
  raw_cache_write_tokens: number;
  raw_cache_read_tokens: number;
  raw_cached_input_tokens: number;
  direct_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
}

export interface UsageHistory {
  current_month: string;
  /** Unix seconds when the logs were scanned. */
  scanned_at: number;
  summaries: MonthlySummary[];
  details: MonthlyDetail[];
}
