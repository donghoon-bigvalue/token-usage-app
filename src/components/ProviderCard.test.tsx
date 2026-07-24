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

  it("shows the sign-in prompt on a genuine auth error", () => {
    render(wrap(<ProviderCard snapshot={{ ...base, error: "credentials not found" }} now={0} locale="en" />));
    expect(screen.getByText(/Sign in with the Claude CLI/)).toBeInTheDocument();
  });

  it("shows a retry state — not the sign-in prompt — on a transient error", () => {
    // A cold-start network blip must not tell an already-signed-in user to log in.
    const { container } = render(
      wrap(<ProviderCard snapshot={{ ...base, error: "request failed" }} now={0} locale="en" />),
    );
    expect(screen.getByText(/retrying/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sign in with the Claude CLI/)).not.toBeInTheDocument();
    // Shimmering bars convey work-in-progress and reserve the real bars' height.
    expect(container.querySelectorAll(".limit-bar__row--skeleton").length).toBeGreaterThan(0);
    // The spinner is animated ("↻" with the --on class), not a static glyph.
    expect(container.querySelector(".provider-card__retry .spinner--on")).not.toBeNull();
  });

  it("sizes the retry shimmer to the provider's window count even if the errored snapshot has none", () => {
    // Claude → 3 bars, Codex → 2, so data swaps in without a layout jump.
    const { container: c1 } = render(
      wrap(<ProviderCard snapshot={{ ...base, error: "request failed", windows: [] }} now={0} locale="en" />),
    );
    expect(c1.querySelectorAll(".limit-bar__row--skeleton")).toHaveLength(3);
    const { container: c2 } = render(
      wrap(<ProviderCard snapshot={{ ...base, provider: "codex", error: "request failed", windows: [] }} now={0} locale="en" />),
    );
    expect(c2.querySelectorAll(".limit-bar__row--skeleton")).toHaveLength(2);
  });

  it("shows cached badge", () => {
    render(wrap(<ProviderCard snapshot={{ ...base, source: "cache" }} now={0} locale="en" />));
    expect(screen.getByText("cached")).toBeInTheDocument();
  });
});
