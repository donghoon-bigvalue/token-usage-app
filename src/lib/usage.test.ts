import { describe, it, expect } from "vitest";
import { mergeReport } from "./usage";
import type { UsageReport, UsageSnapshot } from "./types";

function snap(over: Partial<UsageSnapshot>): UsageSnapshot {
  return {
    provider: "claude",
    plan: "Max",
    plan_raw: "max",
    source: "live",
    updated_at: 1,
    windows: [{ id: "claude_session", used_percent: 5, resets_at: null, available: true }],
    error: null,
    ...over,
  };
}
const report = (claude: UsageSnapshot, codex: UsageSnapshot): UsageReport => ({ claude, codex });

describe("mergeReport", () => {
  it("keeps last good snapshot when a refresh fails transiently", () => {
    const good = report(snap({}), snap({ provider: "codex" }));
    const failed = report(
      snap({ error: "request failed", windows: [] }),
      snap({ provider: "codex" }),
    );
    const merged = mergeReport(good, failed);
    // Claude failed transiently → keep the prior good snapshot (chart stays).
    expect(merged.claude.error).toBeNull();
    expect(merged.claude.windows).toHaveLength(1);
  });

  it("surfaces an auth error even when prior data was good", () => {
    const good = report(snap({}), snap({ provider: "codex" }));
    const noAuth = report(
      snap({ error: "credentials not found", windows: [] }),
      snap({ provider: "codex" }),
    );
    const merged = mergeReport(good, noAuth);
    expect(merged.claude.error).toBe("credentials not found");
  });

  it("replaces with fresh data when the new snapshot succeeds", () => {
    const stale = report(snap({ updated_at: 1 }), snap({ provider: "codex" }));
    const fresh = report(snap({ updated_at: 999 }), snap({ provider: "codex" }));
    expect(mergeReport(stale, fresh).claude.updated_at).toBe(999);
  });

  it("shows the error when there is no prior good data", () => {
    const failed = report(
      snap({ error: "request failed" }),
      snap({ provider: "codex", error: "request failed" }),
    );
    expect(mergeReport(null, failed).claude.error).toBe("request failed");
  });
});
