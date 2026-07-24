import { describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import { pngPixel, pngSize } from "./png.ts";

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

/**
 * 크기가 하나라도 빠지면 특정 플랫폼 빌드만 조용히 깨진다. 목록을 못 박아 둔다.
 */
const BUNDLE_FILES = [
  "128x128.png",
  "128x128@2x.png",
  "32x32.png",
  "64x64.png",
  "Square107x107Logo.png",
  "Square142x142Logo.png",
  "Square150x150Logo.png",
  "Square284x284Logo.png",
  "Square30x30Logo.png",
  "Square310x310Logo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square89x89Logo.png",
  "StoreLogo.png",
  "icon.icns",
  "icon.ico",
  "icon.png",
];

describe("번들 아이콘 세트", () => {
  it("필요한 파일이 빠짐없이 있다", async () => {
    const entries = await readdir("src-tauri/icons", { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    expect(files.sort()).toEqual([...BUNDLE_FILES].sort());
  });

  it("이름에 크기가 박힌 PNG는 실제 크기가 이름과 같다", async () => {
    for (const name of BUNDLE_FILES) {
      const match = name.match(/(\d+)x\1/);
      if (!match) continue;
      const expected = Number(match[1]) * (name.includes("@2x") ? 2 : 1);
      const { width, height } = await pngSize(`src-tauri/icons/${name}`);
      expect({ name, width, height }).toEqual({ name, width: expected, height: expected });
    }
  });

  /**
   * 파일 목록과 크기만으로는 세트가 *교체됐는지* 알 수 없다. 링이 지나는 자리의
   * 픽셀 색을 직접 확인해야 옛 아이콘이 남아 있는 것을 잡아낸다. 128px 아이콘은
   * 마스터와 좌표계가 1:1이라 샘플 지점을 계산할 필요가 없다.
   */
  const RING_SAMPLES = [
    { x: 111, y: 64, hex: "#D97757", what: "바깥 링 (Claude)" },
    { x: 86, y: 64, hex: "#5162ED", what: "안쪽 링 (Codex)" },
  ];

  it("링 위의 픽셀이 브랜드 색이다", async () => {
    for (const sample of RING_SAMPLES) {
      const px = await pngPixel("src-tauri/icons/128x128.png", sample.x, sample.y);
      const want = {
        r: parseInt(sample.hex.slice(1, 3), 16),
        g: parseInt(sample.hex.slice(3, 5), 16),
        b: parseInt(sample.hex.slice(5, 7), 16),
      };
      // 안티에일리어싱을 감안해 채널당 24까지 벌어지는 것은 허용한다.
      const off = Math.max(
        Math.abs(px.r - want.r),
        Math.abs(px.g - want.g),
        Math.abs(px.b - want.b)
      );
      expect({ what: sample.what, near: off <= 24 }).toEqual({ what: sample.what, near: true });
    }
  });

  it("판의 둥근 모서리가 투명하다", async () => {
    // 모서리가 불투명하면 macOS 독에서 아이콘이 각진 사각형으로 보인다.
    expect((await pngPixel("src-tauri/icons/128x128.png", 1, 1)).a).toBe(0);
  });
});
