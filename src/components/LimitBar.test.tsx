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

  it("renders the reset line for both an unavailable window and an available one with a countdown, so bar height never varies", () => {
    const { container: unavailable } = render(
      wrap(<LimitBar window={{ id: "codex_spark_weekly", used_percent: 0, resets_at: null, available: false }} now={0} locale="en" />)
    );
    expect(unavailable.querySelector(".limit-bar__reset")).not.toBeNull();

    const { container: available } = render(
      wrap(<LimitBar window={{ id: "claude_session", used_percent: 42, resets_at: 2000, available: true }} now={1000} locale="en" />)
    );
    expect(available.querySelector(".limit-bar__reset")).not.toBeNull();
  });
});
