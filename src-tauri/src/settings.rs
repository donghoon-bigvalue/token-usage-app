use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    pub language: String,
    pub theme: String,
    pub refresh_interval_secs: u64,
    pub notify_thresholds: Vec<u8>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "en".into(),
            theme: "system".into(),
            refresh_interval_secs: 60,
            notify_thresholds: vec![80, 100],
        }
    }
}

pub fn sanitize(mut s: Settings) -> Settings {
    if s.refresh_interval_secs < 15 {
        s.refresh_interval_secs = 15;
    }
    let mut t: Vec<u8> = s.notify_thresholds.into_iter().map(|v| v.min(100)).collect();
    t.sort_unstable();
    t.dedup();
    s.notify_thresholds = t;
    if !matches!(s.theme.as_str(), "light" | "dark" | "system") {
        s.theme = "system".into();
    }
    if !matches!(s.language.as_str(), "en" | "ko") {
        s.language = "en".into();
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_values() {
        let s = Settings::default();
        assert_eq!(s.language, "en");
        assert_eq!(s.theme, "system");
        assert_eq!(s.refresh_interval_secs, 60);
        assert_eq!(s.notify_thresholds, vec![80, 100]);
    }

    #[test]
    fn sanitize_clamps_interval_and_thresholds() {
        let s = sanitize(Settings {
            language: "ko".into(),
            theme: "dark".into(),
            refresh_interval_secs: 3,
            notify_thresholds: vec![100, 80, 80, 150],
        });
        assert_eq!(s.refresh_interval_secs, 15);
        assert_eq!(s.notify_thresholds, vec![80, 100]); // 정렬·중복제거·클램프
    }
}
