//! Remotely-published overrides for the built-in pricing table (issue #65).
//!
//! Rates in `pricing.rs` are compile-time constants, so a new model or a changed
//! price needs an app release. This module lets a JSON file in the public config
//! repo override them per model, the same way `remote-config.ts` publishes the
//! forced-update policy.
//!
//! Every failure path — offline, 404, malformed JSON, nonsense numbers — leaves
//! the built-in table in charge. A network problem must never cost the user their
//! cost estimates.

use crate::pricing::ModelPricing;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// Same public config repo as the forced-update kill switch.
const PRICING_URL: &str =
    "https://raw.githubusercontent.com/donghoon-bigvalue/token-usage-app-config/main/pricing.json";

const FETCH_TIMEOUT_SECS: u64 = 5;
const STORE_FILE: &str = "pricing-cache.json";
const KEY: &str = "raw";

/// Rates a model's entry may omit are derived from Anthropic's published
/// multipliers on base input.
const CACHE_WRITE_5M_MULT: f64 = 1.25;
const CACHE_WRITE_1H_MULT: f64 = 2.0;
const CACHE_READ_MULT: f64 = 0.1;

/// Anything dearer than this per MTok is treated as a corrupt or tampered entry
/// rather than a real price. Caps the blast radius of a bad config file to
/// "some models fall back to built-in" instead of "the app shows $9e18".
const MAX_RATE_PER_MTOK: f64 = 10_000.0;

/// Model id (lowercased) → rate. Looked up before the built-in table.
#[derive(Debug, Clone, Default)]
pub struct RemoteTable {
    rates: HashMap<String, ModelPricing>,
}

impl RemoteTable {
    /// Exact id match, case-insensitive. Deliberately not a substring match: the
    /// built-in table's substring rules are order-sensitive ("gpt-5.6-sol" also
    /// contains "gpt-5"), and a remotely-editable file should not be able to
    /// shadow unrelated models by accident.
    pub fn get(&self, model: &str) -> Option<ModelPricing> {
        self.rates.get(&model.to_ascii_lowercase()).copied()
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.rates.len()
    }
}

#[derive(Deserialize)]
struct RawTable {
    #[serde(default)]
    models: Vec<RawRate>,
}

/// Unknown fields are ignored (serde's default), so a config file that runs
/// ahead of the app doesn't break older builds.
#[derive(Deserialize)]
struct RawRate {
    id: Option<String>,
    input: Option<f64>,
    output: Option<f64>,
    cache_write: Option<f64>,
    cache_write_1h: Option<f64>,
    cache_read: Option<f64>,
    cached_input: Option<f64>,
    exact: Option<bool>,
}

fn sane(v: f64) -> bool {
    v.is_finite() && (0.0..=MAX_RATE_PER_MTOK).contains(&v)
}

/// Returns None when the payload is unparseable or no entry survives validation,
/// so callers can simply keep whatever they already had.
pub fn parse(json: &str) -> Option<RemoteTable> {
    let raw: RawTable = serde_json::from_str(json).ok()?;
    let mut rates = HashMap::new();
    for r in raw.models {
        if let Some((id, p)) = to_pricing(r) {
            rates.insert(id, p);
        }
    }
    // An empty table would silently mean "no overrides", which is what the
    // caller already has — so say None and let it keep the built-in table.
    if rates.is_empty() { None } else { Some(RemoteTable { rates }) }
}

/// One entry, validated. A bad entry is dropped on its own; it never invalidates
/// the rest of the file.
fn to_pricing(r: RawRate) -> Option<(String, ModelPricing)> {
    let id = r.id?.trim().to_ascii_lowercase();
    if id.is_empty() {
        return None;
    }
    let input = r.input.filter(|v| sane(*v))?;
    let output = r.output.filter(|v| sane(*v))?;

    // A rate that is present must be sane; an absent one is derived, and a
    // multiple of an already-sane input can't itself be nonsense.
    let or_multiple = |given: Option<f64>, mult: f64| match given {
        Some(v) if sane(v) => Some(v),
        Some(_) => None,
        None => Some(input * mult),
    };
    let cache_write = or_multiple(r.cache_write, CACHE_WRITE_5M_MULT)?;
    let cache_write_1h = or_multiple(r.cache_write_1h, CACHE_WRITE_1H_MULT)?;
    let cache_read = or_multiple(r.cache_read, CACHE_READ_MULT)?;
    let cached_input = match r.cached_input {
        Some(v) if sane(v) => v,
        Some(_) => return None,
        None => 0.0,
    };

    Some((id, ModelPricing {
        input,
        output,
        cache_write,
        cache_write_1h,
        cache_read,
        cached_input,
        exact: r.exact.unwrap_or(true),
    }))
}

/// Fetch the published table. Any failure — offline, 404, timeout, garbage —
/// is `None`; the caller keeps whatever it already had.
async fn fetch() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()
        .ok()?;
    let resp = client.get(PRICING_URL).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().await.ok()
}

/// Install the disk-cached table, if there is one. Called at startup so the
/// history screen has last run's rates even when the network is slow or absent.
pub fn seed(app: &AppHandle) {
    let Some(raw) = read_disk(app) else { return };
    if let Some(table) = parse(&raw) {
        crate::pricing::install_overlay(table);
    }
}

