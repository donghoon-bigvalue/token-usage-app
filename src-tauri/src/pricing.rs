//! Model pricing table — public API rates, per million tokens (MTok), USD.
//! These are ESTIMATES for API-equivalent cost; subscription billing differs.
//! Adjust values here when published prices change.
//!
//! Rates last verified 2026-08-10 against platform.claude.com/docs/en/pricing and
//! developers.openai.com/api/docs/pricing. Entries the vendor does not publish are
//! marked `exact: false` (see [`ModelPricing::exact`]) so the UI can flag them.

/// Per-MTok USD rates for one model.
#[derive(Debug, Clone, Copy)]
pub struct ModelPricing {
    /// Uncached input rate.
    pub input: f64,
    pub output: f64,
    /// Claude cache-creation (write) rate, 5-minute TTL.
    pub cache_write: f64,
    /// Claude cache-creation (write) rate, 1-hour TTL.
    pub cache_write_1h: f64,
    /// Claude cache-read rate.
    pub cache_read: f64,
    /// Codex/OpenAI cached-input rate.
    pub cached_input: f64,
    /// True when the model id matched an entry whose rate was verified against
    /// the vendor's published pricing. False when only the *family* matched — a
    /// new generation, or a model the vendor doesn't publish a rate for. The
    /// number is still the nearest plausible tier, but it may be wrong in either
    /// direction (GPT-5.6 Luna is ~6x cheaper than the generic GPT-5 fallback,
    /// Sol ~4x dearer), so callers must not present it as settled.
    pub exact: bool,
}

/// Anthropic rates, taken column-for-column from the published pricing table.
/// Written out rather than derived from the 1.25x/2x/0.1x multipliers so each
/// number can be eyeballed against the docs — and so float rounding can't turn
/// 0.8 * 0.1 into 0.08000000000000002.
fn claude(input: f64, output: f64, cache_write: f64, cache_write_1h: f64, cache_read: f64) -> ModelPricing {
    ModelPricing { input, output, cache_write, cache_write_1h, cache_read, cached_input: 0.0, exact: true }
}

/// OpenAI rates. No cache-write concept; `cached_input` is its own published rate.
fn openai(input: f64, output: f64, cached_input: f64) -> ModelPricing {
    ModelPricing { input, output, cache_write: 0.0, cache_write_1h: 0.0, cache_read: 0.0, cached_input, exact: true }
}

/// Mark a rate as a family-level guess rather than a verified lookup.
fn approx(p: ModelPricing) -> ModelPricing {
    ModelPricing { exact: false, ..p }
}

fn has_any(m: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| m.contains(n))
}

fn per_m(tokens: u64, rate_per_million: f64) -> f64 {
    (tokens as f64) / 1_000_000.0 * rate_per_million
}

impl ModelPricing {
    /// Claude-style: cache tokens are separate, non-overlapping fields.
    /// `cache_write` is the total; `cache_write_1h` is the 1-hour-TTL portion of
    /// it, billed at 2x base input instead of 1.25x. Older logs omit the TTL
    /// breakdown, so a `cache_write_1h` of 0 prices everything at the 5m rate.
    pub fn claude_cost(
        &self,
        input: u64,
        output: u64,
        cache_write: u64,
        cache_write_1h: u64,
        cache_read: u64,
    ) -> f64 {
        let write_1h = cache_write_1h.min(cache_write);
        let write_5m = cache_write - write_1h;
        per_m(input, self.input)
            + per_m(output, self.output)
            + per_m(write_5m, self.cache_write)
            + per_m(write_1h, self.cache_write_1h)
            + per_m(cache_read, self.cache_read)
    }

    /// Codex-style: `input_total` already includes `cached`.
    pub fn codex_cost(&self, input_total: u64, cached: u64, output: u64) -> f64 {
        let uncached = input_total.saturating_sub(cached);
        per_m(uncached, self.input) + per_m(cached, self.cached_input) + per_m(output, self.output)
    }
}

