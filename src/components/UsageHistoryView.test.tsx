import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import "../i18n";

const getUsageHistory = vi.fn();
const downloadUsageXlsx = vi.fn();
vi.mock("../lib/history", () => ({
  getUsageHistory: (...a: unknown[]) => getUsageHistory(...a),
  downloadUsageXlsx: (...a: unknown[]) => downloadUsageXlsx(...a),
}));

import UsageHistoryView from "./UsageHistoryView";

const HISTORY = {
  current_month: "2026-07",
  scanned_at: 1784192400,
  summaries: [
    { year_month: "2026-07", provider: "claude", total_tokens: 1234567, cost_usd: 12.34, cost_estimable: true },
    { year_month: "2026-07", provider: "codex", total_tokens: 7654321, cost_usd: 5.5, cost_estimable: true },
  ],
  details: [],
};

describe("UsageHistoryView", () => {
  beforeEach(() => { getUsageHistory.mockReset(); downloadUsageXlsx.mockReset(); });

  it("renders monthly summary rows", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    render(<UsageHistoryView />);
    await waitFor(() => expect(screen.getAllByText("2026-07").length).toBeGreaterThan(0));
    expect(screen.getAllByText("2026-07").length).toBeGreaterThanOrEqual(2);
  });

  it("shows empty state when no records", async () => {
    getUsageHistory.mockResolvedValue({ current_month: "2026-07", scanned_at: 1784192400, summaries: [], details: [] });
    render(<UsageHistoryView />);
    await waitFor(() => expect(getUsageHistory).toHaveBeenCalled());
    expect(screen.getByText("No usage records yet")).toBeTruthy();
  });

  it("calls downloadUsageXlsx when the download button is clicked", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    downloadUsageXlsx.mockResolvedValue(true);
    render(<UsageHistoryView />);
    fireEvent.click(await screen.findByText("Download Excel"));
    await waitFor(() => expect(downloadUsageXlsx).toHaveBeenCalled());
  });

  it("surfaces a failed download instead of swallowing it", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    downloadUsageXlsx.mockRejectedValue("disk full");
    render(<UsageHistoryView />);
    fireEvent.click(await screen.findByText("Download Excel"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("disk full");
    // The button must recover so the user can retry.
    await waitFor(() => {
      expect(screen.getByText<HTMLButtonElement>("Download Excel").closest("button")!.disabled).toBe(false);
    });
  });

  it("reports a failed initial load rather than claiming there is no usage", async () => {
    getUsageHistory.mockRejectedValue("scan failed");
    render(<UsageHistoryView />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("scan failed");
    expect(screen.queryByText("No usage records yet")).toBeNull();
  });

  it("has no refresh button of its own — the header owns refresh", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    render(<UsageHistoryView />);
    await screen.findByText("Download Excel");
    expect(screen.queryByText("Refresh")).toBeNull();
  });

  it("refetches with refresh=true when the header bumps the refresh signal", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    const { rerender } = render(<UsageHistoryView refreshSignal={0} />);
    await waitFor(() => expect(getUsageHistory).toHaveBeenCalledWith(false));

    rerender(<UsageHistoryView refreshSignal={1} />);
    await waitFor(() => expect(getUsageHistory).toHaveBeenCalledWith(true));
    expect(getUsageHistory).toHaveBeenCalledTimes(2);
  });

  it("uses the cache when remounting with a signal left over from an earlier visit", async () => {
    // Switching tabs unmounts this view, but App keeps the counter. Mounting with
    // a non-zero signal is a fresh mount, not a refresh — it must not rescan.
    getUsageHistory.mockResolvedValue(HISTORY);
    render(<UsageHistoryView refreshSignal={3} />);
    await waitFor(() => expect(getUsageHistory).toHaveBeenCalled());
    expect(getUsageHistory).toHaveBeenCalledWith(false);
  });

  it("reports the scan time so the header can show it", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    const onScannedAt = vi.fn();
    render(<UsageHistoryView onScannedAt={onScannedAt} />);
    await waitFor(() => expect(onScannedAt).toHaveBeenCalledWith(1784192400));
  });

  it("keeps the last good table when a refresh fails", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    const { rerender } = render(<UsageHistoryView refreshSignal={0} />);
    await screen.findByText("Download Excel");

    getUsageHistory.mockRejectedValue("scan failed");
    rerender(<UsageHistoryView refreshSignal={1} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("scan failed");
    // Table survives — a failed refresh must not blank out the view.
    expect(screen.getAllByText("2026-07").length).toBeGreaterThan(0);
  });

  it("shows a table-shaped skeleton on a cold load, not an ellipsis", async () => {
    let release!: (h: typeof HISTORY) => void;
    getUsageHistory.mockReturnValue(new Promise((res) => { release = res; }));

    render(<UsageHistoryView />);

    expect(screen.getByTestId("history-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("…")).toBeNull();

    release(HISTORY);
    await screen.findByText("Download Excel");
    expect(screen.queryByTestId("history-skeleton")).toBeNull();
  });

  it("keeps the table on screen during a refresh instead of falling back to the skeleton", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    const { rerender } = render(<UsageHistoryView refreshSignal={0} />);
    await screen.findByText("Download Excel");

    let release!: (h: typeof HISTORY) => void;
    getUsageHistory.mockReturnValue(new Promise((res) => { release = res; }));
    rerender(<UsageHistoryView refreshSignal={1} />);

    // Data the user has already read must not revert to grey blocks.
    expect(screen.queryByTestId("history-skeleton")).toBeNull();
    expect(screen.getAllByText("2026-07").length).toBeGreaterThan(0);

    release(HISTORY);
    await waitFor(() => expect(getUsageHistory).toHaveBeenCalledTimes(2));
  });

  it("reports load progress for both cold loads and refreshes", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    const onLoadingChange = vi.fn();
    const { rerender } = render(<UsageHistoryView refreshSignal={0} onLoadingChange={onLoadingChange} />);

    await waitFor(() => expect(onLoadingChange).toHaveBeenLastCalledWith(false));
    expect(onLoadingChange.mock.calls.map((c) => c[0])).toEqual([true, false]);

    rerender(<UsageHistoryView refreshSignal={1} onLoadingChange={onLoadingChange} />);
    await waitFor(() => expect(onLoadingChange.mock.calls.map((c) => c[0])).toEqual([true, false, true, false]));
  });

  it("reports progress as finished when a scan fails, so the caller can stop spinning", async () => {
    getUsageHistory.mockRejectedValue("scan failed");
    const onLoadingChange = vi.fn();
    render(<UsageHistoryView onLoadingChange={onLoadingChange} />);

    await screen.findByRole("alert");
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps reporting busy when a superseded scan resolves after a newer one started", async () => {
    let releaseFirst!: (h: typeof HISTORY) => void;
    getUsageHistory.mockReturnValueOnce(new Promise((res) => { releaseFirst = res; }));
    const onLoadingChange = vi.fn();
    const { rerender } = render(<UsageHistoryView refreshSignal={0} onLoadingChange={onLoadingChange} />);

    // A second scan starts while the first is still in flight.
    let releaseSecond!: (h: typeof HISTORY) => void;
    getUsageHistory.mockReturnValueOnce(new Promise((res) => { releaseSecond = res; }));
    rerender(<UsageHistoryView refreshSignal={1} onLoadingChange={onLoadingChange} />);

    // Drain the stale scan's whole .then/.catch/.finally chain before asserting,
    // so the assertion tests the guard rather than microtask timing.
    await act(async () => { releaseFirst(HISTORY); });
    // The stale scan must not clear the flag — scan two is still running.
    expect(onLoadingChange).toHaveBeenLastCalledWith(true);

    await act(async () => { releaseSecond(HISTORY); });
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });

  it("goes silent after unmount — a dead scan must not speak for a live one", async () => {
    let release!: (h: typeof HISTORY) => void;
    getUsageHistory.mockReturnValue(new Promise((res) => { release = res; }));
    const onLoadingChange = vi.fn();
    const { unmount } = render(<UsageHistoryView onLoadingChange={onLoadingChange} />);
    await waitFor(() => expect(onLoadingChange).toHaveBeenCalledWith(true));

    // The user switches tabs mid-scan; App owns the flag and clears it itself.
    unmount();
    onLoadingChange.mockClear();
    await act(async () => { release(HISTORY); });

    expect(onLoadingChange).not.toHaveBeenCalled();
  });

  it("marks the download button busy while the export runs", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    let release!: () => void;
    downloadUsageXlsx.mockReturnValue(new Promise<void>((res) => { release = res; }));

    render(<UsageHistoryView />);
    const label = await screen.findByText("Download Excel");
    const button = label.closest("button")!;
    expect(button.getAttribute("aria-busy")).toBe("false");

    fireEvent.click(label);
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));

    release();
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("false"));
  });
});
