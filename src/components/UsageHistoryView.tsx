import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getUsageHistory, downloadUsageXlsx } from "../lib/history";
import type { UsageHistory } from "../lib/types";
import { formatTokens, formatUsd } from "../lib/format";
import { HistorySkeleton } from "./HistorySkeleton";

const ACCENT: Record<"claude" | "codex", string> = {
  claude: "#D97757",
  codex: "#5162ED",
};

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * `refreshSignal` is bumped by the Header's refresh button — this view has no
 * refresh control of its own, so there is exactly one refresh affordance per tab.
 * `onScannedAt` reports the scan time back up so the Header can show it.
 */
export default function UsageHistoryView({
  refreshSignal = 0,
  onScannedAt,
  onLoadingChange,
}: {
  refreshSignal?: number;
  onScannedAt?: (unixSeconds: number) => void;
  onLoadingChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [history, setHistory] = useState<UsageHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // App owns the counter and keeps it across tab switches, so a non-zero signal
  // says nothing on its own — only a *change* since this mount is a refresh.
  // Comparing against 0 instead would rescan on every tab switch once the user
  // has hit refresh even once, defeating the backend cache.
  const seenSignal = useRef(refreshSignal);
  // Held in a ref so an inline callback from the parent can't re-trigger the
  // effect — that would rescan on every render.
  const onScannedAtRef = useRef(onScannedAt);
  onScannedAtRef.current = onScannedAt;
  const onLoadingChangeRef = useRef(onLoadingChange);
  onLoadingChangeRef.current = onLoadingChange;

  useEffect(() => {
    let alive = true;
    const isRefresh = refreshSignal !== seenSignal.current;
    seenSignal.current = refreshSignal;
    // A refresh keeps the old table on screen; only a cold mount blanks it.
    if (!isRefresh) setLoading(true);
    onLoadingChangeRef.current?.(true);
    getUsageHistory(isRefresh)
      .then((h) => {
        if (!alive) return;
        setHistory(h);
        setLoadError(null);
        onScannedAtRef.current?.(h.scanned_at);
      })
      .catch((e) => { if (alive) setLoadError(reason(e)); })
      .finally(() => {
        // Only a live run reports. A superseded run (cleanup already set alive
        // false) staying silent is what keeps back-to-back refreshes from
        // stopping the spinner early; App clears the flags when the tab closes,
        // so a dead mount never speaks for a live one.
        if (alive) {
          onLoadingChangeRef.current?.(false);
          setLoading(false);
        }
      });
    return () => { alive = false; };
  }, [refreshSignal]);

  const onDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadUsageXlsx();
    } catch (e) {
      setDownloadError(reason(e));
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div role="status" aria-label={t("app.loading")}>
        <HistorySkeleton />
      </div>
    );
  }
  // A failed load must not masquerade as "no usage yet".
  if (loadError && !history) {
    return <div className="error-banner" role="alert">{t("history.loadFailed")}: {loadError}</div>;
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
        <p className="error-banner" role="alert">{t("history.refreshFailed")}: {loadError}</p>
      )}
      {downloadError && (
        <p className="error-banner" role="alert">{t("history.downloadFailed")}: {downloadError}</p>
      )}
    </div>
  );
}
