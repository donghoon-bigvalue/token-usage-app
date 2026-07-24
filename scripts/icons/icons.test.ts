import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { pngPixel, pngSize } from "./png.ts";

describe("렌더된 아이콘 산출물", () => {
  it("README용 아이콘은 128×128이다", async () => {
    expect(await pngSize("docs/images/app-icon.png")).toEqual({ width: 128, height: 128 });
  });

  /**
   * 44px는 macOS 메뉴바 높이(18pt)의 정수배가 아니라 잘못된 전제였다. tray-icon이
   * 이미지를 18pt로 정규화하므로 레티나 2배인 36px이어야 리샘플링이 정수배로 떨어진다.
   * 크기만으로는 컬러 마스터에서 잘못 뽑아도 걸러지지 않으므로, 아래 테스트에서
   * 내용까지 함께 검증한다.
   */
  it("트레이 템플릿은 36×36이고 macOS 템플릿 이미지로 유효한 내용을 담고 있다", async () => {
    const path = "src-tauri/icons/tray/tray-template.png";
    expect(await pngSize(path)).toEqual({ width: 36, height: 36 });

    // macOS 템플릿 아이콘은 색을 버리고 알파만 쓴다. 컬러 마스터에서 잘못 뽑으면
    // (판 배경의 그라디언트, 브랜드 색 링) R/G/B가 0이 아니게 되므로 그 경우를 잡아낸다.
    // 전체 픽셀을 샘플링해 한 점만으로는 놓칠 렌더 오류(예: 컬러 마스터 오사용)를 잡는다.
    //
    // 곡선 호의 가장자리는 브라우저가 안티에일리어싱하므로 부분 커버리지에 해당하는
    // 중간 알파 값이 다수(수십~수백 종) 생긴다 — "정확히 두 값만" 존재하지는 않는다.
    // 그래서 의도한 두 평탄 구간(트랙 0.3, 채워진 호 1.0)이 알파 값 집합에 *포함*되는지만
    // 확인한다. 이 두 값이 없다면 stroke-opacity가 깨졌거나 완전히 다른 그림이 렌더된
    // 것이고, RGB가 0이 아니라면 컬러 마스터가 잘못 쓰인 것이다.
    const alphaLevels = new Set<number>();
    for (let y = 0; y < 36; y++) {
      for (let x = 0; x < 36; x++) {
        const px = await pngPixel(path, x, y);
        expect({ x, y, r: px.r, g: px.g, b: px.b }).toEqual({ x, y, r: 0, g: 0, b: 0 });
        alphaLevels.add(px.a);
      }
    }

    // 배경은 완전 투명(0), 트랙(stroke-opacity 0.3)은 36px에서 실제로 관측한 77,
    // 채워진 호(stroke-opacity 1)는 255다. 44px 때도 77이었다 — 0.3 * 255를 반올림한
    // 값이라 크기와 무관하다.
    expect(alphaLevels.has(0)).toBe(true);
    expect(alphaLevels.has(77)).toBe(true);
    expect(alphaLevels.has(255)).toBe(true);
  });

  it("favicon 사본(public/app-icon.svg)은 컬러 마스터와 바이트가 동일하다", async () => {
    const [copy, master] = await Promise.all([
      readFile("public/app-icon.svg"),
      readFile("src-tauri/icons/source/app-icon.svg"),
    ]);
    expect(copy.equals(master)).toBe(true);
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
    // macOS Finder가 만드는 .DS_Store 같은 숨김 파일은 산출물이 아니므로 무시한다.
    const files = entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name);
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
   * 픽셀 색을 직접 확인해야 옛 아이콘이 남아 있는 것을 잡아낸다. 좌표는 128px
   * 마스터 좌표계 기준이며, 각 PNG의 실제 크기에 맞춰 비례 축소해 샘플링한다.
   *
   * icon.icns/icon.ico는 PNG가 아니라 별도 컨테이너 포맷이라 이 방식으로 내용을
   * 검사할 수 없다. 파싱은 범위 밖으로 남겨둔다 — 필요해지면 별도 파서를 들인다.
   */
  const RING_SAMPLES = [
    { x: 111, y: 64, hex: "#D97757", what: "바깥 링 (Claude)" },
    { x: 86, y: 64, hex: "#5162ED", what: "안쪽 링 (Codex)" },
  ];

  it("64px 이상인 모든 PNG에서 링 위의 픽셀이 브랜드 색이다", async () => {
    const entries = await readdir("src-tauri/icons", { withFileTypes: true });
    const pngNames = entries
      .filter((e) => e.isFile() && e.name.endsWith(".png"))
      .map((e) => e.name);
    expect(pngNames.length).toBeGreaterThan(0);

    for (const name of pngNames) {
      const path = `src-tauri/icons/${name}`;
      const { width } = await pngSize(path);
      // 64px 미만은 안티에일리어싱이 한 픽셀 샘플을 지배해 테스트가 들쭉날쭉해진다.
      // 일부러 건너뛴다 — "빠짐"이 아니라 의도한 스킵이니 나중에 "고치지" 말 것.
      if (width < 64) continue;

      const scale = width / 128;
      for (const sample of RING_SAMPLES) {
        const x = Math.round(sample.x * scale);
        const y = Math.round(sample.y * scale);
        const px = await pngPixel(path, x, y);
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
        expect({ name, what: sample.what, near: off <= 24 }).toEqual({
          name,
          what: sample.what,
          near: true,
        });
      }
    }
  });

  it("판의 둥근 모서리가 투명하다", async () => {
    // 모서리가 불투명하면 macOS 독에서 아이콘이 각진 사각형으로 보인다.
    expect((await pngPixel("src-tauri/icons/128x128.png", 1, 1)).a).toBe(0);
  });
});
