import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { ProviderCard } from "./ProviderCard";
import type { UsageSnapshot } from "../lib/types";

const wrap = (ui: React.ReactNode) => <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>;

const base: UsageSnapshot = {
  provider: "claude", plan: "Max 20x", plan_raw: "max", source: "live", updated_at: 0,
  windows: [{ id: "claude_session", used_percent: 10, resets_at: 100, available: true }], error: null,
};

describe("ProviderCard", () => {
  it("shows plan and applies accent class", () => {
    const { container } = render(wrap(<ProviderCard snapshot={base} now={0} locale="en" />));
    expect(screen.getByText("Max 20x")).toBeInTheDocument();
    expect(container.querySelector(".provider-claude")).toBeTruthy();
  });

  it("shows connect state on error", () => {
    render(wrap(<ProviderCard snapshot={{ ...base, error: "no creds" }} now={0} locale="en" />));
    expect(screen.getByText(/Sign in with the Claude CLI/)).toBeInTheDocument();
  });

  it("shows cached badge", () => {
    render(wrap(<ProviderCard snapshot={{ ...base, source: "cache" }} now={0} locale="en" />));
    expect(screen.getByText("cached")).toBeInTheDocument();
  });
});
