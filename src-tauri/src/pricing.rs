//! Model pricing table — public API rates, per million tokens (MTok), USD.
//! These are ESTIMATES for API-equivalent cost; subscription billing differs.
//! Adjust values here when published prices change.
//!
//! Rates last verified 2026-11-02 against platform.claude.com/docs/en/pricing and
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

/// The version in a Claude model id: `5-5` for `claude-opus-5-5`, `4` for the
/// snapshot `claude-opus-4-20250514`, `3-5` for the old `claude-3-5-haiku-…` shape.
/// Comparing whole versions is what keeps `opus-5-5` from matching an `opus-5` rate.
fn claude_version(m: &str, family: &str) -> String {
    let Some(at) = m.find(family) else { return String::new() };
    let parts = |text: &str| -> Vec<String> {
        text.split(['-', '@', '['])
            .filter(|p| !p.is_empty())
            .take_while(|p| p.len() <= 2 && p.bytes().all(|b| b.is_ascii_digit()))
            .take(2)
            .map(str::to_string)
            .collect()
    };
    let after = parts(&m[at + family.len()..]);
    if !after.is_empty() {
        return after.join("-");
    }
    let before = m[..at].rsplit("claude").next().unwrap_or("");
    parts(before).join("-")
}

/// Premium rates for a request that ran with `speed: "fast"`.
///
/// Fast mode runs the same model faster for more money, and is offered on Claude
/// Opus 5.5, Opus 5 and Opus 4.8 only — it was removed on Opus 4.7, and Opus 4.6
/// accepts the flag but runs and bills as standard. `None` therefore means "not a
/// fast-mode model", and the caller should fall back to [`pricing_for`] rather than
/// treat it as unpriced. Prompt-caching multipliers apply on top of the fast rate,
/// so every bucket moves, not just input and output.
pub fn fast_mode_pricing(model: &str) -> Option<ModelPricing> {
    let m = model.to_ascii_lowercase();
    match claude_version(&m, "opus").as_str() {
        "5-5" => Some(claude(8.0, 40.0, 10.0, 16.0, 0.40)),
        "5" | "4-8" => Some(claude(10.0, 50.0, 12.50, 20.0, 1.00)),
        _ => None,
    }
}

/// Prompt size above which [`long_prompt_pricing`] applies. Counts every input
/// token of the request, cache reads and writes included.
pub const LONG_PROMPT_THRESHOLD: u64 = 100_000;

/// Rates for a request whose prompt exceeds [`LONG_PROMPT_THRESHOLD`]. Only Claude
/// Haiku 5.5 is priced this way; every other Claude model is flat across its window.
pub fn long_prompt_pricing(model: &str) -> Option<ModelPricing> {
    let m = model.to_ascii_lowercase();
    (m.contains("haiku") && claude_version(&m, "haiku") == "5-5")
        .then(|| claude(0.50, 2.50, 0.625, 1.0, 0.05))
}

/// OpenAI rates that don't change with the date, longest ids first. Pro models
/// publish no cached rate, so cached input bills at the full input rate.
const OPENAI_RATES: &[(&str, f64, f64, f64)] = &[
    //                input  output  cached
    ("gpt-6.1-terra", 1.0, 5.0, 0.05),
    ("gpt-5.4-mini", 0.75, 4.50, 0.075),
    ("gpt-5.4-nano", 0.20, 1.25, 0.02),
    ("gpt-5.3-codex", 1.75, 14.0, 0.175),
    ("gpt-6.1-sol", 2.0, 10.0, 0.10),
    ("gpt-5.5-pro", 30.0, 180.0, 30.0),
    ("gpt-5.4-pro", 30.0, 180.0, 30.0),
    ("gpt-5.2-pro", 21.0, 168.0, 21.0),
    ("gpt-6-astra", 10.0, 50.0, 1.0),
    ("gpt-6-luna", 0.10, 0.50, 0.01),
    ("gpt-5-mini", 0.25, 2.0, 0.025),
    ("gpt-5-nano", 0.05, 0.40, 0.005),
    ("gpt-6-sol", 2.0, 10.0, 0.20),
    ("gpt-5-pro", 15.0, 120.0, 15.0),
    ("gpt-5.5", 5.0, 30.0, 0.50),
    ("gpt-5.4", 2.50, 15.0, 0.25),
    ("gpt-5.2", 1.75, 14.0, 0.175),
    ("gpt-5.1", 1.25, 10.0, 0.125),
    ("gpt-5", 1.25, 10.0, 0.125),
];

