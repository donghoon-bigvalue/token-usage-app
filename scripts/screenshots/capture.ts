/**
 * Regenerates the README images: `npm run screenshots`
 *
 * Opens the real frontend in Chromium with a stubbed Tauri backend (see
 * tauri-stub.ts), poses it, and writes PNGs plus a tour GIF into docs/images/.
 *
 * Run with node's TypeScript stripping — no build step, no test runner.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser, type Page } from "playwright";
import { buildFixtures } from "./fixtures.ts";
import { installTauriStub, WARNINGS_KEY } from "./tauri-stub.ts";
import { mainFrameCss, widgetFrameCss, tourWidgetCss } from "./shell.ts";

const run = promisify(execFile);

const BASE = "http://localhost:1420";
const OUT_DIR = "docs/images";
const TMP_DIR = "scripts/screenshots/.tmp";

/** Viewport is the app's 640px max-width plus the backdrop margin. */
const WIDTH = 720;
const STILL_HEIGHT = 900;
const TOUR_SIZE = { width: WIDTH, height: 740 };

const GIF_FPS = 10;
const GIF_WIDTH = 640;
const GIF_MAX_BYTES = 3 * 1024 * 1024;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Preconditions
 * ------------------------------------------------------------------ */

/**
 * Without a real Korean face the Hangul falls back to a CJK font and the
 * screenshots look subtly wrong to every Korean reader — the exact failure a
 * committed image would preserve forever. Fail before capturing, not after.
 */
async function requireKoreanFont(): Promise<void> {
  try {
    const { stdout } = await run("fc-list", [":lang=ko", "family"]);
    if (/Noto Sans KR|Nanum|Malgun|Apple SD Gothic|Pretendard/i.test(stdout)) return;
  } catch {
    // fontconfig missing entirely — same outcome, same advice.
  }
  throw new Error(
    "한글 폰트(Noto Sans KR 등)를 찾지 못했습니다. 설치 후 다시 실행하세요:\n" +
      "  sudo apt install fonts-noto-cjk\n" +
      "  # 또는 sudo 없이:\n" +
      "  mkdir -p ~/.local/share/fonts && curl -fsSL -o ~/.local/share/fonts/NotoSansKR.ttf \\\n" +
      "    'https://github.com/google/fonts/raw/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf' && fc-cache -f"
  );
}

async function requireFfmpeg(): Promise<void> {
  try {
    await run("ffmpeg", ["-version"]);
  } catch {
    throw new Error("ffmpeg를 찾지 못했습니다. GIF 변환에 필요합니다 (예: sudo apt install ffmpeg).");
  }
}

/* ------------------------------------------------------------------ *
 * Dev server
 * ------------------------------------------------------------------ */

async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Reuse a dev server the developer already has running; otherwise start one and
 * hand back a stopper. Starting our own and killing someone else's would be rude
 * and would also lose their terminal output.
 */
async function ensureDevServer(): Promise<() => void> {
  if (await serverIsUp()) {
    console.log("• 기존 dev 서버 재사용 (localhost:1420)");
    return () => {};
  }
  console.log("• dev 서버 시작 중…");
  const child: ChildProcess = spawn("npm", ["run", "dev"], { stdio: "ignore", detached: true });
  const stop = () => {
    // Detached, so kill the whole group — vite spawns children of its own.
    try {
      if (child.pid) process.kill(-child.pid);
    } catch {
      /* already gone */
    }
  };
  for (let i = 0; i < 60; i++) {
    await wait(500);
    if (await serverIsUp()) return stop;
  }
  stop();
  throw new Error("dev 서버가 30초 안에 뜨지 않았습니다.");
}

/* ------------------------------------------------------------------ *
 * Page plumbing
 * ------------------------------------------------------------------ */

const problems: string[] = [];

