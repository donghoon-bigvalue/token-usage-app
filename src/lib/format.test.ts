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
  it("includes days past 24h (Korean)", () => {
    const now = 1_000_000;
    const reset = now + 2 * 86400 + 1 * 3600 + 2 * 60; // 2d 1h 2m
    expect(formatCountdown(reset, now, "ko")).toBe("2일 1시간 2분 후 리셋");
  });
  it("includes days past 24h (English)", () => {
    const now = 1_000_000;
    const reset = now + 49 * 3600 + 2 * 60; // 49h2m -> 2d 1h 2m
    expect(formatCountdown(reset, now, "en")).toBe("resets in 2d 1h 2m");
  });
  it("omits days under 24h", () => {
    const now = 1_000_000;
    const reset = now + 23 * 3600 + 59 * 60; // 23h59m
    expect(formatCountdown(reset, now, "ko")).toBe("23시간 59분 후 리셋");
  });
  it("shows resetting when past", () => {
    expect(formatCountdown(500, 1000, "en")).toBe("resetting…");
  });
});
