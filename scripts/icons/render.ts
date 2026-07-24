/**
 * 마스터 SVG에서 아이콘 산출물을 만든다: `npm run icons`
 *
 * 렌더러는 이미 devDependency인 Playwright의 Chromium이라 새 의존성이 없다.
 * 여기서는 PNG만 뽑고, 번들 아이콘 세트(.ico/.icns/각 크기 PNG)는 이어서 도는
 * `tauri icon`이 1024px 결과물에서 파생한다.
 */

import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Page } from "playwright";
import { pngSize } from "./png.ts";

const SOURCE_DIR = "src-tauri/icons/source";
const TMP_DIR = "scripts/icons/.tmp";

const COLOR_MASTER = `${SOURCE_DIR}/app-icon.svg`;
const TRAY_MASTER = `${SOURCE_DIR}/tray-template.svg`;

type Job = { svg: string; size: number; out: string; why: string };

const JOBS: Job[] = [
  { svg: COLOR_MASTER, size: 1024, out: `${TMP_DIR}/app-icon-1024.png`, why: "tauri icon 입력" },
  { svg: COLOR_MASTER, size: 128, out: "docs/images/app-icon.png", why: "README" },
  { svg: TRAY_MASTER, size: 44, out: "src-tauri/icons/tray/tray-template.png", why: "macOS 트레이" },
];

/**
 * 둥근 모서리가 투명해야 OS가 아이콘을 제대로 마스킹하므로 배경을 비워 촬영한다.
 */
async function render(page: Page, job: Job): Promise<void> {
  const svg = await readFile(job.svg, "utf8");
  await page.setViewportSize({ width: job.size, height: job.size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}` +
      `svg{display:block;width:${job.size}px;height:${job.size}px}</style>${svg}`
  );
  await mkdir(dirname(job.out), { recursive: true });
  await page.screenshot({ path: job.out, omitBackground: true });

  const { width, height } = await pngSize(job.out);
  if (width !== job.size || height !== job.size) {
    throw new Error(`${job.out}: ${job.size}×${job.size}를 기대했는데 ${width}×${height}입니다.`);
  }
  console.log(`  ✓ ${job.out.padEnd(40)} ${job.size}px (${job.why})`);
}

async function main(): Promise<void> {
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const job of JOBS) await render(page, job);
  } finally {
    await browser.close();
  }

  // favicon은 래스터가 아니라 마스터를 그대로 쓴다. 사본을 두는 쪽이
  // 빌드 설정에서 src-tauri를 들여다보게 만드는 것보다 낫다.
  await copyFile(COLOR_MASTER, "public/app-icon.svg");
  console.log(`  ✓ ${"public/app-icon.svg".padEnd(40)} 마스터 사본 (favicon)`);
}

main().catch((e) => {
  console.error("\n" + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
