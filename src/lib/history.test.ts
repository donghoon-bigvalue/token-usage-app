import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const save = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => save(...a) }));

import { getUsageHistory, downloadUsageCsv } from "./history";

describe("history lib", () => {
  beforeEach(() => { invoke.mockReset(); save.mockReset(); });

  it("getUsageHistory invokes the command", async () => {
    invoke.mockResolvedValue({ current_month: "2026-07", summaries: [], details: [] });
    const h = await getUsageHistory();
    expect(invoke).toHaveBeenCalledWith("get_usage_history", { refresh: false });
    expect(h.current_month).toBe("2026-07");
  });

  it("downloadUsageCsv returns false when user cancels dialog", async () => {
    save.mockResolvedValue(null);
    const ok = await downloadUsageCsv();
    expect(ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("downloadUsageCsv exports to the chosen path", async () => {
    save.mockResolvedValue("/tmp/usage.csv");
    invoke.mockResolvedValue(undefined);
    const ok = await downloadUsageCsv();
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("export_usage_csv", { path: "/tmp/usage.csv" });
  });
});
