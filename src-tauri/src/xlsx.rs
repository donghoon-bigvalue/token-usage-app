//! XLSX export for monthly usage (issue #19).
//!
//! Two sheets with identical numbers — one English, one Korean. Each sheet lists
//! per-model detail rows grouped by (month, provider), with a shaded total row
//! closing every group.

use rust_xlsxwriter::{Color, Format, FormatAlign, Workbook, Worksheet, XlsxError};

use crate::model::{MonthlyDetail, ProviderId, UsageHistory};

/// Sheet name and column labels for one language.
struct Labels {
    sheet: &'static str,
    headers: [&'static str; 10],
    total: &'static str,
}

const EN: Labels = Labels {
    sheet: "Usage",
    headers: [
        "Month", "Provider", "Model", "Input tokens", "Output tokens",
        "Cache write", "Cache read", "Cached input", "Total tokens", "Cost (USD)",
    ],
    total: "Total",
};

const KO: Labels = Labels {
    sheet: "사용량",
    headers: [
        "연월", "서비스", "모델", "입력 토큰", "출력 토큰",
        "캐시 쓰기", "캐시 읽기", "캐시 입력", "전체 토큰", "추정 비용($)",
    ],
    total: "합계",
};

/// Provider names stay untranslated — they are product names in both locales.
fn provider_name(p: ProviderId) -> &'static str {
    match p {
        ProviderId::Claude => "Claude",
        ProviderId::Codex => "Codex",
    }
}

/// The five raw token columns plus the total, in column order.
fn token_cells(d: &MonthlyDetail) -> [u64; 6] {
    [
        d.raw_input_tokens, d.raw_output_tokens, d.raw_cache_write_tokens,
        d.raw_cache_read_tokens, d.raw_cached_input_tokens, d.total_tokens,
    ]
}

/// Render the usage history as a two-sheet XLSX workbook.
pub fn to_xlsx(history: &UsageHistory) -> Result<Vec<u8>, XlsxError> {
    let mut wb = Workbook::new();
    for labels in [&EN, &KO] {
        let sheet = wb.add_worksheet();
        write_sheet(sheet, labels, history)?;
    }
    wb.save_to_buffer()
}

