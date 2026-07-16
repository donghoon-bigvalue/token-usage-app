//! Model pricing table — public API rates, per million tokens (MTok), USD.
//! These are ESTIMATES for API-equivalent cost; subscription billing differs.
//! Adjust values here when published prices change.

/// Per-MTok USD rates for one model.
#[derive(Debug, Clone, Copy)]
pub struct ModelPricing {
    /// Uncached input rate.
    pub input: f64,
    pub output: f64,
    /// Claude cache-creation (write) rate.
    pub cache_write: f64,
    /// Claude cache-read rate.
    pub cache_read: f64,
    /// Codex/OpenAI cached-input rate.
    pub cached_input: f64,
}

fn per_m(tokens: u64, rate_per_million: f64) -> f64 {
    (tokens as f64) / 1_000_000.0 * rate_per_million
}

impl ModelPricing {
    /// Claude-style: cache tokens are separate, non-overlapping fields.
    pub fn claude_cost(&self, input: u64, output: u64, cache_write: u64, cache_read: u64) -> f64 {
        per_m(input, self.input)
            + per_m(output, self.output)
            + per_m(cache_write, self.cache_write)
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
    // --- Claude family (cache fields separate) ---
    if m.contains("opus") {
        // Legacy Opus (4.1, 4.0, Opus 3) = 15/75; current gen (4.5–4.8) = 5/25.
        let legacy = m.contains("opus-4-1") || m.contains("opus-4-0")
            || m.contains("opus-3") || m.contains("3-opus");
        return Some(if legacy {
            ModelPricing { input: 15.0, output: 75.0, cache_write: 18.75, cache_read: 1.5, cached_input: 0.0 }
        } else {
            ModelPricing { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.50, cached_input: 0.0 }
        });
    }
    if m.contains("sonnet") {
        // Sonnet 5 intro pricing (2/10) through 2026-08; standard 3/15 otherwise.
        let intro = m.contains("sonnet-5") && year_month <= "2026-08";
        return Some(if intro {
            ModelPricing { input: 2.0, output: 10.0, cache_write: 2.5, cache_read: 0.20, cached_input: 0.0 }
        } else {
            ModelPricing { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.30, cached_input: 0.0 }
        });
    }
    if m.contains("haiku") {
        return Some(ModelPricing { input: 1.0, output: 5.0, cache_write: 1.25, cache_read: 0.10, cached_input: 0.0 });
    }
    if m.contains("fable") {
        return Some(ModelPricing { input: 10.0, output: 50.0, cache_write: 12.5, cache_read: 1.0, cached_input: 0.0 });
    }
    // --- Codex / OpenAI GPT-5 family (input includes cached) ---
    // Order matters: gpt-5.5 contains "gpt-5", gpt-5.3-codex-spark contains "codex".
    if m.contains("gpt-5.3-codex") {
        // Covers gpt-5.3-codex and gpt-5.3-codex-spark. Spark rate is a third-party
        // aggregate, not on OpenAI's official API pricing page — reconfirm before final.
        return Some(ModelPricing { input: 1.75, output: 14.0, cache_write: 0.0, cache_read: 0.0, cached_input: 0.175 });
    }
    if m.contains("gpt-5.5") {
        return Some(ModelPricing { input: 5.0, output: 30.0, cache_write: 0.0, cache_read: 0.0, cached_input: 0.50 });
    }
    if m.contains("gpt-5") || m.contains("codex") {
        return Some(ModelPricing { input: 1.25, output: 10.0, cache_write: 0.0, cache_read: 0.0, cached_input: 0.125 });
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
        let cost = p.claude_cost(1_000_000, 1_000_000, 1_000_000, 1_000_000);
        assert!((cost - (5.0 + 25.0 + 6.25 + 0.50)).abs() < 1e-9);
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
