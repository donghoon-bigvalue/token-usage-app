import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import "./i18n";
import type { UsageReport, Settings, UsageHistory } from "./lib/types";

const report: UsageReport = {
  claude: { provider: "claude", plan: "Max 20x", plan_raw: "max", source: "live", updated_at: 10, windows: [{ id: "claude_session", used_percent: 5, resets_at: 999999999, available: true }], error: null },
  codex: { provider: "codex", plan: "Pro", plan_raw: "pro", source: "live", updated_at: 10, windows: [{ id: "codex_weekly", used_percent: 11, resets_at: 999999999, available: true }], error: null },
};
const settings: Settings = { language: "en", theme: "light", refresh_interval_secs: 60, notify_thresholds: [80, 100] };

// 2026-07-16 09:00:00Z — distinct from the limits snapshot's updated_at so the
// header can't accidentally pass by showing the wrong one.
const SCANNED_AT = 1784192400;
const history: UsageHistory = {
  current_month: "2026-07",
  scanned_at: SCANNED_AT,
  // Buckets must reconcile: input + output + cache_read + cache_write === total_tokens,
  // and direct_tokens === input_tokens + output_tokens.
  summaries: [{
    year_month: "2026-07", provider: "claude",
    input_tokens: 10, output_tokens: 5,
    cache_read_tokens: 25, cache_write_tokens: 2,
    direct_tokens: 15, total_tokens: 42, cost_usd: 1.5, cost_estimable: true,
  }],
  details: [],
};
const hhmmss = (unix: number) => new Date(unix * 1000).toLocaleTimeString("en-US");

// The mock factory is hoisted above the fixtures, so it can't close over them —
// the implementation is installed per-test in beforeEach instead. That also
// keeps a failure injected by one test from leaking into the next, which
// clearAllMocks does not prevent (it clears calls, not implementations).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(() => Promise.resolve(null)) }));
vi.mock("./lib/updater", () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
  installUpdate: vi.fn(),
  relaunchApp: vi.fn(),
  getCurrentVersion: vi.fn().mockResolvedValue("1.0.4"),
}));
// updater-store는 실제 모듈을 사용한다 — shouldAutoCheck/localStorage 로직이
// 자동 확인 스로틀 테스트에서 그대로 동작해야 하기 때문에 모킹하지 않는다.

import App from "./App";
import { invoke } from "@tauri-apps/api/core";
import { checkForUpdate } from "./lib/updater";

function defaultInvoke(cmd: string) {
  if (cmd === "get_usage") return Promise.resolve(report);
  if (cmd === "get_settings") return Promise.resolve(settings);
  if (cmd === "set_settings") return Promise.resolve(settings);
  if (cmd === "get_usage_history") return Promise.resolve(history);
  return Promise.resolve(null);
}

