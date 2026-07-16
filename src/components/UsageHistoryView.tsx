import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getUsageHistory, downloadUsageCsv } from "../lib/history";
import type { UsageHistory } from "../lib/types";
import { formatTokens, formatUsd } from "../lib/format";

const ACCENT: Record<"claude" | "codex", string> = {
  claude: "#D97757",
  codex: "#5162ED",
};

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function UsageHistoryView() {
  const { t } = useTranslation();
  const [history, setHistory] = useState<UsageHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getUsageHistory()
      .then((h) => { if (alive) { setHistory(h); setLoadError(null); } })
      .catch((e) => { if (alive) setLoadError(reason(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const h = await getUsageHistory(true);
      setHistory(h);
      setLoadError(null);
    } catch (e) {
      // Keep showing the last good history, but say so rather than going quiet.
      setLoadError(reason(e));
    } finally {
      setRefreshing(false);
    }
  };

  const onDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadUsageCsv();
    } catch (e) {
      setDownloadError(reason(e));
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <div className="history-loading">…</div>;
  // A failed load must not masquerade as "no usage yet".
  if (loadError && !history) {
    return <div className="history-error" role="alert">{t("history.loadFailed")}: {loadError}</div>;
  }
  if (!history || history.summaries.length === 0) {
    return <div className="empty-state">{t("history.empty")}</div>;
  }

  const current = history.summaries.filter((s) => s.year_month === history.current_month);
  const providers: Array<"claude" | "codex"> = ["claude", "codex"];

  return (
    <div className="history-view">
      <section className="history-current">
        <h2>{t("history.thisMonth")}</h2>
        <button className="history-refresh" onClick={onRefresh} disabled={refreshing}>
          {t("app.refresh")}
        </button>
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
                <span className="history-card-cost">
                  {formatUsd(s ? s.cost_usd : 0)}
                  {s && !s.cost_estimable && (
                    <span className="history-warn" title={t("history.notEstimable")}> ≈</span>
                  )}
                </span>
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

      {loadError && (
        <p className="history-error" role="alert">{t("history.refreshFailed")}: {loadError}</p>
      )}
      {downloadError && (
        <p className="history-error" role="alert">{t("history.downloadFailed")}: {downloadError}</p>
      )}
    </div>
  );
}
