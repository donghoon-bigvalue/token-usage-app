import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));

import { check } from "@tauri-apps/plugin-updater";
import { isForcedUpdate, checkForUpdate } from "./updater";

beforeEach(() => vi.clearAllMocks());

describe("isForcedUpdate", () => {
  it("is false for ordinary release notes", () => {
    expect(isForcedUpdate("### Fixed\n- 차트가 사라지던 문제")).toBe(false);
  });

  it("detects the hidden HTML-comment marker", () => {
    expect(isForcedUpdate("<!-- force-update -->\n\n### Fixed\n- ...")).toBe(true);
  });

  it("detects the visible bracket marker", () => {
    expect(isForcedUpdate("[force-update] 보안 수정")).toBe(true);
  });

  it("tolerates case, spacing and underscores", () => {
    expect(isForcedUpdate("<!--   FORCE_UPDATE   -->")).toBe(true);
    expect(isForcedUpdate("[ Force Update ]")).toBe(true);
  });

  it("does not fire on the words alone", () => {
    expect(isForcedUpdate("we had to force update the cache")).toBe(false);
  });

  it("handles empty notes", () => {
    expect(isForcedUpdate("")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("returns null when there is no update", async () => {
    vi.mocked(check).mockResolvedValue(null);
    expect(await checkForUpdate()).toBeNull();
  });

  it("normalizes the update and derives forced from the notes", async () => {
    vi.mocked(check).mockResolvedValue({
      version: "1.2.0",
      body: "<!-- force-update -->\nurgent",
    } as never);
    const info = await checkForUpdate();
    expect(info).toMatchObject({ version: "1.2.0", forced: true });
  });

  it("treats missing notes as a normal update", async () => {
    vi.mocked(check).mockResolvedValue({ version: "1.2.0" } as never);
    const info = await checkForUpdate();
    expect(info).toMatchObject({ version: "1.2.0", notes: "", forced: false });
  });
});
