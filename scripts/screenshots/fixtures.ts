/**
 * Demo data for the README screenshots.
 *
 * Everything here is invented — no real account, plan, or usage number from a
 * live install may be pasted in. The values are chosen so every bar lands on a
 * different, mid-range percentage: a screenshot where all five bars sit at 0%
 * (or 100%) tells a visitor nothing about what the app looks like in use.
 */

import type { MonthlySummary, UsageHistory } from "../../src/lib/types";

/** Reset times are relative to capture time so the countdowns always read sensibly. */
const HOUR = 3600;
const DAY = 86400;

export function buildFixtures(nowSeconds: number) {
  const usage = {
    claude: {
      provider: "claude",
      plan: "Max 20x",
      plan_raw: "max_20x",
      source: "live",
      updated_at: nowSeconds,
      error: null,
      windows: [
        { id: "claude_session", used_percent: 42, resets_at: nowSeconds + 2 * HOUR + 15 * 60, available: true },
        { id: "claude_weekly_all", used_percent: 68, resets_at: nowSeconds + 3 * DAY + 6 * HOUR, available: true },
        { id: "claude_weekly_fable", used_percent: 31, resets_at: nowSeconds + 3 * DAY + 6 * HOUR, available: true },
      ],
    },
    codex: {
      provider: "codex",
      plan: "Pro",
      plan_raw: "pro",
      source: "live",
      updated_at: nowSeconds,
      error: null,
      windows: [
        { id: "codex_weekly", used_percent: 57, resets_at: nowSeconds + 4 * DAY + 2 * HOUR, available: true },
        { id: "codex_spark_weekly", used_percent: 12, resets_at: nowSeconds + 4 * DAY + 2 * HOUR, available: true },
      ],
    },
  };

  const settings = {
    language: "ko",
    theme: "dark",
    refresh_interval_secs: 300,
    notify_thresholds: [80, 95],
  };

  // Buckets are invented but must reconcile: the four display buckets sum to
  // `total_tokens`, and `direct_tokens` is `input_tokens + output_tokens`.
  // Claude rows keep cache_read at ~90%+ of total — that dominance is the
  // entire point of the direct/cache split this screenshot demonstrates.
  // Codex has no cache-write concept, so cache_write_tokens stays 0.
  const summaries: MonthlySummary[] = [
    {
      year_month: "2026-07", provider: "claude",
      input_tokens: 800_000, output_tokens: 200_000,
      cache_read_tokens: 45_312_905, cache_write_tokens: 2_000_000,
      direct_tokens: 1_000_000, total_tokens: 48_312_905, cost_usd: 214.36, cost_estimable: true,
    },
    {
      year_month: "2026-07", provider: "codex",
      input_tokens: 5_000_000, output_tokens: 1_200_000,
      cache_read_tokens: 15_504_118, cache_write_tokens: 0,
      direct_tokens: 6_200_000, total_tokens: 21_704_118, cost_usd: 88.12, cost_estimable: true,
    },
    {
      year_month: "2026-06", provider: "claude",
      input_tokens: 1_200_000, output_tokens: 300_000,
      cache_read_tokens: 67_430_442, cache_write_tokens: 3_000_000,
      direct_tokens: 1_500_000, total_tokens: 71_930_442, cost_usd: 318.77, cost_estimable: true,
    },
    {
      year_month: "2026-06", provider: "codex",
      input_tokens: 7_000_000, output_tokens: 1_800_000,
      cache_read_tokens: 24_415_806, cache_write_tokens: 0,
      direct_tokens: 8_800_000, total_tokens: 33_215_806, cost_usd: 131.4, cost_estimable: false,
    },
    {
      year_month: "2026-05", provider: "claude",
      input_tokens: 900_000, output_tokens: 250_000,
      cache_read_tokens: 51_758_237, cache_write_tokens: 2_200_000,
      direct_tokens: 1_150_000, total_tokens: 55_108_237, cost_usd: 246.03, cost_estimable: true,
    },
    {
      year_month: "2026-05", provider: "codex",
      input_tokens: 4_200_000, output_tokens: 1_000_000,
      cache_read_tokens: 13_242_970, cache_write_tokens: 0,
      direct_tokens: 5_200_000, total_tokens: 18_442_970, cost_usd: 74.58, cost_estimable: true,
    },
  ];

  const history: UsageHistory = {
    current_month: "2026-07",
    scanned_at: nowSeconds,
    summaries,
    details: [],
  };

  return { usage, settings, history };
}

export type Fixtures = ReturnType<typeof buildFixtures>;
