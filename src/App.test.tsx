import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "./i18n";
import type { UsageReport, Settings } from "./lib/types";

const report: UsageReport = {
  claude: { provider: "claude", plan: "Max 20x", plan_raw: "max", source: "live", updated_at: 10, windows: [{ id: "claude_session", used_percent: 5, resets_at: 999999999, available: true }], error: null },
  codex: { provider: "codex", plan: "Pro", plan_raw: "pro", source: "live", updated_at: 10, windows: [{ id: "codex_weekly", used_percent: 11, resets_at: 999999999, available: true }], error: null },
};
const settings: Settings = { language: "en", theme: "light", refresh_interval_secs: 60, notify_thresholds: [80, 100] };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_usage") return Promise.resolve(report);
    if (cmd === "get_settings") return Promise.resolve(settings);
    if (cmd === "set_settings") return Promise.resolve(settings);
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import App from "./App";

describe("App", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders both provider cards with plans", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Max 20x")).toBeInTheDocument();
      expect(screen.getByText("Pro")).toBeInTheDocument();
    });
  });
});
