//! Monthly usage aggregation + CSV export (issue #19).

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::model::{
    MonthlyDetail, MonthlySummary, ProviderId, UsageHistory, UsageRecord,
};
use crate::pricing::pricing_for;

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
        let pricing = pricing_for(&r.model);
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
        MonthlyDetail {
            year_month: r.year_month, provider: r.provider, model: r.model,
            input_tokens: r.input_tokens, output_tokens: r.output_tokens,
            cache_write_tokens: r.cache_write_tokens, cache_read_tokens: r.cache_read_tokens,
            cached_input_tokens: r.cached_input_tokens, total_tokens, cost_usd,
        }
    }).collect();

    // Summaries per (month, provider).
    let mut sums: BTreeMap<(String, ProviderId), (u64, f64, bool)> = BTreeMap::new();
    for d in &details {
        let e = sums.entry((d.year_month.clone(), d.provider)).or_insert((0, 0.0, true));
        e.0 += d.total_tokens;
        match d.cost_usd {
            Some(c) => e.1 += c,
            None => e.2 = false,
        }
    }
    let mut summaries: Vec<MonthlySummary> = sums.into_iter().map(|((ym, p), (tot, cost, est))| MonthlySummary {
        year_month: ym, provider: p, total_tokens: tot, cost_usd: Some(cost), cost_estimable: est,
    }).collect();

    let prov_key = |p: &ProviderId| match p { ProviderId::Claude => 0, ProviderId::Codex => 1 };
    summaries.sort_by(|a, b| b.year_month.cmp(&a.year_month).then(prov_key(&a.provider).cmp(&prov_key(&b.provider))));
    details.sort_by(|a, b| b.year_month.cmp(&a.year_month)
        .then(prov_key(&a.provider).cmp(&prov_key(&b.provider)))
        .then(a.model.cmp(&b.model)));

    UsageHistory { current_month, scanned_at, summaries, details }
}

/// Minimal RFC-4180 escaping: wrap the field in double quotes (doubling any
/// internal quotes) when it contains a comma, quote, or newline; otherwise
/// emit it as-is. Only `model` is free-form user/CLI-supplied text — every
/// other CSV field here is a controlled enum or number.
fn csv_escape(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') || field.contains('\r') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

/// Detail rows as CSV (one header + one row per detail).
pub fn to_csv(history: &UsageHistory) -> String {
    let mut s = String::from(
        "year_month,provider,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,cached_input_tokens,total_tokens,cost_usd\n",
    );
    for d in &history.details {
        let provider = match d.provider { ProviderId::Claude => "claude", ProviderId::Codex => "codex" };
        let cost = d.cost_usd.map(|c| format!("{c:.4}")).unwrap_or_default();
        s.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{}\n",
            d.year_month, provider, csv_escape(&d.model),
            d.input_tokens, d.output_tokens, d.cache_write_tokens, d.cache_read_tokens,
            d.cached_input_tokens, d.total_tokens, cost,
        ));
    }
    s
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
        // 2M input @3 + 1M output @15 = 21.0
        assert!((d.cost_usd.unwrap() - 21.0).abs() < 1e-9);
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
    fn csv_has_header_and_detail_rows() {
        let recs = vec![claude_rec("2026-07", "claude-haiku-4-5", 1_000_000, 0, 0, 0)];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        let csv = to_csv(&h);
        let mut lines = csv.lines();
        assert_eq!(lines.next().unwrap(),
            "year_month,provider,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,cached_input_tokens,total_tokens,cost_usd");
        let row = lines.next().unwrap();
        assert!(row.starts_with("2026-07,claude,claude-haiku-4-5,1000000,0,0,0,0,1000000,"));
    }

    #[test]
    fn csv_escapes_model_field_with_special_chars() {
        let recs = vec![claude_rec("2026-07", "weird,model\"x", 1_000_000, 0, 0, 0)];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        let csv = to_csv(&h);
        let row = csv.lines().nth(1).unwrap();
        // The escaped model field must appear verbatim as its own CSV field:
        // quoted, with the internal quote doubled.
        assert!(row.contains("\"weird,model\"\"x\""));
        // And the row must retain exactly 10 comma-separated top-level fields
        // (the escaped field's internal comma/quotes must not split it).
        assert!(row.starts_with("2026-07,claude,\"weird,model\"\"x\","));
    }
}