/// Fetch the published table, install it, and cache it for the next cold start.
/// Does nothing on any failure, leaving the seeded (or built-in) rates in place.
pub async fn refresh(app: AppHandle) {
    let Some(raw) = fetch().await else { return };
    // Only persist a payload that actually parsed, so a cached copy is never
    // worse than what the built-in table already offers.
    let Some(table) = parse(&raw) else { return };
    crate::pricing::install_overlay(table);
    write_disk(&app, &raw);
}

fn read_disk(app: &AppHandle) -> Option<String> {
    let store = app.store(STORE_FILE).ok()?;
    store.get(KEY)?.as_str().map(str::to_string)
}

fn write_disk(app: &AppHandle, raw: &str) {
    if let Ok(store) = app.store(STORE_FILE) {
        store.set(KEY, serde_json::Value::String(raw.to_string()));
        let _ = store.save();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Manual: hits the real config repo.
    /// Run: cargo test pricing_remote_smoke -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn pricing_remote_smoke() {
        match fetch().await {
            Some(raw) => println!("fetched {} bytes → {:?} entries", raw.len(),
                                  parse(&raw).map(|t| t.len())),
            None => println!("no pricing.json published yet (built-in table stays in charge)"),
        }
    }

    #[test]
    fn parses_a_claude_entry() {
        let t = parse(r#"{"version":1,"models":[
            {"id":"claude-opus-5","input":5,"output":25,
             "cache_write":6.25,"cache_write_1h":10,"cache_read":0.5}]}"#).unwrap();
        let p = t.get("claude-opus-5").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_write_1h, p.cache_read),
                   (5.0, 25.0, 6.25, 10.0, 0.5));
    }

    #[test]
    fn parses_a_codex_entry() {
        let t = parse(r#"{"models":[{"id":"gpt-5.6-sol","input":5,"output":30,"cached_input":0.5}]}"#).unwrap();
        let p = t.get("gpt-5.6-sol").unwrap();
        assert_eq!((p.input, p.output, p.cached_input), (5.0, 30.0, 0.5));
    }

    #[test]
    fn fills_missing_cache_rates_from_the_published_multipliers() {
        let t = parse(r#"{"models":[{"id":"claude-x","input":5,"output":25}]}"#).unwrap();
        let p = t.get("claude-x").unwrap();
        // 1.25x / 2x / 0.1x of base input.
        assert_eq!((p.cache_write, p.cache_write_1h, p.cache_read), (6.25, 10.0, 0.5));
    }

    #[test]
    fn lookup_is_case_insensitive() {
        let t = parse(r#"{"models":[{"id":"GPT-5.6-Sol","input":5,"output":30}]}"#).unwrap();
        assert!(t.get("gpt-5.6-sol").is_some());
    }

    #[test]
    fn drops_an_entry_missing_input_or_output_and_keeps_the_rest() {
        let t = parse(r#"{"models":[
            {"id":"broken","input":5},
            {"id":"fine","input":1,"output":2}]}"#).unwrap();
        assert_eq!(t.len(), 1);
        assert!(t.get("broken").is_none());
        assert!(t.get("fine").is_some());
    }

    #[test]
    fn drops_entries_with_a_missing_or_blank_id() {
        let t = parse(r#"{"models":[
            {"input":1,"output":2},
            {"id":"  ","input":1,"output":2},
            {"id":"fine","input":1,"output":2}]}"#).unwrap();
        assert_eq!(t.len(), 1);
    }

    #[test]
    fn drops_negative_infinite_and_absurd_rates() {
        let t = parse(r#"{"models":[
            {"id":"neg","input":-1,"output":2},
            {"id":"huge","input":1,"output":99999},
            {"id":"badcache","input":1,"output":2,"cache_read":-5},
            {"id":"fine","input":1,"output":2}]}"#).unwrap();
        assert_eq!(t.len(), 1, "only the valid entry may survive");
        assert!(t.get("fine").is_some());
    }

    #[test]
    fn returns_none_when_no_entry_survives() {
        assert!(parse(r#"{"models":[{"id":"neg","input":-1,"output":2}]}"#).is_none());
        assert!(parse(r#"{"models":[]}"#).is_none());
    }

    #[test]
    fn returns_none_for_malformed_json() {
        assert!(parse("not json").is_none());
        assert!(parse("").is_none());
    }

    #[test]
    fn ignores_unknown_fields() {
        let t = parse(r#"{"version":9,"future_key":true,"models":[
            {"id":"fine","input":1,"output":2,"tomorrows_field":"x"}]}"#).unwrap();
        assert!(t.get("fine").is_some());
    }

    #[test]
    fn exact_defaults_to_true_and_can_be_set_false() {
        let t = parse(r#"{"models":[
            {"id":"verified","input":1,"output":2},
            {"id":"guess","input":1,"output":2,"exact":false}]}"#).unwrap();
        assert!(t.get("verified").unwrap().exact);
        assert!(!t.get("guess").unwrap().exact);
    }
}