fn write_sheet(sheet: &mut Worksheet, l: &Labels, history: &UsageHistory) -> Result<(), XlsxError> {
    let header = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::Black)
        .set_align(FormatAlign::Center);
    let tokens = Format::new().set_num_format("#,##0");
    let money = Format::new().set_num_format("0.0000");
    let shaded = Format::new().set_bold().set_background_color(Color::RGB(0xD9D9D9));
    let shaded_tokens = shaded.clone().set_num_format("#,##0");
    let shaded_money = shaded.clone().set_num_format("0.0000");

    sheet.set_name(l.sheet)?;
    for (col, label) in l.headers.iter().enumerate() {
        sheet.write_string_with_format(0, col as u16, *label, &header)?;
    }

    let mut row = 1u32;
    let mut i = 0;
    while i < history.details.len() {
        let head = &history.details[i];
        let end = history.details[i..]
            .iter()
            .position(|d| d.year_month != head.year_month || d.provider != head.provider)
            .map_or(history.details.len(), |offset| i + offset);
        let group = &history.details[i..end];

        for d in group {
            sheet.write_string(row, 0, &d.year_month)?;
            sheet.write_string(row, 1, provider_name(d.provider))?;
            sheet.write_string(row, 2, &d.model)?;
            for (n, value) in token_cells(d).iter().enumerate() {
                sheet.write_number_with_format(row, 3 + n as u16, *value as f64, &tokens)?;
            }
            // An unpriced model leaves the cell blank rather than claiming $0.
            if let Some(cost) = d.cost_usd {
                sheet.write_number_with_format(row, 9, cost, &money)?;
            }
            row += 1;
        }

        // Shaded total row closing the group. Costs sum only the priced models,
        // matching how `aggregate` builds its summaries.
        sheet.write_string_with_format(row, 0, &head.year_month, &shaded)?;
        sheet.write_string_with_format(row, 1, provider_name(head.provider), &shaded)?;
        sheet.write_string_with_format(row, 2, l.total, &shaded)?;
        for n in 0..6 {
            let sum: u64 = group.iter().map(|d| token_cells(d)[n]).sum();
            sheet.write_number_with_format(row, 3 + n as u16, sum as f64, &shaded_tokens)?;
        }
        let cost: f64 = group.iter().filter_map(|d| d.cost_usd).sum();
        sheet.write_number_with_format(row, 9, cost, &shaded_money)?;
        row += 1;

        i = end;
    }

    sheet.autofit();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::aggregate;
    use crate::model::{ProviderId, UsageRecord};
    use calamine::{Data, DataType, Reader, Xlsx};
    use std::io::Cursor;

    fn rec(ym: &str, p: ProviderId, model: &str, i: u64, o: u64) -> UsageRecord {
        UsageRecord {
            year_month: ym.into(), provider: p, model: model.into(),
            input_tokens: i, output_tokens: o,
            cache_write_tokens: 0, cache_read_tokens: 0, cached_input_tokens: 0,
        }
    }

    fn open(bytes: Vec<u8>) -> Xlsx<Cursor<Vec<u8>>> {
        Xlsx::new(Cursor::new(bytes)).unwrap()
    }

    fn rows(wb: &mut Xlsx<Cursor<Vec<u8>>>, sheet: &str) -> Vec<Vec<Data>> {
        wb.worksheet_range(sheet).unwrap().rows().map(<[Data]>::to_vec).collect()
    }

    fn text(cell: &Data) -> String {
        match cell {
            Data::String(s) => s.clone(),
            other => other.to_string(),
        }
    }

    fn num(cell: &Data) -> f64 {
        cell.get_float().unwrap_or_else(|| panic!("expected a number, got {cell:?}"))
    }

    #[test]
    fn workbook_has_an_english_and_a_korean_sheet() {
        let h = aggregate(vec![rec("2026-07", ProviderId::Claude, "claude-sonnet-5", 1_000_000, 0)], "2026-07".into(), 1_700_000_000);
        let wb = open(to_xlsx(&h).unwrap());
        assert_eq!(wb.sheet_names(), vec!["Usage".to_string(), "사용량".to_string()]);
    }

    #[test]
    fn english_sheet_has_header_detail_and_total_rows() {
        let h = aggregate(vec![rec("2026-07", ProviderId::Claude, "claude-sonnet-5", 1_000_000, 1_000_000)], "2026-07".into(), 1_700_000_000);
        let mut wb = open(to_xlsx(&h).unwrap());
        let r = rows(&mut wb, "Usage");

        assert_eq!(text(&r[0][0]), "Month");
        assert_eq!(text(&r[0][1]), "Provider");
        assert_eq!(text(&r[0][2]), "Model");
        assert_eq!(text(&r[0][9]), "Cost (USD)");

        // Detail row: sonnet-5 intro promo at 2026-07: 1M input @$2 + 1M output @$10 = $12.
        assert_eq!(text(&r[1][0]), "2026-07");
        assert_eq!(text(&r[1][1]), "Claude");
        assert_eq!(text(&r[1][2]), "claude-sonnet-5");
        assert_eq!(num(&r[1][8]), 2_000_000.0);
        assert!((num(&r[1][9]) - 12.0).abs() < 1e-9);

        // Total row closes the (month, provider) group.
        assert_eq!(text(&r[2][2]), "Total");
        assert_eq!(num(&r[2][8]), 2_000_000.0);
        assert!((num(&r[2][9]) - 12.0).abs() < 1e-9);
        assert_eq!(r.len(), 3);
    }

    #[test]
    fn total_row_sums_every_model_in_the_group() {
        let h = aggregate(
            vec![
                rec("2026-07", ProviderId::Claude, "claude-sonnet-5", 1_000_000, 0),
                rec("2026-07", ProviderId::Claude, "claude-haiku-4-5", 1_000_000, 0),
            ],
            "2026-07".into(),
            1_700_000_000,
        );
        let mut wb = open(to_xlsx(&h).unwrap());
        let r = rows(&mut wb, "Usage");

        // Two detail rows, then one total: sonnet (intro promo) $2 + haiku $1 = $3 over 2M tokens.
        assert_eq!(r.len(), 4);
        assert_eq!(text(&r[3][2]), "Total");
        assert_eq!(num(&r[3][8]), 2_000_000.0);
        assert!((num(&r[3][9]) - 3.0).abs() < 1e-9);
    }

    #[test]
    fn each_month_provider_group_gets_its_own_total() {
        let h = aggregate(
            vec![
                rec("2026-07", ProviderId::Claude, "claude-sonnet-5", 1_000_000, 0),
                rec("2026-07", ProviderId::Codex, "gpt-5.5", 1_000_000, 0),
                rec("2026-06", ProviderId::Claude, "claude-sonnet-5", 1_000_000, 0),
            ],
            "2026-07".into(),
            1_700_000_000,
        );
        let mut wb = open(to_xlsx(&h).unwrap());
        let r = rows(&mut wb, "Usage");

        // header + 3 × (1 detail + 1 total) = 7 rows, newest month first.
        assert_eq!(r.len(), 7);
        let totals: Vec<String> = r.iter().skip(1).filter(|row| text(&row[2]) == "Total")
            .map(|row| format!("{}/{}", text(&row[0]), text(&row[1]))).collect();
        assert_eq!(totals, vec!["2026-07/Claude", "2026-07/Codex", "2026-06/Claude"]);
    }

    #[test]
    fn korean_sheet_mirrors_the_numbers_with_korean_labels() {
        let h = aggregate(vec![rec("2026-07", ProviderId::Claude, "claude-sonnet-5", 1_000_000, 1_000_000)], "2026-07".into(), 1_700_000_000);
        let mut wb = open(to_xlsx(&h).unwrap());
        let en = rows(&mut wb, "Usage");
        let ko = rows(&mut wb, "사용량");

        assert_eq!(text(&ko[0][0]), "연월");
        assert_eq!(text(&ko[0][2]), "모델");
        assert_eq!(text(&ko[0][9]), "추정 비용($)");
        assert_eq!(text(&ko[2][2]), "합계");

        // Same shape, same numbers as the English sheet.
        assert_eq!(ko.len(), en.len());
        assert_eq!(num(&ko[1][8]), num(&en[1][8]));
        assert_eq!(num(&ko[2][9]), num(&en[2][9]));
    }

    #[test]
    fn unknown_model_leaves_the_cost_cell_empty() {
        let h = aggregate(vec![rec("2026-07", ProviderId::Claude, "weird-model", 1_000_000, 0)], "2026-07".into(), 1_700_000_000);
        let mut wb = open(to_xlsx(&h).unwrap());
        let r = rows(&mut wb, "Usage");
        assert!(r[1][9].is_empty(), "unpriced model must not claim a cost, got {:?}", r[1][9]);
    }
}
