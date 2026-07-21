//! Monthly usage aggregation (issue #19). Export lives in `xlsx.rs`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::model::{
    MonthlyDetail, MonthlySummary, ProviderId, UsageHistory, UsageRecord,
};
use crate::pricing::pricing_for;

/// The four buckets the UI shows, normalized so both providers mean the same
/// thing. Claude reports cache reads in their own field; Codex folds them into
/// `input_tokens` and breaks them out as `cached_input_tokens`, and has no
/// cache-write concept at all. Every display path goes through here so the
/// rule lives in exactly one place.
struct DisplayBuckets {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
}

impl DisplayBuckets {
    fn direct(&self) -> u64 {
        self.input + self.output
    }
}

fn display_buckets(
    p: ProviderId, input: u64, output: u64,
    cache_write: u64, cache_read: u64, cached_input: u64,
) -> DisplayBuckets {
    match p {
        ProviderId::Claude => DisplayBuckets { input, output, cache_read, cache_write },
        // `saturating_sub` guards a malformed log where cached exceeds input —
        // u64 underflow would surface as ~1.8e19 tokens rather than an error.
        ProviderId::Codex => DisplayBuckets {
            input: input.saturating_sub(cached_input),
            output,
            cache_read: cached_input,
            cache_write: 0,
        },
    }
}

/// Running totals for one (month, provider) summary. A tuple stopped being
/// readable once there were six things to accumulate.
#[derive(Default)]
struct SummaryAcc {
    total: u64,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    cost: f64,
    estimable: bool,
}

/// Fold raw records into (month × provider × model) details and (month × provider)
/// summaries, computing API-equivalent cost per the provider's cache accounting.
/// `scanned_at` (unix seconds) is supplied by the caller — this stays a pure fold
/// so tests stay deterministic.
pub fn aggregate(records: Vec<UsageRecord>, current_month: String, scanned_at: i64) -> UsageHistory {
    // Sum raw token buckets.
    let mut buckets: BTreeMap<(String, ProviderId, String), UsageRecord> = BTreeMap::new();
    for r in records {
        let key = (r.year_month.clone(), r.provider, r.model.clone());
        let e = buckets.entry(key).or_insert_with(|| UsageRecord {
            year_month: r.year_month.clone(), provider: r.provider, model: r.model.clone(),
            input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, cached_input_tokens: 0,
        });
        e.input_tokens += r.input_tokens;
        e.output_tokens += r.output_tokens;
        e.cache_write_tokens += r.cache_write_tokens;
        e.cache_read_tokens += r.cache_read_tokens;
        e.cached_input_tokens += r.cached_input_tokens;
    }

    // Details + cost.
    let mut details: Vec<MonthlyDetail> = buckets.into_values().map(|r| {
        let pricing = pricing_for(&r.model, &r.year_month);
        let (total_tokens, cost_usd) = match r.provider {
            ProviderId::Claude => {
                let total = r.input_tokens + r.output_tokens + r.cache_write_tokens + r.cache_read_tokens;
                let cost = pricing.map(|p| p.claude_cost(r.input_tokens, r.output_tokens, r.cache_write_tokens, r.cache_read_tokens));
                (total, cost)
            }
            ProviderId::Codex => {
                // input already includes cached; don't double-count.
                let total = r.input_tokens + r.output_tokens;
                let cost = pricing.map(|p| p.codex_cost(r.input_tokens, r.cached_input_tokens, r.output_tokens));
                (total, cost)
            }
        };
        let direct_tokens = display_buckets(
            r.provider, r.input_tokens, r.output_tokens,
            r.cache_write_tokens, r.cache_read_tokens, r.cached_input_tokens,
        ).direct();
        MonthlyDetail {
            year_month: r.year_month, provider: r.provider, model: r.model,
            input_tokens: r.input_tokens, output_tokens: r.output_tokens,
            cache_write_tokens: r.cache_write_tokens, cache_read_tokens: r.cache_read_tokens,
            cached_input_tokens: r.cached_input_tokens, direct_tokens, total_tokens, cost_usd,
        }
    }).collect();

    // Summaries per (month, provider).
    let mut sums: BTreeMap<(String, ProviderId), SummaryAcc> = BTreeMap::new();
    for d in &details {
        let e = sums.entry((d.year_month.clone(), d.provider))
            .or_insert_with(|| SummaryAcc { estimable: true, ..SummaryAcc::default() });
        let b = display_buckets(
            d.provider, d.input_tokens, d.output_tokens,
            d.cache_write_tokens, d.cache_read_tokens, d.cached_input_tokens,
        );
        e.total += d.total_tokens;
        e.input += b.input;
        e.output += b.output;
        e.cache_read += b.cache_read;
        e.cache_write += b.cache_write;
        match d.cost_usd {
            Some(c) => e.cost += c,
            None => e.estimable = false,
        }
    }
    let mut summaries: Vec<MonthlySummary> = sums.into_iter().map(|((ym, p), a)| MonthlySummary {
        year_month: ym, provider: p,
        input_tokens: a.input, output_tokens: a.output,
        cache_read_tokens: a.cache_read, cache_write_tokens: a.cache_write,
        direct_tokens: a.input + a.output,
        total_tokens: a.total, cost_usd: Some(a.cost), cost_estimable: a.estimable,
    }).collect();

    let prov_key = |p: &ProviderId| match p { ProviderId::Claude => 0, ProviderId::Codex => 1 };
    summaries.sort_by(|a, b| b.year_month.cmp(&a.year_month).then(prov_key(&a.provider).cmp(&prov_key(&b.provider))));
    details.sort_by(|a, b| b.year_month.cmp(&a.year_month)
        .then(prov_key(&a.provider).cmp(&prov_key(&b.provider)))
        .then(a.model.cmp(&b.model)));

    UsageHistory { current_month, scanned_at, summaries, details }
}

