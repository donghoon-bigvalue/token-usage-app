import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { LimitBar } from "./LimitBar";

const wrap = (ui: React.ReactNode) => <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>;

describe("LimitBar", () => {
  it("renders label, percent, and fill width", () => {
    render(wrap(<LimitBar window={{ id: "claude_session", used_percent: 42, resets_at: 2000, available: true }} now={1000} locale="en" />));
    expect(screen.getByText("Current session")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    const fill = screen.getByTestId("bar-fill");
    expect(fill).toHaveStyle({ width: "42%" });
  });

  it("shows unavailable state", () => {
    render(wrap(<LimitBar window={{ id: "codex_spark_weekly", used_percent: 0, resets_at: null, available: false }} now={0} locale="en" />));
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("fills the reset line with a non-breaking space on both no-countdown paths — a plain space would collapse to 0px and shrink the bar", () => {
    const { container: unavailable } = render(
      wrap(<LimitBar window={{ id: "codex_spark_weekly", used_percent: 0, resets_at: null, available: false }} now={0} locale="en" />)
    );
    expect(unavailable.querySelector(".limit-bar__reset")!.textContent).toBe("\u00A0");

    const { container: available } = render(
      wrap(<LimitBar window={{ id: "claude_session", used_percent: 42, resets_at: null, available: true }} now={1000} locale="en" />)
    );
    expect(available.querySelector(".limit-bar__reset")!.textContent).toBe("\u00A0");
  });
});