/// GPT-5.6 was repriced twice, so its rate depends on the request's date.
/// - Luna and Terra were cut on 2026-07-30. Their earlier rates come from press
///   coverage rather than OpenAI's page, with cached input assumed at 10%, so they
///   stay flagged as inexact.
/// - Sol was cut on 2026-08-21 "through at least" 2026-11-21. Nothing published says
///   what follows, so later dates keep the cut rate but are flagged until re-verified.
fn gpt_56(m: &str, date: &str) -> ModelPricing {
    if m.contains("terra") {
        return if date < "2026-07-30" { approx(openai(2.50, 15.0, 0.25)) } else { openai(2.0, 12.0, 0.20) };
    }
    if m.contains("luna") {
        return if date < "2026-07-30" { approx(openai(1.0, 6.0, 0.10)) } else { openai(0.20, 1.20, 0.02) };
    }
    let sol = if date < "2026-08-21" { openai(5.0, 30.0, 0.50) } else { openai(4.0, 20.0, 0.40) };
    // OpenAI does not document the bare `gpt-5.6` alias as pointing at Sol.
    if m.contains("sol") && date <= "2026-11-21" { sol } else { approx(sol) }
}

/// A trailing `-2026-03-17` names a snapshot of the same model; anything else after
/// the id (`-codex`, `-spark`) is a variant the vendor doesn't price separately.
fn is_date_suffix(rest: &str) -> bool {
    !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit() || b == b'-')
}

fn openai_pricing(m: &str, date: &str) -> Option<ModelPricing> {
    if m.starts_with("gpt-5.6") {
        return Some(gpt_56(m, date));
    }
    // A key must end at a boundary, so `gpt-5` can't claim `gpt-5.9`.
    let hit = OPENAI_RATES.iter().find_map(|&(id, input, output, cached)| {
        let rest = m.strip_prefix(id)?;
        let suffix = if rest.is_empty() { "" } else { rest.strip_prefix('-')? };
        let p = openai(input, output, cached);
        Some(if suffix.is_empty() || is_date_suffix(suffix) { p } else { approx(p) })
    });
    if hit.is_some() {
        return hit;
    }
    (m.contains("gpt-") || m.contains("codex")).then(|| approx(openai(1.25, 10.0, 0.125)))
}

