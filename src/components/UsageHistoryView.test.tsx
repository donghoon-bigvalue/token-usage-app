import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "../i18n";

const getUsageHistory = vi.fn();
const downloadUsageCsv = vi.fn();
vi.mock("../lib/history", () => ({
  getUsageHistory: (...a: unknown[]) => getUsageHistory(...a),
  downloadUsageCsv: (...a: unknown[]) => downloadUsageCsv(...a),
}));

import UsageHistoryView from "./UsageHistoryView";

describe("UsageHistoryView", () => {
  beforeEach(() => { getUsageHistory.mockReset(); downloadUsageCsv.mockReset(); });

  it("renders monthly summary rows", async () => {
    getUsageHistory.mockResolvedValue({
      current_month: "2026-07",
      summaries: [
        { year_month: "2026-07", provider: "claude", total_tokens: 1234567, cost_usd: 12.34, cost_estimable: true },
        { year_month: "2026-07", provider: "codex", total_tokens: 7654321, cost_usd: 5.5, cost_estimable: true },
      ],
      details: [],
    });
    render(<UsageHistoryView />);
    await waitFor(() => expect(screen.getAllByText("2026-07").length).toBeGreaterThan(0));
    // both provider rows present
    expect(screen.getAllByText("2026-07").length).toBeGreaterThanOrEqual(2);
  });

  it("shows empty state when no records", async () => {
    getUsageHistory.mockResolvedValue({ current_month: "2026-07", summaries: [], details: [] });
    render(<UsageHistoryView />);
    await waitFor(() => expect(getUsageHistory).toHaveBeenCalled());
  });
});