const invoked = (cmd: string) => vi.mocked(invoke).mock.calls.filter((c) => c[0] === cmd);

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(defaultInvoke as never);
  });
  it("renders both provider cards with plans", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Max 20x")).toBeInTheDocument();
      expect(screen.getByText("Pro")).toBeInTheDocument();
    });
  });

  it("toggles the widget window from the header button", async () => {
    render(<App />);
    await screen.findByText("Max 20x");
    fireEvent.click(screen.getByLabelText("Widget"));
    expect(invoked("toggle_widget")).toHaveLength(1);
  });

  it("header refresh rescans usage history while the history tab is open", async () => {
    render(<App />);
    await screen.findByText("Max 20x");

    fireEvent.click(screen.getByText("Usage history"));
    await waitFor(() => expect(invoked("get_usage_history")).toHaveLength(1));
    const limitFetches = invoked("get_usage").length;

    fireEvent.click(screen.getByText("Refresh"));

    // Refresh must hit the history scan (bypassing the cache), not the limits poll.
    await waitFor(() => expect(invoked("get_usage_history")).toHaveLength(2));
    expect(invoked("get_usage_history")[1][1]).toEqual({ refresh: true });
    expect(invoked("get_usage")).toHaveLength(limitFetches);
  });

  it("returning to the history tab after a refresh serves the cache, not a rescan", async () => {
    render(<App />);
    await screen.findByText("Max 20x");

    fireEvent.click(screen.getByText("Usage history"));
    await waitFor(() => expect(invoked("get_usage_history")).toHaveLength(1));
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(invoked("get_usage_history")).toHaveLength(2));

    fireEvent.click(screen.getByText("Limits"));
    fireEvent.click(screen.getByText("Usage history"));

    // The remount is a plain read: a full disk rescan here would run on every
    // tab switch once the user has refreshed once.
    await waitFor(() => expect(invoked("get_usage_history")).toHaveLength(3));
    expect(invoked("get_usage_history")[2][1]).toEqual({ refresh: false });
  });

  it("shows each tab's own updated time in the header", async () => {
    render(<App />);
    await screen.findByText("Max 20x");
    // Limits tab: the limits snapshot's time.
    expect(screen.getByText(`Updated ${hhmmss(10)}`)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Usage history"));

    // History tab: the scan time, not the limits time.
    await waitFor(() => expect(screen.getByText(`Updated ${hhmmss(SCANNED_AT)}`)).toBeInTheDocument());
    expect(screen.queryByText(`Updated ${hhmmss(10)}`)).toBeNull();

    // And back — each tab keeps its own.
    fireEvent.click(screen.getByText("Limits"));
    await waitFor(() => expect(screen.getByText(`Updated ${hhmmss(10)}`)).toBeInTheDocument());
  });

  it("header refresh still refetches limits while the limits tab is open", async () => {
    render(<App />);
    await screen.findByText("Max 20x");
    const before = invoked("get_usage").length;

    fireEvent.click(screen.getByText("Refresh"));

    await waitFor(() => expect(invoked("get_usage").length).toBe(before + 1));
    expect(invoked("get_usage_history")).toHaveLength(0);
  });

  it("shows a skeleton — not a blank screen — while the first load is in flight", async () => {
    let release!: (r: typeof report) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage"
        ? new Promise((res) => { release = res as (r: typeof report) => void; })
        : defaultInvoke(cmd)) as never);

    const { container } = render(<App />);

    // Two cards' worth of skeleton, matching the real layout.
    expect(screen.getAllByTestId("provider-skeleton")).toHaveLength(2);
    // The header now carries its own status role for loading state; scope the assertion to
    // the cards container to preserve the original intent without false positives.
    expect(container.querySelector('.app__cards[role="status"]')).not.toBeNull();

    release(report);
    await screen.findByText("Max 20x");
    expect(screen.queryByTestId("provider-skeleton")).toBeNull();
  });

  it("reports a failed first load instead of shimmering forever", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.reject(new Error("claude cli missing")) : defaultInvoke(cmd)) as never);

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("claude cli missing");
    // The whole point: a skeleton that never resolves is worse than the blank
    // screen it replaced.
    expect(screen.queryByTestId("provider-skeleton")).toBeNull();
  });

  const refreshButton = () => screen.getByText("Refresh").closest("button")!;

  it("marks the refresh button busy while a limits refresh is in flight", async () => {
    render(<App />);
    await screen.findByText("Max 20x");
    expect(refreshButton().getAttribute("aria-busy")).toBe("false");

    let release!: (r: typeof report) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage"
        ? new Promise((res) => { release = res as (r: typeof report) => void; })
        : defaultInvoke(cmd)) as never);

    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("true"));
    // The cards stay — a refresh must not blank what the user is reading.
    expect(screen.getByText("Max 20x")).toBeInTheDocument();

    release(report);
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("false"));
  });

  it("stops the refresh button spinning when a limits refresh fails", async () => {
    render(<App />);
    await screen.findByText("Max 20x");

    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.reject(new Error("boom")) : defaultInvoke(cmd)) as never);

    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("false"));
  });

  it("does not spin the refresh button on a history cold load — the user never pressed it", async () => {
    render(<App />);
    await screen.findByText("Max 20x");

    let release!: (h: typeof history) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage_history"
        ? new Promise((res) => { release = res as (h: typeof history) => void; })
        : defaultInvoke(cmd)) as never);

    fireEvent.click(screen.getByText("Usage history"));

    // The skeleton already says "loading" — a button the user never pressed
    // must not respond.
    await screen.findByTestId("history-skeleton");
    expect(refreshButton().getAttribute("aria-busy")).toBe("false");

    release(history);
    await waitFor(() => expect(screen.queryByTestId("history-skeleton")).toBeNull());
  });

  it("spins the refresh button when the user refreshes the history tab", async () => {
    render(<App />);
    await screen.findByText("Max 20x");
    fireEvent.click(screen.getByText("Usage history"));
    await waitFor(() => expect(invoked("get_usage_history")).toHaveLength(1));

    let release!: (h: typeof history) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage_history"
        ? new Promise((res) => { release = res as (h: typeof history) => void; })
        : defaultInvoke(cmd)) as never);

    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("true"));

    release(history);
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("false"));
  });

  it("abandons a history refresh when the user leaves the tab mid-scan", async () => {
    render(<App />);
    await screen.findByText("Max 20x");
    fireEvent.click(screen.getByText("Usage history"));
    await waitFor(() => expect(invoked("get_usage_history")).toHaveLength(1));

    // Press refresh, then walk away before the scan finishes.
    let releaseStale!: (h: typeof history) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage_history"
        ? new Promise((res) => { releaseStale = res as (h: typeof history) => void; })
        : defaultInvoke(cmd)) as never);
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("true"));

    fireEvent.click(screen.getByText("Limits"));
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("false"));

    // Coming back is a cold load the user never asked for — the abandoned press
    // must not spin the button for it.
    let releaseFresh!: (h: typeof history) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage_history"
        ? new Promise((res) => { releaseFresh = res as (h: typeof history) => void; })
        : defaultInvoke(cmd)) as never);
    fireEvent.click(screen.getByText("Usage history"));
    await screen.findByTestId("history-skeleton");
    expect(refreshButton().getAttribute("aria-busy")).toBe("false");

    // The abandoned scan landing late must not stop the live one either.
    await act(async () => { releaseStale(history); });
    expect(screen.getByTestId("history-skeleton")).toBeInTheDocument();

    await act(async () => { releaseFresh(history); });
    await waitFor(() => expect(screen.queryByTestId("history-skeleton")).toBeNull());
  });

  it("shimmers the header time while the first load is in flight", async () => {
    let release!: (r: typeof report) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage"
        ? new Promise((res) => { release = res as (r: typeof report) => void; })
        : defaultInvoke(cmd)) as never);

    const { container } = render(<App />);
    expect(container.querySelector(".app-header .skeleton")).not.toBeNull();
    expect(screen.queryByText(/Updated/)).toBeNull();
    // The skeleton is aria-hidden, so without this the header would go silent
    // to assistive tech — worse than the "Updated —" it replaced.
    expect(container.querySelector('.app-header [role="status"]')).not.toBeNull();

    release(report);
    await screen.findByText(`Updated ${hhmmss(10)}`);
    expect(container.querySelector(".app-header .skeleton")).toBeNull();
    expect(container.querySelector('.app-header [role="status"]')).toBeNull();
  });

  it("falls back to a dash — not an endless shimmer — when the first load fails", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.reject(new Error("boom")) : defaultInvoke(cmd)) as never);

    const { container } = render(<App />);
    await screen.findByRole("alert");

    // A dash is honest here: no time is coming.
    expect(screen.getByText("Updated —")).toBeInTheDocument();
    expect(container.querySelector(".app-header .skeleton")).toBeNull();
  });

  it("surfaces a limits refresh failure without hiding the last snapshot", async () => {
    render(<App />);
    await screen.findByText("Max 20x");

    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.reject(new Error("refresh boom")) : defaultInvoke(cmd)) as never);

    fireEvent.click(screen.getByText("Refresh"));

    // A failed refresh used to vanish: loadFailed only rendered on the
    // report-less branch, so the stale cards sat there with no signal.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("refresh boom");
    // The snapshot the user was reading must stay on screen.
    expect(screen.getByText("Max 20x")).toBeInTheDocument();
  });

  it("clears the limits refresh banner once a later refresh succeeds", async () => {
    render(<App />);
    await screen.findByText("Max 20x");

    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.reject(new Error("refresh boom")) : defaultInvoke(cmd)) as never);
    fireEvent.click(screen.getByText("Refresh"));
    await screen.findByRole("alert");

    vi.mocked(invoke).mockImplementation(defaultInvoke as never);
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("falls back to a dash on the history tab too, when the scan fails — historyBusy must still clear via .finally()", async () => {
    const { container } = render(<App />);
    await screen.findByText("Max 20x");

    let reject!: (e: Error) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage_history"
        ? new Promise((_res, rej) => { reject = rej; })
        : defaultInvoke(cmd)) as never);

    fireEvent.click(screen.getByText("Usage history"));

    // The scan must actually be shimmering mid-flight — not just settle on
    // the dash by coincidence of onLoadingChange never firing at all.
    await waitFor(() => expect(container.querySelector(".app-header .skeleton")).not.toBeNull());

    await act(async () => { reject(new Error("scan boom")); });

    await screen.findByRole("alert");

    // historyBusy must go false even though onScannedAt never fired, or the
    // header shimmers forever instead of settling on the dash.
    expect(screen.getByText("Updated —")).toBeInTheDocument();
    expect(container.querySelector(".app-header .skeleton")).toBeNull();
  });
});

describe("auto update check", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(defaultInvoke as never);
  });

  it("checks for updates on mount when never checked", async () => {
    render(<App />);
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalled());
  });

  it("skips the check within 24h of the last check", async () => {
    localStorage.setItem("updater.lastCheckAt", String(Date.now()));
    render(<App />);
    // 짧게 대기 후에도 호출되지 않아야 한다.
    await new Promise((r) => setTimeout(r, 50));
    expect(checkForUpdate).not.toHaveBeenCalled();
  });
});
