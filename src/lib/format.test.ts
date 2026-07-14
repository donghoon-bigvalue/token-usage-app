import { describe, it, expect } from "vitest";
import { formatCountdown } from "./format";

describe("formatCountdown", () => {
  it("formats hours and minutes in English", () => {
    const now = 1_000_000;
    const reset = now + 2 * 3600 + 30 * 60; // 2h30m
    expect(formatCountdown(reset, now, "en")).toBe("resets in 2h 30m");
  });
  it("formats in Korean", () => {
    const now = 1_000_000;
    const reset = now + 3600; // 1h
    expect(formatCountdown(reset, now, "ko")).toBe("1시간 0분 후 리셋");
  });
  it("shows resetting when past", () => {
    expect(formatCountdown(500, 1000, "en")).toBe("resetting…");
  });
});
