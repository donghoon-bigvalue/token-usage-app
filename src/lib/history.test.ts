import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const save = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => save(...a) }));

import { getUsageHistory, downloadUsageXlsx } from "./history";

describe("history lib", () => {
  beforeEach(() => { invoke.mockReset(); save.mockReset(); });

  it("getUsageHistory invokes the command", async () => {
    invoke.mockResolvedValue({ current_month: "2026-07", scanned_at: 1784192400, summaries: [], details: [] });
    const h = await getUsageHistory();
    expect(invoke).toHaveBeenCalledWith("get_usage_history", { refresh: false });
    expect(h.current_month).toBe("2026-07");
  });

  it("downloadUsageXlsx returns false when user cancels dialog", async () => {
    save.mockResolvedValue(null);
    const ok = await downloadUsageXlsx();
    expect(ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("downloadUsageXlsx exports to the chosen path", async () => {
    save.mockResolvedValue("/tmp/usage.xlsx");
    invoke.mockResolvedValue(undefined);
    const ok = await downloadUsageXlsx();
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("export_usage_xlsx", { path: "/tmp/usage.xlsx" });
  });

  it("downloadUsageXlsx offers an .xlsx name and filter", async () => {
    save.mockResolvedValue(null);
    await downloadUsageXlsx();
    const opts = save.mock.calls[0][0];
    expect(opts.defaultPath).toBe("token-usage.xlsx");
    expect(opts.filters[0].extensions).toEqual(["xlsx"]);
  });

  it("downloadUsageXlsx propagates a failed export so the UI can report it", async () => {
    save.mockResolvedValue("/tmp/usage.xlsx");
    invoke.mockRejectedValue("permission denied");
    await expect(downloadUsageXlsx()).rejects.toBe("permission denied");
  });
});
