import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "../i18n";

const getUsageHistory = vi.fn();
const downloadUsageCsv = vi.fn();
vi.mock("../lib/history", () => ({
  getUsageHistory: (...a: unknown[]) => getUsageHistory(...a),
  downloadUsageCsv: (...a: unknown[]) => downloadUsageCsv(...a),
}));

import UsageHistoryView from "./UsageHistoryView";

const HISTORY = {
  current_month: "2026-07",
  summaries: [
    { year_month: "2026-07", provider: "claude", total_tokens: 1234567, cost_usd: 12.34, cost_estimable: true },
    { year_month: "2026-07", provider: "codex", total_tokens: 7654321, cost_usd: 5.5, cost_estimable: true },
  ],
  details: [],
};

describe("UsageHistoryView", () => {
  beforeEach(() => { getUsageHistory.mockReset(); downloadUsageCsv.mockReset(); });

  it("renders monthly summary rows", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    render(<UsageHistoryView />);
    await waitFor(() => expect(screen.getAllByText("2026-07").length).toBeGreaterThan(0));
    expect(screen.getAllByText("2026-07").length).toBeGreaterThanOrEqual(2);
  });

  it("shows empty state when no records", async () => {
    getUsageHistory.mockResolvedValue({ current_month: "2026-07", summaries: [], details: [] });
    render(<UsageHistoryView />);
    await waitFor(() => expect(getUsageHistory).toHaveBeenCalled());
    expect(screen.getByText("No usage records yet")).toBeTruthy();
  });

  it("calls downloadUsageCsv when the download button is clicked", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    downloadUsageCsv.mockResolvedValue(true);
    render(<UsageHistoryView />);
    fireEvent.click(await screen.findByText("Download CSV"));
    await waitFor(() => expect(downloadUsageCsv).toHaveBeenCalled());
  });

  it("surfaces a failed download instead of swallowing it", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    downloadUsageCsv.mockRejectedValue("disk full");
    render(<UsageHistoryView />);
    fireEvent.click(await screen.findByText("Download CSV"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("disk full");
    // The button must recover so the user can retry.
    await waitFor(() => {
      expect(screen.getByText<HTMLButtonElement>("Download CSV").closest("button")!.disabled).toBe(false);
    });
  });

  it("reports a failed initial load rather than claiming there is no usage", async () => {
    getUsageHistory.mockRejectedValue("scan failed");
    render(<UsageHistoryView />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("scan failed");
    expect(screen.queryByText("No usage records yet")).toBeNull();
  });

  it("keeps the last good table when a refresh fails", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    render(<UsageHistoryView />);
    await screen.findByText("Download CSV");

    getUsageHistory.mockRejectedValue("scan failed");
    fireEvent.click(screen.getByText("Refresh"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("scan failed");
    // Table survives — a failed refresh must not blank out the view.
    expect(screen.getAllByText("2026-07").length).toBeGreaterThan(0);
  });
});