function watchForErrors(page: Page, label: string): void {
  page.on("pageerror", (e) => problems.push(`${label}: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`${label} console: ${msg.text()}`);
  });
}

/**
 * Shrink the viewport to exactly the rendered content before shooting.
 * `fullPage` would keep the leftover viewport height as dead space below the
 * window — and each pose (settings open, history table) is a different height.
 */
async function shootFitted(page: Page, name: string, width = WIDTH): Promise<void> {
  await page.setViewportSize({ width, height: STILL_HEIGHT });
  // The body's own box, not scrollHeight — the latter never reports less than
  // the viewport, which is exactly the case we're trying to trim.
  const height = await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
  await page.setViewportSize({ width, height });
  await page.screenshot({ path: join(OUT_DIR, name) });
  console.log(`  ✓ ${name}`);
}

/** Commands the stub didn't know about — a silent source of blank screenshots. */
async function collectStubWarnings(page: Page, label: string): Promise<void> {
  const unhandled = await page.evaluate(
    (key) => ((window as any)[key] as string[] | undefined) ?? [],
    WARNINGS_KEY
  );
  for (const cmd of new Set(unhandled)) {
    problems.push(`${label}: 스텁이 모르는 커맨드 '${cmd}' — tauri-stub.ts에 추가하세요.`);
  }
}

async function newContext(browser: Browser, extra: Parameters<Browser["newContext"]>[0] = {}) {
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: STILL_HEIGHT },
    colorScheme: "dark",
    locale: "ko-KR",
    ...extra,
  });
  await ctx.addInitScript(installTauriStub, buildFixtures(Math.floor(Date.now() / 1000)));
  return ctx;
}

/* ------------------------------------------------------------------ *
 * Stills
 * ------------------------------------------------------------------ */

async function captureStills(browser: Browser): Promise<void> {
  // 2x so the images stay crisp on the high-DPI screens most README readers use.
  const ctx = await newContext(browser, { deviceScaleFactor: 2 });

  const page = await ctx.newPage();
  watchForErrors(page, "main");
  await page.goto(`${BASE}/index.html`);
  await page.locator(".provider-card").nth(1).waitFor();
  await page.addStyleTag({ content: mainFrameCss("dark") });
  // Let the bar fills finish their 0.3s width transition.
  await wait(600);
  await shootFitted(page, "main-dark.png");

  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.locator(".settings-panel").waitFor();
  await wait(200);
  await shootFitted(page, "settings.png");
  await page.locator(".settings-panel__close").click();

  await page.getByRole("button", { name: "사용 이력" }).click();
  await page.locator(".history-table").waitFor();
  await wait(300);
  await shootFitted(page, "history.png");
  await collectStubWarnings(page, "main");

  const widget = await ctx.newPage();
  watchForErrors(widget, "widget");
  await widget.goto(`${BASE}/widget.html`);
  await widget.locator(".widget-group").nth(1).waitFor();
  await widget.addStyleTag({ content: widgetFrameCss() });
  await wait(600);
  // 260px card + the backdrop's 40px padding on each side.
  await shootFitted(widget, "widget.png", 340);
  await collectStubWarnings(widget, "widget");

  await ctx.close();
}

/* ------------------------------------------------------------------ *
 * Tour
 * ------------------------------------------------------------------ */

async function recordTour(browser: Browser): Promise<string> {
  const ctx = await newContext(browser, {
    viewport: TOUR_SIZE,
    recordVideo: { dir: TMP_DIR, size: TOUR_SIZE },
  });
  const page = await ctx.newPage();
  watchForErrors(page, "tour");
  await page.goto(`${BASE}/index.html`);
  await page.locator(".provider-card").nth(1).waitFor();
  await page.addStyleTag({ content: mainFrameCss("dark") + "\n" + tourWidgetCss() });
  await wait(1400);

  // 1. Monthly usage and cost.
  await page.getByRole("button", { name: "사용 이력" }).click();
  await page.locator(".history-table").waitFor();
  await wait(2200);

  // 2. Back to the limit bars.
  await page.getByRole("button", { name: "한도", exact: true }).click();
  await wait(1200);

  // 3. Settings: theme, then a round trip through English. Ending back on
  //    Korean matters — the last frame is what a reader remembers, and this
  //    README is Korean.
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.locator(".settings-panel").waitFor();
  await wait(800);
  await page.getByLabel("테마").selectOption("light");
  await wait(1500);
  await page.getByLabel("언어").selectOption("en");
  await wait(1500);
  await page.getByLabel("Language").selectOption("ko");
  await wait(1200);
  await page.locator(".settings-panel__close").click();
  await wait(700);

  // 4. The mini widget, floated over the main window the way it sits on a
  //    desktop. It reads the settings the tour just changed, so it comes up in
  //    the same theme as the window behind it.
  await page.evaluate((base) => {
    const frame = document.createElement("iframe");
    frame.className = "tour-widget";
    frame.src = `${base}/widget.html`;
    // Roomy to start with: an iframe defaults to 150px tall, which would
    // squeeze the card and make the measurement below come out short.
    frame.style.height = "460px";
    document.body.appendChild(frame);
  }, BASE);
  const frame = page.frameLocator(".tour-widget");
  await frame.locator(".widget-group").nth(1).waitFor();
  await wait(300);
  // Fit the iframe to the widget card: the real window sizes itself the same way.
  const height = await frame.locator(".widget").evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
  await page.locator(".tour-widget").evaluate((el, h) => {
    (el as HTMLElement).style.height = `${h}px`;
    // Next frame, so the transition has a starting state to animate from.
    requestAnimationFrame(() => el.classList.add("is-shown"));
  }, height);
  await wait(2400);

  await collectStubWarnings(page, "tour");
  const video = page.video();
  if (!video) throw new Error("녹화 파일이 생성되지 않았습니다.");
  await ctx.close(); // the video is only flushed on close
  return await video.path();
}

/**
 * webm → GIF with a two-pass palette. A GIF is capped at 256 colours, and the
 * default palette turns the app's flat greys into visible banding; palettegen
 * derives one from the actual frames instead. Dithering is off on purpose: the
 * UI is flat fills, which a derived palette reproduces exactly, and dither
 * noise would both look wrong and inflate the file by half.
 */
async function toGif(videoPath: string, outPath: string): Promise<void> {
  const palette = join(TMP_DIR, "palette.png");
  const scale = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`;
  await run("ffmpeg", ["-y", "-i", videoPath, "-vf", `${scale},palettegen=stats_mode=diff`, palette]);
  await run("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-i", palette,
    "-lavfi", `${scale}[x];[x][1:v]paletteuse=dither=none`,
    "-loop", "0",
    outPath,
  ]);
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

const EXPECTED = ["main-dark.png", "tour.gif", "widget.png", "history.png", "settings.png"];

async function main(): Promise<void> {
  await requireKoreanFont();
  await requireFfmpeg();
  await mkdir(OUT_DIR, { recursive: true });
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });

  const stopServer = await ensureDevServer();
  const browser = await chromium.launch();
  try {
    console.log("• 정지 스크린샷 촬영");
    await captureStills(browser);
    console.log("• 투어 녹화");
    const video = await recordTour(browser);
    console.log("• GIF 변환");
    await toGif(video, join(OUT_DIR, "tour.gif"));
    console.log("  ✓ tour.gif");
  } finally {
    await browser.close();
    stopServer();
  }

  if (problems.length) {
    throw new Error("캡처 중 문제가 발생했습니다:\n  - " + problems.join("\n  - "));
  }

  console.log("\n결과:");
  for (const name of EXPECTED) {
    const { size } = await stat(join(OUT_DIR, name));
    const kb = (size / 1024).toFixed(0);
    const warn = name === "tour.gif" && size > GIF_MAX_BYTES ? "  ← 3MB 초과, fps/폭을 낮추세요" : "";
    console.log(`  ${name.padEnd(14)} ${kb.padStart(6)} KB${warn}`);
  }
  await rm(TMP_DIR, { recursive: true, force: true });
}

main().catch((e) => {
  console.error("\n" + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
