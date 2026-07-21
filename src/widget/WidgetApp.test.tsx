import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { UsageReport } from "../lib/types";

const report: UsageReport = {
  claude: { provider: "claude", plan: "Max 20x", plan_raw: "max", source: "live", updated_at: 10, windows: [
    { id: "claude_session", used_percent: 45, resets_at: 999999999, available: true },
    { id: "claude_weekly_all", used_percent: 60, resets_at: 999999999, available: true },
    { id: "claude_weekly_fable", used_percent: 10, resets_at: 999999999, available: true },
  ], error: null },
  codex: { provider: "codex", plan: "Pro", plan_raw: "pro", source: "live", updated_at: 10, windows: [
    { id: "codex_weekly", used_percent: 72, resets_at: 999999999, available: true },
    { id: "codex_spark_weekly", used_percent: 30, resets_at: 999999999, available: true },
  ], error: null },
};

const hide = vi.fn();
const setSize = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ hide, setSize }) }));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
}));

import "../i18n";
import { WidgetApp } from "./WidgetApp";
import { invoke } from "@tauri-apps/api/core";

const invoked = (cmd: string) => vi.mocked(invoke).mock.calls.filter((c) => c[0] === cmd);

describe("WidgetApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hide.mockClear();
    setSize.mockClear();
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.resolve(report) : Promise.resolve(null)) as never);
  });

  it("renders all five limit bars", async () => {
    render(<WidgetApp locale="en" />);
    await waitFor(() => expect(screen.getAllByTestId("bar-fill")).toHaveLength(5));
  });

  it("opens the main window when the body is clicked", async () => {
    render(<WidgetApp locale="en" />);
    await waitFor(() => expect(screen.getAllByTestId("bar-fill")).toHaveLength(5));
    fireEvent.click(screen.getByTestId("widget-body"));
    expect(invoked("show_main")).toHaveLength(1);
  });

  it("refetches usage when the refresh button is pressed", async () => {
    render(<WidgetApp locale="en" />);
    await waitFor(() => expect(screen.getAllByTestId("bar-fill")).toHaveLength(5));
    const before = invoked("get_usage").length;
    fireEvent.click(screen.getByLabelText("Refresh"));
    await waitFor(() => expect(invoked("get_usage").length).toBe(before + 1));
    // Clicking a bar-bar button must not bubble to the body's open-main handler.
    expect(invoked("show_main")).toHaveLength(0);
  });

  it("hides its own window when the close button is pressed", async () => {
    render(<WidgetApp locale="en" />);
    await waitFor(() => expect(screen.getAllByTestId("bar-fill")).toHaveLength(5));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("resizes the window to fit its measured content height (no internal scroll)", async () => {
    // jsdom has no layout, so stub the card's measured height; the widget should
    // set the window height to exactly that, keeping the fixed 260 width.
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ height: 382, width: 260 } as DOMRect);
    try {
      render(<WidgetApp locale="en" />);
      await waitFor(() => expect(setSize).toHaveBeenCalled());
      const calls = setSize.mock.calls;
      const size = calls[calls.length - 1][0] as { width: number; height: number };
      expect(size.width).toBe(260);
      expect(size.height).toBe(382);
    } finally {
      rect.mockRestore();
    }
  });
});
