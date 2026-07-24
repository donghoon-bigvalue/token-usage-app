import { describe, expect, it } from "vitest";
import { pngSize } from "./png.ts";

describe("렌더된 아이콘 산출물", () => {
  it("트레이 템플릿은 레티나 기준 44×44다", async () => {
    expect(await pngSize("src-tauri/icons/tray/tray-template.png")).toEqual({
      width: 44,
      height: 44,
    });
  });

  it("README용 아이콘은 128×128이다", async () => {
    expect(await pngSize("docs/images/app-icon.png")).toEqual({ width: 128, height: 128 });
  });
});
