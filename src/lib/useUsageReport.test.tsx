import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { UsageReport } from "./types";

const report: UsageReport = {
  claude: { provider: "claude", plan: "Max 20x", plan_raw: "max", source: "live", updated_at: 10, windows: [{ id: "claude_session", used_percent: 5, resets_at: 999999999, available: true }], error: null },
  codex: { provider: "codex", plan: "Pro", plan_raw: "pro", source: "live", updated_at: 10, windows: [{ id: "codex_weekly", used_percent: 11, resets_at: 999999999, available: true }], error: null },
};

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { useUsageReport } from "./useUsageReport";
import { invoke } from "@tauri-apps/api/core";

describe("useUsageReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.resolve(report) : Promise.resolve(null)) as never);
  });

  it("loads the usage report on mount", async () => {
    const { result } = renderHook(() => useUsageReport());
    await waitFor(() => expect(result.current.report?.claude.plan).toBe("Max 20x"));
    expect(result.current.loadFailed).toBeNull();
  });

  it("refetches on reload()", async () => {
    const { result } = renderHook(() => useUsageReport());
    await waitFor(() => expect(result.current.report).not.toBeNull());
    const before = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "get_usage").length;
    await act(async () => { await result.current.reload(); });
    const after = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "get_usage").length;
    expect(after).toBe(before + 1);
  });

  it("records loadFailed when the fetch rejects", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.reject(new Error("cli missing")) : Promise.resolve(null)) as never);
    const { result } = renderHook(() => useUsageReport());
    await waitFor(() => expect(result.current.loadFailed).toBe("cli missing"));
  });
});