/// Look up standard-speed pricing by model id (case-insensitive).
/// `date` ("YYYY-MM-DD") drives date-sensitive rates.
/// Returns None for unknown models so callers can flag "estimate unavailable".
/// For fast-mode requests, try [`fast_mode_pricing`] first; for Haiku 5.5 prompts
/// over the threshold, [`long_prompt_pricing`].
pub fn pricing_for(model: &str, date: &str) -> Option<ModelPricing> {
    let m = model.to_ascii_lowercase();

    // --- Claude family (cache buckets are separate, non-overlapping) ---
    //                  input  output  5m-write  1h-write  read
    for family in ["fable", "mythos"] {
        if m.contains(family) {
            return Some(match claude_version(&m, family).as_str() {
                "5-1" => claude(10.0, 50.0, 12.50, 20.0, 0.25),
                "5" => claude(10.0, 50.0, 12.50, 20.0, 1.00),
                _ => approx(claude(10.0, 50.0, 12.50, 20.0, 1.00)),
            });
        }
    }
    if m.contains("opus") {
        return Some(match claude_version(&m, "opus").as_str() {
            "5-5" => claude(4.0, 20.0, 5.0, 8.0, 0.20),
            "5" | "4-8" | "4-7" | "4-6" | "4-5" => claude(5.0, 25.0, 6.25, 10.0, 0.50),
            "4-1" | "4-0" | "4" | "3" => claude(15.0, 75.0, 18.75, 30.0, 1.50),
            _ => approx(claude(5.0, 25.0, 6.25, 10.0, 0.50)),
        });
    }
    if m.contains("sonnet") {
        return Some(match claude_version(&m, "sonnet").as_str() {
            "5-5" => claude(2.0, 10.0, 2.50, 4.0, 0.10),
            // Launched as "introductory", but the rise planned for 2026-09-01 was
            // cancelled and $2/$10 became the standard price.
            "5" => claude(2.0, 10.0, 2.50, 4.0, 0.20),
            "4-6" | "4-5" | "4-0" | "4" => claude(3.0, 15.0, 3.75, 6.0, 0.30),
            _ => approx(claude(3.0, 15.0, 3.75, 6.0, 0.30)),
        });
    }
    if m.contains("haiku") {
        return Some(match claude_version(&m, "haiku").as_str() {
            "5-5" => claude(0.10, 0.50, 0.125, 0.20, 0.01),
            "4-5" => claude(1.0, 5.0, 1.25, 2.0, 0.10),
            "3-5" => claude(0.80, 4.0, 1.00, 1.60, 0.08),
            _ => approx(claude(1.0, 5.0, 1.25, 2.0, 0.10)),
        });
    }

    // --- Codex / OpenAI (input_tokens already includes cached) ---
    openai_pricing(&m, date)
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

    /// The increase scheduled for 2026-09-01 was cancelled; $2/$10 is now standard.
    #[test]
    fn sonnet5_stays_2_10_after_the_cancelled_increase() {
        let p = pricing_for("claude-sonnet-5", "2026-09-15").unwrap();
        assert_eq!((p.input, p.output, p.cache_read), (2.0, 10.0, 0.20));
        assert!(p.exact);
    }

    #[test]
    fn legacy_sonnet_never_gets_promo() {
        let p = pricing_for("claude-sonnet-4-6", "2026-07").unwrap();
        assert_eq!((p.input, p.output), (3.0, 15.0));
    }

    // --- Fast mode (issue #65) ---

    #[test]
    fn fast_mode_doubles_opus_5_across_every_bucket() {
        let p = fast_mode_pricing("claude-opus-5").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_write_1h, p.cache_read),
                   (10.0, 50.0, 12.50, 20.0, 1.00));
    }

    #[test]
    fn fast_mode_covers_opus_4_8_too() {
        assert!(fast_mode_pricing("claude-opus-4-8").is_some());
    }

    /// Fast mode was removed on Opus 4.7 and runs at standard speed and rates on
    /// 4.6, so a stray `speed: "fast"` on those must not upcharge the user.
    #[test]
    fn fast_mode_is_unavailable_on_every_other_model() {
        for id in ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5",
                   "claude-fable-5", "gpt-5.6-sol"] {
            assert!(fast_mode_pricing(id).is_none(), "{id}");
        }
    }

    #[test]
    fn fast_mode_rates_are_exact() {
        assert!(fast_mode_pricing("claude-opus-5").unwrap().exact);
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

    /// gpt-5.3-codex is on OpenAI's page now; its Spark variant still is not.
    #[test]
    fn only_published_codex_rates_are_exact() {
        assert!(pricing_for("gpt-5.3-codex", "2026-08").unwrap().exact);
        assert!(!pricing_for("gpt-5.3-codex-spark", "2026-08").unwrap().exact);
    }

    // --- Rates verified against the vendors' published pricing pages, 2026-11-02 ---

    fn claude_rates(id: &str) -> (f64, f64, f64, f64, f64) {
        let p = pricing_for(id, "2026-11-02").unwrap();
        assert!(p.exact, "{id} should be a verified rate");
        (p.input, p.output, p.cache_write, p.cache_write_1h, p.cache_read)
    }

    #[test]
    fn claude_5_5_generation_has_its_own_rates() {
        assert_eq!(claude_rates("claude-opus-5-5"), (4.0, 20.0, 5.0, 8.0, 0.20));
        assert_eq!(claude_rates("claude-sonnet-5-5"), (2.0, 10.0, 2.5, 4.0, 0.10));
        assert_eq!(claude_rates("claude-haiku-5-5"), (0.10, 0.50, 0.125, 0.20, 0.01));
    }

    #[test]
    fn fable_and_mythos_5_1_read_cache_at_a_quarter_of_5() {
        assert_eq!(claude_rates("claude-fable-5-1"), (10.0, 50.0, 12.5, 20.0, 0.25));
        assert_eq!(claude_rates("claude-mythos-5-1"), (10.0, 50.0, 12.5, 20.0, 0.25));
        assert_eq!(claude_rates("claude-fable-5"), (10.0, 50.0, 12.5, 20.0, 1.0));
    }

    /// Matching on the whole version keeps an unreleased point release from
    /// silently inheriting its predecessor's rate as if it were verified.
    #[test]
    fn an_unknown_point_release_does_not_inherit_a_verified_rate() {
        for id in ["claude-opus-5-6", "claude-sonnet-5-6", "claude-haiku-5-6", "claude-fable-5-2"] {
            assert!(!pricing_for(id, "2026-11-02").unwrap().exact, "{id}");
        }
    }

    #[test]
    fn snapshot_and_platform_suffixes_resolve_to_the_same_rate() {
        for id in ["claude-opus-4-5-20251101", "claude-opus-4-5@20251101",
                   "anthropic.claude-opus-4-5-v1:0", "claude-opus-4-5[1m]"] {
            assert_eq!(claude_rates(id), (5.0, 25.0, 6.25, 10.0, 0.50), "{id}");
        }
    }

    #[test]
    fn opus_4_snapshot_id_is_the_15_75_generation() {
        assert_eq!(claude_rates("claude-opus-4-20250514").0, 15.0);
    }

    #[test]
    fn fast_mode_on_opus_5_5_is_8_40_with_its_own_cache_multiplier() {
        let p = fast_mode_pricing("claude-opus-5-5").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_write_1h, p.cache_read),
                   (8.0, 40.0, 10.0, 16.0, 0.40));
    }

    #[test]
    fn only_haiku_5_5_has_a_long_prompt_tier() {
        let p = long_prompt_pricing("claude-haiku-5-5").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_write_1h, p.cache_read),
                   (0.50, 2.50, 0.625, 1.0, 0.05));
        assert!(long_prompt_pricing("claude-haiku-4-5").is_none());
        assert!(long_prompt_pricing("claude-opus-5-5").is_none());
    }

    fn openai_rates(id: &str, date: &str) -> (f64, f64, f64) {
        let p = pricing_for(id, date).unwrap();
        (p.input, p.output, p.cached_input)
    }

    #[test]
    fn gpt_6_generation_is_priced_exactly() {
        for (id, want) in [("gpt-6-astra", (10.0, 50.0, 1.0)), ("gpt-6-luna", (0.10, 0.50, 0.01)),
                           ("gpt-6-sol", (2.0, 10.0, 0.20)), ("gpt-6.1-sol", (2.0, 10.0, 0.10)),
                           ("gpt-6.1-terra", (1.0, 5.0, 0.05))] {
            assert_eq!(openai_rates(id, "2026-11-02"), want, "{id}");
            assert!(pricing_for(id, "2026-11-02").unwrap().exact, "{id}");
        }
    }

    #[test]
    fn an_unknown_gpt_generation_is_priced_but_flagged() {
        for id in ["gpt-7-sol", "gpt-6.2-sol"] {
            assert!(!pricing_for(id, "2026-11-02").unwrap().exact, "{id}");
        }
    }

    #[test]
    fn gpt_56_sol_follows_its_temporary_cut() {
        assert_eq!(openai_rates("gpt-5.6-sol", "2026-08-20"), (5.0, 30.0, 0.50));
        assert_eq!(openai_rates("gpt-5.6-sol", "2026-08-21"), (4.0, 20.0, 0.40));
        assert!(pricing_for("gpt-5.6-sol", "2026-11-21").unwrap().exact);
        // Nobody has published what follows the announced window.
        assert!(!pricing_for("gpt-5.6-sol", "2026-11-22").unwrap().exact);
    }

    #[test]
    fn gpt_56_luna_and_terra_were_dearer_before_july_30() {
        assert_eq!(openai_rates("gpt-5.6-luna", "2026-07-29"), (1.0, 6.0, 0.10));
        assert_eq!(openai_rates("gpt-5.6-luna", "2026-07-30"), (0.20, 1.20, 0.02));
        assert_eq!(openai_rates("gpt-5.6-terra", "2026-07-29"), (2.50, 15.0, 0.25));
        assert_eq!(openai_rates("gpt-5.6-terra", "2026-07-30"), (2.0, 12.0, 0.20));
        // The pre-cut rates come from press coverage, not the vendor's page.
        assert!(!pricing_for("gpt-5.6-luna", "2026-07-29").unwrap().exact);
    }

    #[test]
    fn small_and_pro_gpt_5_variants_do_not_share_the_base_rate() {
        assert_eq!(openai_rates("gpt-5.4-nano", "2026-11-02"), (0.20, 1.25, 0.02));
        assert_eq!(openai_rates("gpt-5-mini", "2026-11-02"), (0.25, 2.0, 0.025));
        assert_eq!(openai_rates("gpt-5-nano", "2026-11-02"), (0.05, 0.40, 0.005));
        assert_eq!(openai_rates("gpt-5.5-pro", "2026-11-02").0, 30.0);
        assert!(pricing_for("gpt-5.1", "2026-11-02").unwrap().exact);
    }

    #[test]
    fn a_dated_openai_snapshot_is_the_base_model_but_a_named_variant_is_flagged() {
        assert!(pricing_for("gpt-5.4-mini-2026-03-17", "2026-11-02").unwrap().exact);
        let v = pricing_for("gpt-5.2-codex", "2026-11-02").unwrap();
        assert_eq!(v.input, 1.75);
        assert!(!v.exact);
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
