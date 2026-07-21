# 미니 위젯 창 (A안) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude/Codex의 5개 한도 막대와 리셋 카운트다운을 상시 띄우는 프레임리스·투명·항상-위 미니 위젯 창을 추가한다.

**Architecture:** 별도 Vite 진입점(`widget.html`)으로 위젯 전용 번들을 만들고, 두 번째 Tauri 창("widget")으로 로드한다. 위젯은 새 `useUsageReport()` 훅으로 백엔드의 `usage-updated` 이벤트와 `get_usage`를 그대로 재사용하고, 기존 `LimitBar` 컴포넌트를 렌더한다. 열기/닫기는 트레이 우클릭 메뉴와 메인 헤더 버튼이 백엔드 커맨드(`toggle_widget`/`show_main`)를 호출해 처리한다.

**Tech Stack:** React 19 + TypeScript + Vite 7, Tauri v2 (Rust), vitest + @testing-library/react, i18next.

## Global Constraints

- `App.tsx`는 수정하지 않는다 (회귀 위험 최소화). 위젯은 새 훅만 사용한다.
- 기존 트레이 좌클릭=메인 창 토글 동작을 유지한다.
- 위젯 창은 시작 시 숨김(`visible:false`)이며 파괴되지 않고 hide/show만 한다 → 표시/숨김 간 위치는 네이티브로 유지된다(별도 저장 코드 불필요).
- 위젯은 메인과 동일한 테마·언어 설정을 따른다 (`applyTheme`, `i18n.changeLanguage`).
- provider accent 색은 기존 `provider-claude`(#D97757) / `provider-codex`(#5162ED) 클래스로 스코프한다.
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- 검증: `npm test` 통과 + `npm run build` 성공 + (가능 환경에서) `cargo build` 성공.

## File Structure

- Create: `src/lib/useUsageReport.ts` — 사용량 리포트 + 카운트다운 + 이벤트 구독 훅
- Create: `src/lib/useUsageReport.test.tsx` — 훅 단위 테스트
- Create: `widget.html` — 위젯 창 HTML 진입점
- Create: `src/widget/widget-main.tsx` — 위젯 React 부트스트랩(설정/테마/언어 적용)
- Create: `src/widget/WidgetApp.tsx` — 위젯 UI
- Create: `src/widget/WidgetApp.test.tsx` — 위젯 렌더/상호작용 테스트
- Create: `src/widget/widget.css` — 위젯 컴팩트/투명 스타일
- Modify: `vite.config.ts` — 멀티 엔트리(main + widget)
- Modify: `src-tauri/tauri.conf.json` — 위젯 window 정의 + `macOSPrivateApi`
- Modify: `src-tauri/capabilities/default.json` — widget 창 권한
- Modify: `src-tauri/src/commands.rs` — `show_main`, `toggle_widget` 커맨드
- Modify: `src-tauri/src/lib.rs` — 커맨드 등록 + 트레이 우클릭 메뉴
- Modify: `src/components/Header.tsx` — 위젯 토글 버튼
- Modify: `src/App.test.tsx` — 위젯 버튼 테스트 추가
- Modify: `src/locales/en.json`, `src/locales/ko.json` — `app.widget` 키

---

### Task 1: `useUsageReport` 훅

사용량 리포트 로드 + `usage-updated` 구독 + 1초 카운트다운 틱 + `reload`를 캡슐화한다. `App.tsx`의 해당 로직과 동일한 원천을 쓰되 위젯 전용으로 새로 만든다.

**Files:**
- Create: `src/lib/useUsageReport.ts`
- Test: `src/lib/useUsageReport.test.tsx`

**Interfaces:**
- Consumes: `fetchUsage`, `onUsageUpdated`, `mergeReport` (from `src/lib/usage.ts`), `UsageReport` (from `src/lib/types.ts`)
- Produces:
  ```ts
  interface UseUsageReport {
    report: UsageReport | null;
    loadFailed: string | null;
    now: number;            // unix seconds, ticks each second
    reload: () => Promise<void>;
  }
  function useUsageReport(): UseUsageReport
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/useUsageReport.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { UsageReport } from "./types";

const report: UsageReport = {
  claude: { provider: "claude", plan: "Max 20x", plan_raw: "max", source: "live", updated_at: 10, windows: [{ id: "claude_session", used_percent: 5, resets_at: 999999999, available: true }], error: null },
  codex: { provider: "codex", plan: "Pro", plan_raw: "pro", source: "live", updated_at: 10, windows: [{ id: "codex_weekly", used_percent: 11, resets_at: 999999999, available: true }], error: null },
};

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { useUsageReport } from "./useUsageReport";
import { invoke } from "@tauri-apps/api/core";

describe("useUsageReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.resolve(report) : Promise.resolve(null)) as never);
  });

  it("loads the usage report on mount", async () => {
    const { result } = renderHook(() => useUsageReport());
    await waitFor(() => expect(result.current.report?.claude.plan).toBe("Max 20x"));
    expect(result.current.loadFailed).toBeNull();
  });

  it("refetches on reload()", async () => {
    const { result } = renderHook(() => useUsageReport());
    await waitFor(() => expect(result.current.report).not.toBeNull());
    const before = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "get_usage").length;
    await act(async () => { await result.current.reload(); });
    const after = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "get_usage").length;
    expect(after).toBe(before + 1);
  });

  it("records loadFailed when the fetch rejects", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.reject(new Error("cli missing")) : Promise.resolve(null)) as never);
    const { result } = renderHook(() => useUsageReport());
    await waitFor(() => expect(result.current.loadFailed).toBe("cli missing"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/useUsageReport.test.tsx`
Expected: FAIL — cannot resolve `./useUsageReport`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/useUsageReport.ts`:
```ts
import { useEffect, useState, useCallback } from "react";
import { fetchUsage, onUsageUpdated, mergeReport } from "./usage";
import type { UsageReport } from "./types";

export interface UseUsageReport {
  report: UsageReport | null;
  loadFailed: string | null;
  now: number;
  reload: () => Promise<void>;
}

/// The widget's single source of usage data: mirrors App's limits fetch —
/// keeps the last good snapshot per provider (mergeReport) across a transient
/// failure, subscribes to the backend poller's `usage-updated` events, and
/// ticks `now` each second for the reset countdowns.
export function useUsageReport(): UseUsageReport {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const apply = useCallback((next: UsageReport) => {
    setReport((prev) => mergeReport(prev, next));
  }, []);

  const reload = useCallback(
    () =>
      fetchUsage()
        .then((r) => { apply(r); setLoadFailed(null); })
        .catch((e) => setLoadFailed(e instanceof Error ? e.message : String(e))),
    [apply]
  );

  useEffect(() => {
    reload();
    const un = onUsageUpdated(apply);
    return () => { un.then((f) => f()); };
  }, [apply, reload]);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return { report, loadFailed, now, reload };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/useUsageReport.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/useUsageReport.ts src/lib/useUsageReport.test.tsx
git commit -m "feat(widget): useUsageReport 훅 추가 (#36)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 위젯 프런트엔드 (WidgetApp + 진입점 + 스타일 + 빌드 설정)

위젯 UI와 그 Vite 진입점을 만든다. 위젯은 상단 바(드래그 영역 + 새로고침 + 닫기)와 본문(5개 막대, 클릭 시 메인 열기)으로 구성된다.

**Files:**
- Create: `src/widget/WidgetApp.tsx`
- Create: `src/widget/WidgetApp.test.tsx`
- Create: `src/widget/widget-main.tsx`
- Create: `src/widget/widget.css`
- Create: `widget.html`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `useUsageReport` (Task 1), `LimitBar` (`src/components/LimitBar.tsx`), `UsageSnapshot` (`src/lib/types.ts`), `getSettings` (`src/lib/settings.ts`), `applyTheme` (`src/theme.ts`), i18n default export (`src/i18n.ts`)
- Produces: `WidgetApp({ locale }: { locale: "en" | "ko" })`

- [ ] **Step 1: Write the failing test**

Create `src/widget/WidgetApp.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { UsageReport } from "../lib/types";

const report: UsageReport = {
  claude: { provider: "claude", plan: "Max 20x", plan_raw: "max", source: "live", updated_at: 10, windows: [
    { id: "claude_session", used_percent: 45, resets_at: 999999999, available: true },
    { id: "claude_weekly_all", used_percent: 60, resets_at: 999999999, available: true },
    { id: "claude_weekly_fable", used_percent: 10, resets_at: 999999999, available: true },
  ], error: null },
  codex: { provider: "codex", plan: "Pro", plan_raw: "pro", source: "live", updated_at: 10, windows: [
    { id: "codex_weekly", used_percent: 72, resets_at: 999999999, available: true },
    { id: "codex_spark_weekly", used_percent: 30, resets_at: 999999999, available: true },
  ], error: null },
};

const hide = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ hide }) }));

import "../i18n";
import { WidgetApp } from "./WidgetApp";
import { invoke } from "@tauri-apps/api/core";

const invoked = (cmd: string) => vi.mocked(invoke).mock.calls.filter((c) => c[0] === cmd);

describe("WidgetApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hide.mockClear();
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.resolve(report) : Promise.resolve(null)) as never);
  });

  it("renders all five limit bars", async () => {
    render(<WidgetApp locale="en" />);
    await waitFor(() => expect(screen.getAllByTestId("bar-fill")).toHaveLength(5));
  });

  it("opens the main window when the body is clicked", async () => {
    render(<WidgetApp locale="en" />);
    await waitFor(() => expect(screen.getAllByTestId("bar-fill")).toHaveLength(5));
    fireEvent.click(screen.getByTestId("widget-body"));
    expect(invoked("show_main")).toHaveLength(1);
  });

  it("refetches usage when the refresh button is pressed", async () => {
    render(<WidgetApp locale="en" />);
    await waitFor(() => expect(screen.getAllByTestId("bar-fill")).toHaveLength(5));
    const before = invoked("get_usage").length;
    fireEvent.click(screen.getByLabelText("Refresh"));
    await waitFor(() => expect(invoked("get_usage").length).toBe(before + 1));
    // Clicking a bar-bar button must not bubble to the body's open-main handler.
    expect(invoked("show_main")).toHaveLength(0);
  });

  it("hides its own window when the close button is pressed", async () => {
    render(<WidgetApp locale="en" />);
    await waitFor(() => expect(screen.getAllByTestId("bar-fill")).toHaveLength(5));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(hide).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/widget/WidgetApp.test.tsx`
Expected: FAIL — cannot resolve `./WidgetApp`.

- [ ] **Step 3: Write the WidgetApp component**

Create `src/widget/WidgetApp.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUsageReport } from "../lib/useUsageReport";
import { LimitBar } from "../components/LimitBar";
import type { UsageSnapshot } from "../lib/types";

function WidgetGroup({ snapshot, now, locale }: { snapshot: UsageSnapshot; now: number; locale: "en" | "ko" }) {
  const { t } = useTranslation();
  const cls = snapshot.provider === "claude" ? "provider-claude" : "provider-codex";
  return (
    <section className={`widget-group ${cls}`}>
      <h2 className="widget-group__name">{t(`provider.${snapshot.provider}`)}</h2>
      {snapshot.error ? (
        <p className="widget-group__error">{t("provider.unavailable")}</p>
      ) : (
        snapshot.windows.map((w) => <LimitBar key={w.id} window={w} now={now} locale={locale} />)
      )}
    </section>
  );
}

export function WidgetApp({ locale }: { locale: "en" | "ko" }) {
  const { t } = useTranslation();
  const { report, loadFailed, now, reload } = useUsageReport();

  return (
    <div className="widget">
      <div className="widget__bar" data-tauri-drag-region>
        <span className="widget__title" data-tauri-drag-region>{t("app.title")}</span>
        <button className="widget__btn" aria-label={t("app.refresh")}
          onClick={(e) => { e.stopPropagation(); reload(); }}>⟳</button>
        <button className="widget__btn" aria-label={t("app.close")}
          onClick={(e) => { e.stopPropagation(); getCurrentWindow().hide(); }}>×</button>
      </div>
      <div className="widget__body" data-testid="widget-body" onClick={() => invoke("show_main")}>
        {report ? (
          <>
            <WidgetGroup snapshot={report.claude} now={now} locale={locale} />
            <WidgetGroup snapshot={report.codex} now={now} locale={locale} />
          </>
        ) : loadFailed ? (
          <p className="widget__error">{loadFailed}</p>
        ) : (
          <p className="widget__loading">{t("app.loading")}</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/widget/WidgetApp.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the widget stylesheet**

Create `src/widget/widget.css`:
```css
/* Transparent window: the OS shows through wherever the page has no paint.
   The card itself is opaque so the bars stay readable over any wallpaper. */
html, body { background: transparent; margin: 0; }
#root { -webkit-user-select: none; user-select: none; }

.widget {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  font-family: system-ui, -apple-system, sans-serif;
  color: var(--text);
}
.widget__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 10px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.widget__title { flex: 1; font-size: 11px; font-weight: 600; opacity: 0.7; }
.widget__btn {
  border: none; background: transparent; color: var(--text);
  cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 6px; border-radius: 6px;
}
.widget__btn:hover { background: var(--card); }
.widget__body { flex: 1; overflow-y: auto; padding: 8px 10px; cursor: pointer; }
.widget-group { margin-bottom: 8px; }
.widget-group__name { font-size: 11px; font-weight: 700; margin: 0 0 4px; color: var(--accent); }
.widget-group__error { font-size: 11px; opacity: 0.6; margin: 0 0 6px; }
/* Compact the reused LimitBar for the widget's tighter frame. */
.widget .limit-bar { margin-bottom: 5px; }
.widget .limit-bar__row { font-size: 11px; }
.widget .limit-bar__reset { font-size: 10px; opacity: 0.7; }
```

- [ ] **Step 6: Create the widget bootstrap and HTML entry**

Create `src/widget/widget-main.tsx`:
```tsx
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import i18n from "../i18n";
import { applyTheme } from "../theme";
import { getSettings } from "../lib/settings";
import { WidgetApp } from "./WidgetApp";
import "../styles/theme.css";
import "./widget.css";

// Mirrors App's init: the widget follows the same saved theme and language.
function Root() {
  const [locale, setLocale] = useState<"en" | "ko">("en");
  useEffect(() => {
    getSettings().then((s) => {
      applyTheme(s.theme);
      i18n.changeLanguage(s.language);
      setLocale(s.language);
    });
  }, []);
  return <WidgetApp locale={locale} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
```

Create `widget.html` (project root, next to `index.html`):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Widget</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/widget/widget-main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Add the widget entry to the Vite build**

In `vite.config.ts`, add a `build.rollupOptions.input` map so both HTML entries are bundled. Replace the config object body to include `build` (keep `plugins`, `clearScreen`, `server` as-is):
```ts
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        widget: "widget.html",
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
```

- [ ] **Step 8: Verify the build produces both entries**

Run: `npm run build`
Expected: PASS — `tsc` clean, and `dist/` contains both `index.html` and `widget.html`.
Verify: `ls dist/index.html dist/widget.html` → both exist.

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: PASS — existing suites plus the two new files (Task 1 + Task 2) green.

- [ ] **Step 10: Commit**

```bash
git add src/widget widget.html vite.config.ts
git commit -m "feat(widget): 위젯 UI·진입점·빌드 설정 (#36)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Tauri 위젯 창 정의 + 권한

두 번째 창을 config로 선언(시작 시 숨김)하고, 프레임리스·투명·항상-위로 설정한다. 프런트에서 위젯 창을 hide/show/드래그하려면 권한이 필요하다.

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Produces: label `"widget"`인 webview 창(초기 숨김). Task 4·5가 `get_webview_window("widget")`로 참조.

- [ ] **Step 1: Add the widget window to `tauri.conf.json`**

In `src-tauri/tauri.conf.json`, add a second entry to `app.windows` (after the existing `main` window object) and add `macOSPrivateApi` under `app`. Resulting `app` block:
```json
  "app": {
    "macOSPrivateApi": true,
    "windows": [
      {
        "title": "token-usage-app",
        "width": 800,
        "height": 600,
        "minWidth": 700,
        "minHeight": 480
      },
      {
        "label": "widget",
        "url": "widget.html",
        "title": "Widget",
        "width": 260,
        "height": 240,
        "visible": false,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "resizable": false,
        "shadow": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost"
    }
  },
```
> Note: the existing `main` window object has no explicit `"label"`, so Tauri defaults its label to `"main"` — the code already relies on this (`get_webview_window("main")`). Leave it unchanged.

- [ ] **Step 2: Grant the widget window its permissions**

Replace `src-tauri/capabilities/default.json` with:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main and widget windows",
  "windows": ["main", "widget"],
  "permissions": [
    "core:default",
    "core:window:allow-hide",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:window:allow-is-visible",
    "core:window:allow-set-always-on-top",
    "core:window:allow-start-dragging",
    "core:event:allow-listen",
    "store:default",
    "notification:default",
    "dialog:default"
  ]
}
```

- [ ] **Step 3: Verify the config compiles**

Run: `cd src-tauri && cargo build 2>&1 | tail -20`
Expected: PASS — build succeeds; no config-schema error for the new window/permissions.
> If the environment can't build native Tauri deps (WSL system libs), at minimum run `cargo check` and confirm no `tauri.conf.json`/capabilities parse errors appear. See CLAUDE.md memory "Tauri WSL build setup".

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat(widget): 위젯 창 정의·권한 추가 (#36)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 백엔드 커맨드 + 트레이 우클릭 메뉴

위젯을 열고 닫고, 위젯에서 메인을 여는 커맨드를 추가하고, 트레이 우클릭 메뉴를 붙인다. 기존 좌클릭=메인 토글은 유지한다.

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: 창 label `"widget"`, `"main"` (Task 3)
- Produces: `#[tauri::command] show_main(app)`, `#[tauri::command] toggle_widget(app)`; 프런트에서 `invoke("show_main")`, `invoke("toggle_widget")`로 호출.

- [ ] **Step 1: Add the commands**

In `src-tauri/src/commands.rs`, add `use tauri::Manager;` to the imports (join the existing `use tauri::AppHandle;` line region), then append these two commands at the end of the file:
```rust
/// Bring the main window back to the foreground — the widget calls this when
/// its body is clicked so a click on the mini view reopens the full app.
#[tauri::command]
pub fn show_main(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Show or hide the always-on-top widget window. The window is created hidden
/// at startup and only toggled here — never destroyed — so its on-screen
/// position is retained across hide/show for free.
#[tauri::command]
pub fn toggle_widget(app: AppHandle) {
    if let Some(win) = app.get_webview_window("widget") {
        let _ = if win.is_visible().unwrap_or(false) {
            win.hide()
        } else {
            win.show().and_then(|_| win.set_focus())
        };
    }
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/lib.rs`, add the two commands to the `invoke_handler` list:
```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_usage,
            commands::get_settings,
            commands::set_settings,
            commands::get_usage_history,
            commands::export_usage_xlsx,
            commands::show_main,
            commands::toggle_widget,
        ])
```

- [ ] **Step 3: Add the tray right-click menu**

In `src-tauri/src/lib.rs`, add `use tauri::menu::{Menu, MenuItem};` to the imports. Then, inside `.setup(|app| { ... })`, replace the tray-building block (from `let mut tray = TrayIconBuilder::new()...` through `let _tray = tray.build(app)?;`) with:
```rust
            let show_main_i = MenuItem::with_id(app, "show_main", "메인 창 열기", true, None::<&str>)?;
            let toggle_widget_i = MenuItem::with_id(app, "toggle_widget", "위젯 표시/숨기기", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_main_i, &toggle_widget_i, &quit_i])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_main" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "toggle_widget" => {
                        if let Some(win) = app.get_webview_window("widget") {
                            let _ = if win.is_visible().unwrap_or(false) {
                                win.hide()
                            } else {
                                win.show().and_then(|_| win.set_focus())
                            };
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            let _ = if win.is_visible().unwrap_or(false) {
                                win.hide()
                            } else {
                                win.show().and_then(|_| win.set_focus())
                            };
                        }
                    }
                });
            // Only set the icon if one is bundled; a missing icon shouldn't
            // panic app startup.
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            let _tray = tray.build(app)?;
```
> Note: on most platforms `show_menu_on_left_click(false)` keeps left-click firing `on_tray_icon_event` (existing main-toggle) while right-click opens the menu.

- [ ] **Step 4: Build to verify**

Run: `cd src-tauri && cargo build 2>&1 | tail -20`
Expected: PASS — no compile errors; `show_main`/`toggle_widget`/menu resolve.
> WSL fallback: if native build deps are unavailable, run `cargo check` and confirm the new code compiles (type/borrow errors would still surface).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(widget): 위젯 토글·메인 열기 커맨드와 트레이 메뉴 (#36)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 메인 헤더의 위젯 토글 버튼

메인 창 헤더에 위젯을 켜고 끄는 버튼을 추가한다. `App.tsx`를 건드리지 않기 위해 `Header`가 `invoke`를 직접 호출한다.

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/locales/en.json`, `src/locales/ko.json`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `invoke` (`@tauri-apps/api/core`), 커맨드 `"toggle_widget"` (Task 4), i18n 키 `app.widget`
- Produces: 헤더 내 위젯 토글 버튼 (`aria-label` = `t("app.widget")`)

- [ ] **Step 1: Add the i18n keys**

In `src/locales/en.json`, add `"widget": "Widget"` inside the `"app"` object (append before the closing `}` of `app`):
```json
  "app": { "title": "Token Usage", "refresh": "Refresh", "settings": "Settings", "close": "Close", "lastUpdated": "Updated {{time}}", "cached": "cached", "loading": "Loading", "loadFailed": "Couldn't load usage", "refreshFailed": "Couldn't refresh — showing the last snapshot", "widget": "Widget" },
```
In `src/locales/ko.json`, add `"widget": "위젯"` inside `"app"`:
```json
  "app": { "title": "토큰 사용량", "refresh": "새로고침", "settings": "설정", "close": "닫기", "lastUpdated": "{{time}} 갱신", "cached": "캐시됨", "loading": "불러오는 중", "loadFailed": "사용량을 불러오지 못했어요", "refreshFailed": "새로고침에 실패했어요 — 이전 스냅샷을 보여주는 중", "widget": "위젯" },
```

- [ ] **Step 2: Write the failing test**

In `src/App.test.tsx`, add this test inside the `describe("App", ...)` block (e.g. after the "renders both provider cards" test):
```tsx
  it("toggles the widget window from the header button", async () => {
    render(<App />);
    await screen.findByText("Max 20x");
    fireEvent.click(screen.getByLabelText("Widget"));
    expect(invoked("toggle_widget")).toHaveLength(1);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/App.test.tsx -t "toggles the widget window"`
Expected: FAIL — no element with label "Widget" / `toggle_widget` never invoked.

- [ ] **Step 4: Add the button to Header**

In `src/components/Header.tsx`, add the import at the top:
```tsx
import { invoke } from "@tauri-apps/api/core";
```
Then, in the `app-header__actions` div, add the widget button after the settings button:
```tsx
        <button onClick={onOpenSettings} aria-label={t("app.settings")}>⚙</button>
        <button onClick={() => invoke("toggle_widget")} aria-label={t("app.widget")}>▭</button>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/App.test.tsx -t "toggles the widget window"`
Expected: PASS.
> `App.test.tsx` already mocks `@tauri-apps/api/core`'s `invoke`, and its `defaultInvoke` returns `null` for unknown commands, so `toggle_widget` is safely stubbed and existing tests are unaffected.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 7: Commit**

```bash
git add src/components/Header.tsx src/locales/en.json src/locales/ko.json src/App.test.tsx
git commit -m "feat(widget): 메인 헤더에 위젯 토글 버튼 (#36)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 통합 검증 & 육안 확인

전체 빌드와 실제 동작을 확인한다.

**Files:** (없음 — 검증 전용)

- [ ] **Step 1: Full frontend gate**

Run: `npm test && npm run build`
Expected: 모든 테스트 PASS, `dist/index.html`·`dist/widget.html` 생성.

- [ ] **Step 2: Native build (가능 환경)**

Run: `cd src-tauri && cargo build 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 3: 육안 검증 — 위젯 렌더**

`__TAURI_INTERNALS__` 스텁으로 `widget.html`을 브라우저에서 열어(또는 `npm run tauri dev`로 앱 실행) 다음을 확인:
- 위젯이 5개 막대(Claude 3 + Codex 2)와 리셋 카운트다운을 보여준다
- 헤더의 위젯 버튼(▭) 클릭 시 위젯이 토글된다
- 위젯 상단 바 드래그로 창이 이동한다
- 새로고침(⟳) 클릭 시 값이 갱신되고, ×로 닫히며, 본문 클릭 시 메인이 열린다
- 트레이 우클릭 메뉴에 `메인 창 열기`/`위젯 표시/숨기기`/`종료`가 있고 동작한다
- 다크/라이트, 한/영 전환이 위젯에도 반영된다
> 메모리 "브라우저 육안 검증" 참고: 픽스처에 5개 막대 등 모든 모양을 넣을 것.

- [ ] **Step 4: 최종 커밋 (필요 시)**

육안 검증에서 미세조정(창 크기/CSS)이 나오면 해당 파일만 수정 후 커밋.

## Self-Review

- **Spec coverage:** 위젯 창(Task 3) · 5개 막대 내용(Task 2) · 열기 트레이+헤더(Task 4,5) · 드래그/새로고침/닫기/메인열기(Task 2,4) · 테마·언어(Task 2) · 위치 기억(Global Constraints: hide/show 네이티브 유지로 충족) · 권한(Task 3) · 데이터 재사용 훅(Task 1) · 테스트(Task 1,2,5) — 모두 태스크로 커버됨. 스펙 §7의 store 기반 위치 저장은 "표시/숨김 간" 요건에 대해 hide/show 네이티브 유지로 대체(범위 축소, 요건 충족).
- **Placeholder scan:** 모든 코드 스텝에 실제 코드 포함, TBD/TODO 없음.
- **Type consistency:** `useUsageReport()` 반환 `{ report, loadFailed, now, reload }`을 Task 2가 동일 이름으로 소비. `show_main`/`toggle_widget` 커맨드명이 Task 2·4·5에서 일치. `WidgetApp({ locale })` 시그니처가 Task 2 내부에서 일치.
