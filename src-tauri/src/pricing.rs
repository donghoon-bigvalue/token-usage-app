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
/// Returns None for unknown models so callers can flag "estimate unavailable".
pub fn pricing_for(model: &str) -> Option<ModelPricing> {
    let m = model.to_ascii_lowercase();
    // --- Claude family (cache fields separate) ---
    if m.contains("opus") {
        return Some(ModelPricing { input: 15.0, output: 75.0, cache_write: 18.75, cache_read: 1.5, cached_input: 0.0 });
    }
    if m.contains("sonnet") {
        return Some(ModelPricing { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.30, cached_input: 0.0 });
    }
    if m.contains("haiku") {
        return Some(ModelPricing { input: 1.0, output: 5.0, cache_write: 1.25, cache_read: 0.10, cached_input: 0.0 });
    }
    if m.contains("fable") {
        // Estimate — replace when official Fable pricing is published.
        return Some(ModelPricing { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.50, cached_input: 0.0 });
    }
    // --- Codex / OpenAI GPT-5 family (input includes cached) ---
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
        let p = pricing_for("claude-opus-4-8").unwrap();
        // 1M input @15 + 1M output @75 + 1M cache_write @18.75 + 1M cache_read @1.5
        let cost = p.claude_cost(1_000_000, 1_000_000, 1_000_000, 1_000_000);
        assert!((cost - (15.0 + 75.0 + 18.75 + 1.5)).abs() < 1e-9);
    }

    #[test]
    fn codex_cost_excludes_cached_from_input_rate() {
        let p = pricing_for("gpt-5.5").unwrap();
        // input_total 1M with 400k cached: 600k @1.25 + 400k @0.125 + 1M output @10
        let cost = p.codex_cost(1_000_000, 400_000, 1_000_000);
        let expected = 0.6 * 1.25 + 0.4 * 0.125 + 10.0;
        assert!((cost - expected).abs() < 1e-9);
    }

    #[test]
    fn unknown_model_has_no_pricing() {
        assert!(pricing_for("mystery-model-9").is_none());
    }
}
