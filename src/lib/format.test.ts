import { describe, it, expect, vi } from "vitest";
import { formatCountdown, formatTokens, formatUsd } from "./format";

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

describe("formatTokens", () => {
  it("groups thousands", () => {
    expect(formatTokens(4315471877)).toBe("4,315,471,877");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(0)).toBe("0");
  });
});

describe("formatUsd", () => {
  it("groups thousands and keeps two decimals", () => {
    expect(formatUsd(10493.6432)).toBe("$10,493.64");
    expect(formatUsd(11.85)).toBe("$11.85");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("renders a dash for an unavailable cost", () => {
    expect(formatUsd(null)).toBe("—");
  });
});

describe("number formatting locale", () => {
  // The real defect: a bare Intl.NumberFormat() inherits the host locale, and the
  // WebView resolved to one that doesn't group — so the app showed 4315471877
  // while these tests passed on Node's en-US default. Node can't reproduce that,
  // so assert the locale is pinned rather than trusting the output above.
  it("pins the locale instead of inheriting the host's", async () => {
    const spy = vi.spyOn(Intl, "NumberFormat");
    try {
      // The formatters are built at module load, so spy first, then re-evaluate.
      vi.resetModules();
      await import("./format");
      expect(spy).toHaveBeenCalled();
      for (const call of spy.mock.calls) expect(call[0]).toBe("en-US");
    } finally {
      spy.mockRestore();
      vi.resetModules();
    }
  });
});