/// Scan both providers from their default homes and aggregate.
pub fn build_history() -> UsageHistory {
    let mut records = Vec::new();
    if let Some(home) = dirs::home_dir() {
        records.extend(crate::providers::claude::scan_usage(&home.join(".claude")));
    }
    if let Some(codex_home) = resolve_codex_home() {
        records.extend(crate::providers::codex::scan_usage(&codex_home));
    }
    let now = chrono::Utc::now();
    aggregate(records, now.format("%Y-%m").to_string(), now.timestamp())
}

fn resolve_codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".codex")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ProviderId, UsageRecord};

    fn claude_rec(ym: &str, model: &str, i: u64, o: u64, cw: u64, cr: u64) -> UsageRecord {
        UsageRecord { year_month: ym.into(), provider: ProviderId::Claude, model: model.into(),
            input_tokens: i, output_tokens: o, cache_write_tokens: cw, cache_read_tokens: cr, cached_input_tokens: 0 }
    }

    fn codex_rec(ym: &str, model: &str, i: u64, o: u64, cached: u64) -> UsageRecord {
        UsageRecord { year_month: ym.into(), provider: ProviderId::Codex, model: model.into(),
            input_tokens: i, output_tokens: o, cache_write_tokens: 0, cache_read_tokens: 0,
            cached_input_tokens: cached }
    }

    #[test]
    fn aggregate_sums_and_prices_by_month_provider_model() {
        let recs = vec![
            claude_rec("2026-07", "claude-sonnet-5", 1_000_000, 1_000_000, 0, 0),
            claude_rec("2026-07", "claude-sonnet-5", 1_000_000, 0, 0, 0),
        ];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        assert_eq!(h.details.len(), 1);
        let d = &h.details[0];
        assert_eq!(d.input_tokens, 2_000_000);
        assert_eq!(d.output_tokens, 1_000_000);
        assert_eq!(d.total_tokens, 3_000_000);
        // sonnet-5 intro promo applies at 2026-07 (<= 2026-08): 2M input @2 + 1M output @10 = 14.0
        assert!((d.cost_usd.unwrap() - 14.0).abs() < 1e-9);
        assert_eq!(h.summaries.len(), 1);
        assert!(h.summaries[0].cost_estimable);
    }

    #[test]
    fn unknown_model_marks_summary_not_estimable() {
        let recs = vec![claude_rec("2026-07", "weird-model", 1_000_000, 0, 0, 0)];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        assert!(h.details[0].cost_usd.is_none());
        assert!(!h.summaries[0].cost_estimable);
    }

    #[test]
    fn aggregate_carries_the_scan_time_through() {
        // The header shows this, and a cached history keeps serving it — so it
        // must be the caller's scan time, not "now" at read time.
        let h = aggregate(vec![claude_rec("2026-07", "claude-sonnet-5", 1, 0, 0, 0)], "2026-07".into(), 1_700_000_000);
        assert_eq!(h.scanned_at, 1_700_000_000);
    }

    #[test]
    fn claude_direct_excludes_cache_but_total_still_includes_it() {
        let recs = vec![claude_rec("2026-07", "claude-sonnet-5", 100, 20, 300, 5_000)];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        let d = &h.details[0];
        assert_eq!(d.direct_tokens, 120);
        // Regression guard: the headline change must not move `total_tokens`.
        assert_eq!(d.total_tokens, 5_420);

        let s = &h.summaries[0];
        assert_eq!(s.direct_tokens, 120);
        assert_eq!(s.input_tokens, 100);
        assert_eq!(s.output_tokens, 20);
        assert_eq!(s.cache_read_tokens, 5_000);
        assert_eq!(s.cache_write_tokens, 300);
        assert_eq!(s.total_tokens, 5_420);
    }

    #[test]
    fn codex_direct_strips_cached_input_so_both_providers_mean_the_same_thing() {
        // Codex reports cached reads *inside* `input`, so 9_000 of the 10_000
        // input tokens were cache hits and only 1_000 were newly sent.
        let recs = vec![codex_rec("2026-07", "gpt-5.5", 10_000, 500, 9_000)];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        let d = &h.details[0];
        assert_eq!(d.direct_tokens, 1_500);
        assert_eq!(d.total_tokens, 10_500);

        let s = &h.summaries[0];
        assert_eq!(s.input_tokens, 1_000);
        assert_eq!(s.output_tokens, 500);
        assert_eq!(s.cache_read_tokens, 9_000);
        assert_eq!(s.cache_write_tokens, 0);
        assert_eq!(s.direct_tokens, 1_500);
    }

    #[test]
    fn malformed_codex_record_with_cached_over_input_does_not_underflow() {
        // A log where cached > input is nonsense, but u64 underflow would turn
        // it into ~1.8e19 tokens on screen (or a debug-build panic).
        let recs = vec![codex_rec("2026-07", "gpt-5.5", 100, 40, 900)];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        assert_eq!(h.details[0].direct_tokens, 40);
        assert_eq!(h.summaries[0].input_tokens, 0);
    }

    #[test]
    fn display_buckets_always_sum_to_total_tokens() {
        let recs = vec![
            claude_rec("2026-07", "claude-sonnet-5", 100, 20, 300, 5_000),
            claude_rec("2026-07", "claude-haiku-4-5", 7, 3, 0, 90),
            codex_rec("2026-07", "gpt-5.5", 10_000, 500, 9_000),
        ];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        assert_eq!(h.summaries.len(), 2);
        for s in &h.summaries {
            assert_eq!(
                s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens,
                s.total_tokens,
                "buckets must reconcile for {:?}", s.provider
            );
            assert_eq!(s.direct_tokens, s.input_tokens + s.output_tokens);
        }
        // Claude summary folds both models together.
        let claude = h.summaries.iter().find(|s| s.provider == ProviderId::Claude).unwrap();
        assert_eq!(claude.direct_tokens, 130);
        assert_eq!(claude.cache_read_tokens, 5_090);
    }
}
