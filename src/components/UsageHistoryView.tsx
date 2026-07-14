import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getUsageHistory, downloadUsageCsv } from "../lib/history";
import type { UsageHistory } from "../lib/types";
import { formatTokens, formatUsd } from "../lib/format";

const ACCENT: Record<"claude" | "codex", string> = {
  claude: "#D97757",
  codex: "#5162ED",
};

export default function UsageHistoryView() {
  const { t } = useTranslation();
  const [history, setHistory] = useState<UsageHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getUsageHistory()
      .then((h) => { if (alive) setHistory(h); })
      .catch(() => { if (alive) setHistory(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="history-loading">…</div>;
  if (!history || history.summaries.length === 0) {
    return <div className="empty-state">{t("history.empty")}</div>;
  }

  const current = history.summaries.filter((s) => s.year_month === history.current_month);
  const providers: Array<"claude" | "codex"> = ["claude", "codex"];

  const onDownload = async () => {
    setDownloading(true);
    try { await downloadUsageCsv(); } finally { setDownloading(false); }
  };

  return (
    <div className="history-view">
      <section className="history-current">
        <h2>{t("history.thisMonth")}</h2>
        <div className="history-cards">
          {providers.map((p) => {
            const s = current.find((c) => c.provider === p);
            return (
              <div key={p} className="history-card" style={{ borderColor: ACCENT[p] }}>
                <span className="history-card-title" style={{ color: ACCENT[p] }}>
                  {t(`provider.${p}`)}
                </span>
                <span className="history-card-tokens">
                  {formatTokens(s?.total_tokens ?? 0)} {t("history.tokens")}
                </span>
                <span className="history-card-cost">{formatUsd(s ? s.cost_usd : 0)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <p className="history-note">{t("history.estimateNote")}</p>

      <table className="history-table">
        <thead>
          <tr>
            <th>{t("history.colMonth")}</th>
            <th>{t("history.colProvider")}</th>
            <th>{t("history.colTokens")}</th>
            <th>{t("history.colCost")}</th>
          </tr>
        </thead>
        <tbody>
          {history.summaries.map((s) => (
            <tr key={`${s.year_month}-${s.provider}`}>
              <td>{s.year_month}</td>
              <td style={{ color: ACCENT[s.provider] }}>{t(`provider.${s.provider}`)}</td>
              <td>{formatTokens(s.total_tokens)}</td>
              <td>
                {formatUsd(s.cost_usd)}
                {!s.cost_estimable && <span className="history-warn" title={t("history.notEstimable")}> ≈</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="history-download" onClick={onDownload} disabled={downloading}>
        {t("history.download")}
      </button>
    </div>
  );
}
