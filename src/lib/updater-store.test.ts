import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldAutoCheck,
  shouldPrompt,
  getLastCheckAt,
  setLastCheckAt,
  getDismissedVersion,
  setDismissedVersion,
} from "./updater-store";

const DAY = 86_400_000;

describe("shouldAutoCheck", () => {
  it("checks when never checked before", () => {
    expect(shouldAutoCheck(DAY, null)).toBe(true);
  });
  it("skips within 24h", () => {
    expect(shouldAutoCheck(DAY + 1000, DAY)).toBe(false);
  });
  it("checks exactly at 24h boundary", () => {
    expect(shouldAutoCheck(2 * DAY, DAY)).toBe(true);
  });
});

describe("shouldPrompt", () => {
  it("prompts when nothing dismissed", () => {
    expect(shouldPrompt("1.1.0", null)).toBe(true);
  });
  it("suppresses the dismissed version", () => {
    expect(shouldPrompt("1.1.0", "1.1.0")).toBe(false);
  });
  it("prompts again for a newer version", () => {
    expect(shouldPrompt("1.2.0", "1.1.0")).toBe(true);
  });
});

describe("persistence", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips lastCheckAt", () => {
    expect(getLastCheckAt()).toBeNull();
    setLastCheckAt(1234);
    expect(getLastCheckAt()).toBe(1234);
  });
  it("round-trips dismissedVersion", () => {
    expect(getDismissedVersion()).toBeNull();
    setDismissedVersion("1.2.3");
    expect(getDismissedVersion()).toBe("1.2.3");
  });
});
