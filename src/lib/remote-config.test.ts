import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  compareVersions,
  isBelowMinimum,
  normalizePolicy,
  pickMessage,
  fetchForcePolicy,
  CONFIG_URL,
} from "./remote-config";

describe("compareVersions", () => {
  it("orders by numeric component, not lexicographically", () => {
    expect(compareVersions("1.0.9", "1.0.10")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });
  it("treats missing components as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
  it("ignores a prerelease suffix", () => {
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBe(0);
  });
  it("is NaN for unparseable input", () => {
    expect(compareVersions("nightly", "1.0.0")).toBeNaN();
  });
});

describe("isBelowMinimum", () => {
  it("is true below the minimum", () => {
    expect(isBelowMinimum("1.0.4", "1.0.5")).toBe(true);
  });
  it("is false at or above the minimum", () => {
    expect(isBelowMinimum("1.0.5", "1.0.5")).toBe(false);
    expect(isBelowMinimum("1.1.0", "1.0.5")).toBe(false);
  });
  it("fails open on garbage — a bad policy must not lock the app", () => {
    expect(isBelowMinimum("1.0.4", "latest")).toBe(false);
    expect(isBelowMinimum("", "1.0.5")).toBe(false);
  });
});

describe("normalizePolicy", () => {
  it("keeps minimumVersion and localized messages", () => {
    expect(normalizePolicy({ minimumVersion: "1.0.5", message: { ko: "가", en: "a" } })).toEqual({
      minimumVersion: "1.0.5",
      messages: { ko: "가", en: "a" },
    });
  });
  it("allows a policy without messages", () => {
    expect(normalizePolicy({ minimumVersion: "1.0.5" })).toEqual({
      minimumVersion: "1.0.5",
      messages: null,
    });
  });
  it("ignores unknown fields so a newer policy file can't break old apps", () => {
    expect(normalizePolicy({ minimumVersion: "1.0.5", futureField: 42 })).toMatchObject({
      minimumVersion: "1.0.5",
    });
  });
  it("rejects a policy with no usable minimumVersion", () => {
    expect(normalizePolicy({ minimumVersion: "" })).toBeNull();
    expect(normalizePolicy({ minimumVersion: 105 })).toBeNull();
    expect(normalizePolicy(null)).toBeNull();
    expect(normalizePolicy("nope")).toBeNull();
  });
  it("drops non-string message entries", () => {
    expect(normalizePolicy({ minimumVersion: "1.0.5", message: { ko: 1, en: "a" } })).toEqual({
      minimumVersion: "1.0.5",
      messages: { en: "a" },
    });
  });
});

describe("pickMessage", () => {
  const messages = { ko: "가", en: "a" };
  it("picks the active language", () => {
    expect(pickMessage(messages, "ko")).toBe("가");
  });
  it("falls back from a region-tagged code", () => {
    expect(pickMessage(messages, "ko-KR")).toBe("가");
  });
  it("falls back to English for an unlisted language", () => {
    expect(pickMessage(messages, "ja")).toBe("a");
  });
  it("is null without messages", () => {
    expect(pickMessage(null, "ko")).toBeNull();
  });
});

describe("fetchForcePolicy", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("reads the policy from the config repo without caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ minimumVersion: "1.0.5" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchForcePolicy()).toEqual({ minimumVersion: "1.0.5", messages: null });
    expect(fetchMock).toHaveBeenCalledWith(CONFIG_URL, expect.objectContaining({ cache: "no-store" }));
  });

  it("fails open when the file is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await fetchForcePolicy()).toBeNull();
  });

  it("fails open when offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchForcePolicy()).toBeNull();
  });

  it("fails open on malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("bad json"); },
    }));
    expect(await fetchForcePolicy()).toBeNull();
  });
});