/// Look up pricing by model id (case-insensitive substring match).
/// `year_month` ("YYYY-MM") drives date-sensitive rates (e.g. Sonnet 5 intro).
/// Returns None for unknown models so callers can flag "estimate unavailable".
pub fn pricing_for(model: &str, year_month: &str) -> Option<ModelPricing> {
    let m = model.to_ascii_lowercase();

    // --- Claude family (cache buckets are separate, non-overlapping) ---
    //                       input  output  5m-write  1h-write  read
    if has_any(&m, &["fable", "mythos"]) {
        return Some(claude(10.0, 50.0, 12.50, 20.0, 1.00));
    }
    if m.contains("opus") {
        // Opus 4.1 / 4.0 / 3 are the 15/75 generation; 4.5 onward are 5/25.
        if has_any(&m, &["opus-4-1", "opus-4-0", "opus-3", "3-opus"]) {
            return Some(claude(15.0, 75.0, 18.75, 30.0, 1.50));
        }
        let p = claude(5.0, 25.0, 6.25, 10.0, 0.50);
        let known = has_any(&m, &["opus-5", "opus-4-8", "opus-4-7", "opus-4-6", "opus-4-5"]);
        return Some(if known { p } else { approx(p) });
    }
    if m.contains("sonnet") {
        if m.contains("sonnet-5") {
            // Sonnet 5 shipped on introductory pricing through 2026-08.
            return Some(if year_month <= "2026-08" {
                claude(2.0, 10.0, 2.50, 4.0, 0.20)
            } else {
                claude(3.0, 15.0, 3.75, 6.0, 0.30)
            });
        }
        let p = claude(3.0, 15.0, 3.75, 6.0, 0.30);
        let known = has_any(&m, &["sonnet-4-6", "sonnet-4-5", "sonnet-4"]);
        return Some(if known { p } else { approx(p) });
    }
    if m.contains("haiku") {
        if has_any(&m, &["haiku-3-5", "3-5-haiku"]) {
            return Some(claude(0.80, 4.0, 1.00, 1.60, 0.08));
        }
        let p = claude(1.0, 5.0, 1.25, 2.0, 0.10);
        let known = has_any(&m, &["haiku-4-5", "4-5-haiku"]);
        return Some(if known { p } else { approx(p) });
    }

    // --- Codex / OpenAI GPT-5 family (input_tokens already includes cached) ---
    // Order matters: "gpt-5.6-sol" also contains "gpt-5", and
    // "gpt-5.3-codex-spark" also contains "codex".
    //                       input  output  cached-input
    if m.contains("gpt-5.6") {
        if m.contains("terra") { return Some(openai(2.0, 12.0, 0.20)); }
        if m.contains("luna") { return Some(openai(0.20, 1.20, 0.02)); }
        let sol = openai(5.0, 30.0, 0.50);
        // Sol is the flagship, but OpenAI does not document the bare `gpt-5.6`
        // alias as pointing at it — so only the explicit id is treated as exact.
        return Some(if m.contains("sol") { sol } else { approx(sol) });
    }
    if m.contains("gpt-5.5") {
        return Some(openai(5.0, 30.0, 0.50));
    }
    if m.contains("gpt-5.4") {
        return Some(if m.contains("mini") {
            openai(0.75, 4.50, 0.075)
        } else {
            openai(2.50, 15.0, 0.25)
        });
    }
    if m.contains("gpt-5.3") {
        // gpt-5.3-codex and -spark are absent from OpenAI's pricing page; these
        // are third-party aggregates, so they stay flagged as inexact.
        return Some(approx(openai(1.75, 14.0, 0.175)));
    }
    if m.contains("gpt-5.2") {
        let p = openai(1.75, 14.0, 0.175);
        // The -codex variant isn't published separately; assume the base rate.
        return Some(if m.contains("codex") { approx(p) } else { p });
    }
    if m.contains("gpt-5") || m.contains("codex") {
        return Some(approx(openai(1.25, 10.0, 0.125)));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_opus_cost_sums_all_buckets() {
        // opus-4-8 is current-gen → 5/25, cache 6.25/0.50
        let p = pricing_for("claude-opus-4-8", "2026-07").unwrap();
        let cost = p.claude_cost(1_000_000, 1_000_000, 1_000_000, 0, 1_000_000);
        assert!((cost - (5.0 + 25.0 + 6.25 + 0.50)).abs() < 1e-9);
    }

    #[test]
    fn opus_1h_cache_write_is_double_base_input() {
        // Published multipliers: 5m write = 1.25x input, 1h write = 2x input.
        let p = pricing_for("claude-opus-5", "2026-08").unwrap();
        assert_eq!((p.cache_write, p.cache_write_1h), (6.25, 10.0));
    }

    #[test]
    fn claude_cost_prices_1h_cache_writes_apart_from_5m() {
        let p = pricing_for("claude-opus-5", "2026-08").unwrap();
        // 1M cache-write tokens, 400k of them at the 1-hour rate.
        let cost = p.claude_cost(0, 0, 1_000_000, 400_000, 0);
        assert!((cost - (0.6 * 6.25 + 0.4 * 10.0)).abs() < 1e-9);
    }

    #[test]
    fn codex_cost_excludes_cached_from_input_rate() {
        let p = pricing_for("gpt-5.5", "2026-07").unwrap();
        // input_total 1M with 400k cached: 600k @5 + 400k @0.50 + 1M output @30
        let cost = p.codex_cost(1_000_000, 400_000, 1_000_000);
        let expected = 0.6 * 5.0 + 0.4 * 0.50 + 30.0;
        assert!((cost - expected).abs() < 1e-9);
    }

    #[test]
    fn unknown_model_has_no_pricing() {
        assert!(pricing_for("mystery-model-9", "2026-07").is_none());
    }

    #[test]
    fn opus_legacy_keeps_15_75() {
        let p = pricing_for("claude-opus-4-1", "2026-07").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_read), (15.0, 75.0, 18.75, 1.5));
    }

    #[test]
    fn opus_current_gen_is_5_25() {
        let p = pricing_for("claude-opus-4-8", "2026-07").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_read), (5.0, 25.0, 6.25, 0.50));
    }

    #[test]
    fn fable_is_10_50() {
        let p = pricing_for("claude-fable-5", "2026-07").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_read), (10.0, 50.0, 12.5, 1.0));
    }

    #[test]
    fn sonnet5_intro_promo_before_september() {
        let p = pricing_for("claude-sonnet-5", "2026-07").unwrap();
        assert_eq!((p.input, p.output), (2.0, 10.0));
    }

    #[test]
    fn sonnet5_promo_includes_august_2026() {
        let p = pricing_for("claude-sonnet-5", "2026-08").unwrap();
        assert_eq!((p.input, p.output), (2.0, 10.0));
    }

    #[test]
    fn sonnet5_standard_rate_after_promo() {
        let p = pricing_for("claude-sonnet-5", "2026-09").unwrap();
        assert_eq!((p.input, p.output), (3.0, 15.0));
    }

    #[test]
    fn legacy_sonnet_never_gets_promo() {
        let p = pricing_for("claude-sonnet-4-6", "2026-07").unwrap();
        assert_eq!((p.input, p.output), (3.0, 15.0));
    }

    // --- Rates verified against the vendors' published pricing pages, 2026-08-10 ---

    #[test]
    fn gpt_56_sol_is_5_30() {
        let p = pricing_for("gpt-5.6-sol", "2026-08").unwrap();
        assert_eq!((p.input, p.output, p.cached_input), (5.0, 30.0, 0.50));
    }

    #[test]
    fn gpt_56_terra_is_2_12() {
        let p = pricing_for("gpt-5.6-terra", "2026-08").unwrap();
        assert_eq!((p.input, p.output, p.cached_input), (2.0, 12.0, 0.20));
    }

    /// Luna is cheaper than the generic gpt-5 fallback, so the old behaviour
    /// *over*-billed it rather than under-billing (issue #65).
    #[test]
    fn gpt_56_luna_is_020_120() {
        let p = pricing_for("gpt-5.6-luna", "2026-08").unwrap();
        assert_eq!((p.input, p.output, p.cached_input), (0.20, 1.20, 0.02));
    }

    #[test]
    fn gpt_54_is_2_50_15() {
        let p = pricing_for("gpt-5.4", "2026-08").unwrap();
        assert_eq!((p.input, p.output, p.cached_input), (2.50, 15.0, 0.25));
    }

    #[test]
    fn gpt_54_mini_is_cheaper_than_gpt_54() {
        let p = pricing_for("gpt-5.4-mini", "2026-08").unwrap();
        assert_eq!((p.input, p.output, p.cached_input), (0.75, 4.50, 0.075));
    }

    #[test]
    fn gpt_52_is_1_75_14() {
        let p = pricing_for("gpt-5.2", "2026-08").unwrap();
        assert_eq!((p.input, p.output, p.cached_input), (1.75, 14.0, 0.175));
    }

    #[test]
    fn mythos_5_matches_fable_5() {
        let p = pricing_for("claude-mythos-5", "2026-08").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_write_1h, p.cache_read),
                   (10.0, 50.0, 12.5, 20.0, 1.0));
    }

    #[test]
    fn haiku_3_5_is_cheaper_than_haiku_4_5() {
        let p = pricing_for("claude-3-5-haiku-20241022", "2026-01").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_write_1h, p.cache_read),
                   (0.80, 4.0, 1.0, 1.60, 0.08));
    }

    // --- exact vs. family-fallback ---

    #[test]
    fn verified_table_entries_are_exact() {
        assert!(pricing_for("claude-opus-5", "2026-08").unwrap().exact);
        assert!(pricing_for("claude-sonnet-4-6", "2026-08").unwrap().exact);
        assert!(pricing_for("gpt-5.6-sol", "2026-08").unwrap().exact);
        assert!(pricing_for("gpt-5.5", "2026-08").unwrap().exact);
    }

    /// An unreleased generation still lands on its family's rate so the user sees
    /// a number, but it must be flagged so the UI can mark the total approximate.
    #[test]
    fn unknown_generation_falls_back_but_is_not_exact() {
        let opus = pricing_for("claude-opus-9", "2026-08").unwrap();
        assert_eq!((opus.input, opus.output), (5.0, 25.0));
        assert!(!opus.exact, "unknown Opus generation must not claim an exact rate");

        let gpt = pricing_for("gpt-5.9", "2026-08").unwrap();
        assert!(!gpt.exact, "unknown GPT-5 generation must not claim an exact rate");
    }

    /// gpt-5.3-codex and its Spark variant are not on OpenAI's published pricing
    /// page; the rates here are third-party aggregates.
    #[test]
    fn unpublished_codex_rates_are_not_exact() {
        assert!(!pricing_for("gpt-5.3-codex", "2026-08").unwrap().exact);
        assert!(!pricing_for("gpt-5.3-codex-spark", "2026-08").unwrap().exact);
    }

    #[test]
    fn gpt_53_codex_is_1_75_14() {
        let p = pricing_for("gpt-5.3-codex", "2026-07").unwrap();
        assert_eq!((p.input, p.output, p.cached_input), (1.75, 14.0, 0.175));
    }

    #[test]
    fn gpt_53_codex_spark_matches_codex() {
        let p = pricing_for("gpt-5.3-codex-spark", "2026-07").unwrap();
        assert_eq!((p.input, p.output, p.cached_input), (1.75, 14.0, 0.175));
    }
}
