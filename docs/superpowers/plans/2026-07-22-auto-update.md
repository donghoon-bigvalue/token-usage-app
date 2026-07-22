# 자동 업데이트 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tauri 2 공식 updater로 시작 시 자동 업데이트 팝업과 설정 내 수동 업데이트 UX를 추가한다.

**Architecture:** 프론트에 하나의 업데이트 로직 계층(`updater.ts` + `updater-store.ts`)과 상태 훅(`useUpdater`)을 두고, 두 진입점(App 시작 시 `UpdateDialog`, 설정 내 `UpdateSettingsSection`)이 이를 공유한다. 백엔드는 `tauri-plugin-updater`/`tauri-plugin-process` 등록과 서명·엔드포인트 설정만 담당한다.

**Tech Stack:** Tauri 2, `tauri-plugin-updater`, `tauri-plugin-process`, React 19, TypeScript, react-i18next, Vitest + Testing Library.

## Global Constraints

- 업데이트 엔드포인트: `https://github.com/donghoon-bigvalue/token-usage-app/releases/latest/download/latest.json` (verbatim).
- 자동 확인은 **하루 1회**: 직전 확인이 24시간(`86_400_000` ms) 이내면 시작 시 스킵.
- "다음에 하기" = 해당 버전을 `dismissedVersion`으로 저장, 더 새 버전이 나오면 재팝업. 수동 확인은 스로틀·dismissed를 **모두 무시**.
- 영속화 키: `localStorage`의 `"updater.lastCheckAt"`(숫자 ms), `"updater.dismissedVersion"`(문자열). — 스칼라 2개뿐이라 IPC 없이 jsdom에서 그대로 테스트 가능하도록 plugin-store 대신 localStorage 사용.
- 버전 비교는 하지 않는다. 플러그인 `check()`가 비-null이면 곧 "업데이트 있음"이며, `update.version`을 그대로 사용한다.
- 문구는 반드시 `ko.json`/`en.json` 양쪽에 추가 (i18n 키 패리티).
- Rust 명령은 `src-tauri/`에서 실행 (WSL 빌드 환경 규칙: `PKG_CONFIG_PATH` 설정, cargo는 `src-tauri/`에서).

---

### Task 1: 백엔드 — updater/process 플러그인 및 서명·엔드포인트 설정

**Files:**
- Modify: `src-tauri/Cargo.toml` (dependencies)
- Modify: `src-tauri/src/lib.rs:16-20` (플러그인 등록)
- Modify: `src-tauri/tauri.conf.json` (bundle + plugins)
- Modify: `src-tauri/capabilities/default.json` (permissions)
- Modify: `package.json` (JS 플러그인 의존성)

**Interfaces:**
- Consumes: 없음 (기반 작업)
- Produces: JS에서 `@tauri-apps/plugin-updater`의 `check`, `@tauri-apps/plugin-process`의 `relaunch` 호출 가능. `tauri.conf.json`에 유효한 `plugins.updater.pubkey`/`endpoints` 존재.

- [ ] **Step 1: 서명 키페어 생성 (엔지니어 로컬 1회)**

Run:
```bash
npm run tauri signer generate -- -w "$HOME/.tauri/token-usage-app.key"
```
- 콘솔에 출력되는 **Public key**(base64)를 복사해 둔다 (Step 4에서 사용).
- 생성된 개인키 파일(`~/.tauri/token-usage-app.key`)과 입력한 비밀번호는 안전히 보관한다. 이 두 값은 Task 7에서 GitHub Secrets로 등록한다.
- 비상호작용 환경이면 `--password ''` 로 빈 비밀번호를 줄 수 있다(그 경우 Secret 비밀번호도 빈 문자열).

- [ ] **Step 2: JS 플러그인 의존성 추가**

Run:
```bash
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
```
Expected: `package.json` `dependencies`에 두 패키지가 추가됨.

- [ ] **Step 3: Rust 의존성 추가**

`src-tauri/Cargo.toml`의 `[dependencies]` 끝에 추가:
```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 4: `tauri.conf.json`에 updater 설정과 아티팩트 생성 플래그 추가**

`bundle` 객체에 `createUpdaterArtifacts`를 추가하고, 최상위에 `plugins`를 추가한다. `PASTE_PUBLIC_KEY_HERE`를 Step 1의 Public key로 교체한다.
```json
  "bundle": {
    "active": true,
    "createUpdaterArtifacts": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/donghoon-bigvalue/token-usage-app/releases/latest/download/latest.json"
      ],
      "pubkey": "PASTE_PUBLIC_KEY_HERE"
    }
  }
```
(주의: `bundle` 뒤에 `plugins`를 추가하므로 `bundle` 객체의 닫는 `}` 뒤에 콤마가 있어야 한다.)

- [ ] **Step 5: `capabilities/default.json`에 권한 추가**

`permissions` 배열의 `"dialog:default"` 다음에 추가:
```json
    "dialog:default",
    "updater:default",
    "process:allow-restart"
```

- [ ] **Step 6: `lib.rs`에 플러그인 등록**

`src-tauri/src/lib.rs`의 빌더 체인에서 `.plugin(tauri_plugin_dialog::init())` 다음 줄에 추가:
```rust
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
```

- [ ] **Step 7: 컴파일 검증**

Run (WSL 빌드 환경 변수 적용 후 `src-tauri/`에서):
```bash
cd src-tauri && cargo check
```
Expected: 에러 없이 완료 (updater/process 크레이트 다운로드·컴파일). 경고는 허용.

- [ ] **Step 8: 프론트 타입/빌드 검증**

Run:
```bash
npm run build
```
Expected: `tsc` 통과, vite 빌드 성공.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/capabilities/default.json package.json package-lock.json
git commit -m "feat(update): register updater/process plugins and signing config (#47)"
```

---

### Task 2: 업데이트 로직 계층 (`updater-store.ts` + `updater.ts`)

**Files:**
- Create: `src/lib/updater-store.ts`
- Create: `src/lib/updater.ts`
- Test: `src/lib/updater-store.test.ts`

**Interfaces:**
- Consumes: `@tauri-apps/plugin-updater`(`check`, `Update`), `@tauri-apps/plugin-process`(`relaunch`), `@tauri-apps/api/app`(`getVersion`) — Task 1에서 사용 가능.
- Produces:
  - `updater-store.ts`: `shouldAutoCheck(now: number, lastCheckAt: number | null): boolean`, `shouldPrompt(version: string, dismissedVersion: string | null): boolean`, `getLastCheckAt(): number | null`, `setLastCheckAt(ts: number): void`, `getDismissedVersion(): string | null`, `setDismissedVersion(v: string): void`.
  - `updater.ts`: `type UpdateInfo = { version: string; notes: string; update: Update }`, `checkForUpdate(): Promise<UpdateInfo | null>`, `installUpdate(info: UpdateInfo, onProgress?: (fraction: number) => void): Promise<void>`, `relaunchApp(): Promise<void>`, `getCurrentVersion(): Promise<string>`.

- [ ] **Step 1: `updater-store.test.ts` 작성 (실패 테스트)**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldAutoCheck,
  shouldPrompt,
  getLastCheckAt,
  setLastCheckAt,
  getDismissedVersion,
  setDismissedVersion,
} from "./updater-store";

const DAY = 86_400_000;

describe("shouldAutoCheck", () => {
  it("checks when never checked before", () => {
    expect(shouldAutoCheck(DAY, null)).toBe(true);
  });
  it("skips within 24h", () => {
    expect(shouldAutoCheck(DAY + 1000, DAY)).toBe(false);
  });
  it("checks exactly at 24h boundary", () => {
    expect(shouldAutoCheck(2 * DAY, DAY)).toBe(true);
  });
});

describe("shouldPrompt", () => {
  it("prompts when nothing dismissed", () => {
    expect(shouldPrompt("1.1.0", null)).toBe(true);
  });
  it("suppresses the dismissed version", () => {
    expect(shouldPrompt("1.1.0", "1.1.0")).toBe(false);
  });
  it("prompts again for a newer version", () => {
    expect(shouldPrompt("1.2.0", "1.1.0")).toBe(true);
  });
});

describe("persistence", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips lastCheckAt", () => {
    expect(getLastCheckAt()).toBeNull();
    setLastCheckAt(1234);
    expect(getLastCheckAt()).toBe(1234);
  });
  it("round-trips dismissedVersion", () => {
    expect(getDismissedVersion()).toBeNull();
    setDismissedVersion("1.2.3");
    expect(getDismissedVersion()).toBe("1.2.3");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/updater-store.test.ts`
Expected: FAIL — `Cannot find module './updater-store'`.

- [ ] **Step 3: `updater-store.ts` 구현**

```ts
const LAST_CHECK_KEY = "updater.lastCheckAt";
const DISMISSED_KEY = "updater.dismissedVersion";
const DAY_MS = 86_400_000;

/** 자동 확인 스로틀: 한 번도 안 했거나 24시간이 지났으면 true. */
export function shouldAutoCheck(now: number, lastCheckAt: number | null): boolean {
  return lastCheckAt == null || now - lastCheckAt >= DAY_MS;
}

/** dismissed와 다른 버전일 때만 자동 팝업을 띄운다. */
export function shouldPrompt(version: string, dismissedVersion: string | null): boolean {
  return version !== dismissedVersion;
}

export function getLastCheckAt(): number | null {
  const v = localStorage.getItem(LAST_CHECK_KEY);
  return v == null ? null : Number(v);
}

export function setLastCheckAt(ts: number): void {
  localStorage.setItem(LAST_CHECK_KEY, String(ts));
}

export function getDismissedVersion(): string | null {
  return localStorage.getItem(DISMISSED_KEY);
}

export function setDismissedVersion(version: string): void {
  localStorage.setItem(DISMISSED_KEY, version);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/updater-store.test.ts`
Expected: PASS (전부).

- [ ] **Step 5: `updater.ts` 구현 (플러그인 얇은 래퍼)**

```ts
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export type UpdateInfo = {
  version: string;
  notes: string;
  update: Update;
};

/** 업데이트가 있으면 정규화된 정보를, 없으면 null을 반환. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  if (!update) return null;
  return { version: update.version, notes: update.body ?? "", update };
}

/** 다운로드+설치. onProgress는 0..1 진행률(총 크기 불명이면 -1)을 콜백. */
export async function installUpdate(
  info: UpdateInfo,
  onProgress?: (fraction: number) => void
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await info.update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress?.(total ? 0 : -1);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(total ? downloaded / total : -1);
        break;
      case "Finished":
        onProgress?.(1);
        break;
    }
  });
}

export async function relaunchApp(): Promise<void> {
  await relaunch();
}

export function getCurrentVersion(): Promise<string> {
  return getVersion();
}
```

- [ ] **Step 6: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 7: Commit**

```bash
git add src/lib/updater-store.ts src/lib/updater.ts src/lib/updater-store.test.ts
git commit -m "feat(update): add updater logic layer with throttle/dismiss (#47)"
```

---

### Task 3: `useUpdater` 상태 훅

**Files:**
- Create: `src/lib/useUpdater.ts`
- Test: `src/lib/useUpdater.test.tsx`

**Interfaces:**
- Consumes: `updater.ts`(`checkForUpdate`, `installUpdate`, `relaunchApp`, `UpdateInfo`), `updater-store.ts`(`setDismissedVersion`).
- Produces:
  - `type UpdaterState = { kind: "idle" } | { kind: "checking" } | { kind: "upToDate" } | { kind: "available"; info: UpdateInfo } | { kind: "downloading"; info: UpdateInfo; fraction: number } | { kind: "installed" } | { kind: "error"; message: string }`
  - `useUpdater(): { state: UpdaterState; check: () => Promise<void>; install: () => Promise<void>; dismiss: () => void; relaunch: () => Promise<void> }`

- [ ] **Step 1: 실패 테스트 작성**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useUpdater } from "./useUpdater";

vi.mock("./updater", () => ({
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  relaunchApp: vi.fn(),
}));
vi.mock("./updater-store", () => ({ setDismissedVersion: vi.fn() }));

import { checkForUpdate, installUpdate } from "./updater";
import { setDismissedVersion } from "./updater-store";

const info = { version: "1.1.0", notes: "x", update: {} as never };

beforeEach(() => vi.clearAllMocks());

describe("useUpdater", () => {
  it("goes checking -> upToDate when no update", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    expect(result.current.state.kind).toBe("upToDate");
  });

  it("goes to available when an update exists", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    expect(result.current.state).toEqual({ kind: "available", info });
  });

  it("errors when check throws", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    expect(result.current.state).toEqual({ kind: "error", message: "boom" });
  });

  it("dismiss records the version and returns to idle", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    act(() => { result.current.dismiss(); });
    expect(setDismissedVersion).toHaveBeenCalledWith("1.1.0");
    expect(result.current.state.kind).toBe("idle");
  });

  it("install transitions downloading -> installed", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    (installUpdate as ReturnType<typeof vi.fn>).mockImplementation(
      async (_i, onProgress) => { onProgress?.(0.5); }
    );
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    await act(async () => { await result.current.install(); });
    await waitFor(() => expect(result.current.state.kind).toBe("installed"));
  });

  it("dismiss twice only records once", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    act(() => { result.current.dismiss(); });
    act(() => { result.current.dismiss(); });
    expect(setDismissedVersion).toHaveBeenCalledTimes(1);
  });

  it("does not reinstall after a completed install", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(info);
    (installUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.check(); });
    await act(async () => { await result.current.install(); });
    await act(async () => { await result.current.install(); });
    expect(installUpdate).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe("installed");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/useUpdater.test.tsx`
Expected: FAIL — `Cannot find module './useUpdater'`.

- [ ] **Step 3: `useUpdater.ts` 구현**

```ts
import { useCallback, useRef, useState } from "react";
import {
  checkForUpdate,
  installUpdate,
  relaunchApp,
  type UpdateInfo,
} from "./updater";
import { setDismissedVersion } from "./updater-store";

export type UpdaterState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; fraction: number }
  | { kind: "installed" }
  | { kind: "error"; message: string };

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({ kind: "idle" });
  // check()가 받은 업데이트를 install()/dismiss()가 동기적으로 읽도록 ref에 보관한다.
  // setState 콜백으로 상태를 되읽는 방식은 React 19에서 updater가 호출 시점이 아닌
  // 이후 렌더에서 실행될 수 있어 신뢰할 수 없다. 소비 후에는 null로 비워
  // 완료/취소 뒤 재실행을 막는다.
  const infoRef = useRef<UpdateInfo | null>(null);
  // 다운로드 중 재진입(버튼 더블클릭 등)으로 설치가 중복 실행되는 것을 막는다.
  const busyRef = useRef(false);

  const check = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const info = await checkForUpdate();
      infoRef.current = info;
      setState(info ? { kind: "available", info } : { kind: "upToDate" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const install = useCallback(async () => {
    const info = infoRef.current;
    if (!info || busyRef.current) return;
    busyRef.current = true;
    setState({ kind: "downloading", info, fraction: 0 });
    try {
      await installUpdate(info, (fraction) =>
        setState((s) => (s.kind === "downloading" ? { ...s, fraction } : s))
      );
      infoRef.current = null; // 완료 — 재설치 방지
      setState({ kind: "installed" });
    } catch (e) {
      // 실패 시 infoRef는 유지해 재시도(retry)가 가능하도록 한다.
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      busyRef.current = false;
    }
  }, []);

  const dismiss = useCallback(() => {
    if (infoRef.current) {
      setDismissedVersion(infoRef.current.version);
      infoRef.current = null; // 한 번만 기록 — 반복 dismiss는 no-op
    }
    setState({ kind: "idle" });
  }, []);

  const relaunch = useCallback(async () => {
    await relaunchApp();
  }, []);

  return { state, check, install, dismiss, relaunch };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/useUpdater.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/useUpdater.ts src/lib/useUpdater.test.tsx
git commit -m "feat(update): add useUpdater state hook (#47)"
```

---

### Task 4: `UpdateDialog` 컴포넌트 (시작 시 팝업)

**Files:**
- Create: `src/components/UpdateDialog.tsx`
- Test: `src/components/UpdateDialog.test.tsx`
- Modify: `src/locales/ko.json`, `src/locales/en.json` (update 문구 키)

**Interfaces:**
- Consumes: `UpdaterState`(Task 3), i18n `update.*` 키.
- Produces: `UpdateDialog({ state, onInstall, onDismiss, onRelaunch }: { state: UpdaterState; onInstall: () => void; onDismiss: () => void; onRelaunch: () => void })` — `state.kind`가 `available|downloading|installed|error`일 때만 모달을 렌더, 그 외엔 `null`.

- [ ] **Step 1: i18n `update` 키 추가**

`src/locales/ko.json`에 최상위 `settings` 항목 다음 줄에 추가:
```json
  "update": { "title": "새 버전이 있습니다", "available": "새 버전 v{{version}}이(가) 나왔습니다.", "install": "자동 업데이트", "later": "다음에 하기", "downloading": "다운로드 중…", "installed": "설치 완료 — 재시작하면 적용됩니다", "restart": "지금 재시작", "error": "업데이트에 실패했어요", "retry": "다시 시도", "current": "현재 버전 v{{version}}", "check": "업데이트 확인", "checking": "확인 중…", "upToDate": "최신 버전을 사용 중입니다.", "hasUpdate": "업데이트가 있습니다 (v{{version}})" },
```

`src/locales/en.json`에 동일 위치:
```json
  "update": { "title": "Update available", "available": "Version v{{version}} is available.", "install": "Update now", "later": "Later", "downloading": "Downloading…", "installed": "Installed — restart to apply", "restart": "Restart now", "error": "Update failed", "retry": "Retry", "current": "Current version v{{version}}", "check": "Check for updates", "checking": "Checking…", "upToDate": "You're on the latest version.", "hasUpdate": "An update is available (v{{version}})" },
```

- [ ] **Step 2: 실패 테스트 작성**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "../i18n";
import { UpdateDialog } from "./UpdateDialog";
import type { UpdaterState } from "../lib/useUpdater";

const info = { version: "1.1.0", notes: "release notes", update: {} as never };

describe("UpdateDialog", () => {
  it("renders nothing when idle", () => {
    const { container } = render(
      <UpdateDialog state={{ kind: "idle" }} onInstall={() => {}} onDismiss={() => {}} onRelaunch={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows version and buttons when available", () => {
    const onInstall = vi.fn();
    const onDismiss = vi.fn();
    render(
      <UpdateDialog state={{ kind: "available", info }} onInstall={onInstall} onDismiss={onDismiss} onRelaunch={() => {}} />
    );
    expect(screen.getByText(/1\.1\.0/)).toBeInTheDocument();
    screen.getByRole("button", { name: "자동 업데이트" }).click();
    screen.getByRole("button", { name: "다음에 하기" }).click();
    expect(onInstall).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("shows progress while downloading", () => {
    const state: UpdaterState = { kind: "downloading", info, fraction: 0.42 };
    render(<UpdateDialog state={state} onInstall={() => {}} onDismiss={() => {}} onRelaunch={() => {}} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it("offers restart when installed", () => {
    const onRelaunch = vi.fn();
    render(<UpdateDialog state={{ kind: "installed" }} onInstall={() => {}} onDismiss={() => {}} onRelaunch={onRelaunch} />);
    screen.getByRole("button", { name: "지금 재시작" }).click();
    expect(onRelaunch).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/components/UpdateDialog.test.tsx`
Expected: FAIL — `Cannot find module './UpdateDialog'`.

- [ ] **Step 4: `UpdateDialog.tsx` 구현**

```tsx
import { useTranslation } from "react-i18next";
import type { UpdaterState } from "../lib/useUpdater";

export function UpdateDialog({
  state,
  onInstall,
  onDismiss,
  onRelaunch,
}: {
  state: UpdaterState;
  onInstall: () => void;
  onDismiss: () => void;
  onRelaunch: () => void;
}) {
  const { t } = useTranslation();
  if (
    state.kind === "idle" ||
    state.kind === "checking" ||
    state.kind === "upToDate"
  ) {
    return null;
  }

  return (
    <div className="update-dialog__backdrop" role="dialog" aria-modal="true" aria-label={t("update.title")}>
      <div className="update-dialog">
        <h2 className="update-dialog__title">{t("update.title")}</h2>

        {state.kind === "available" && (
          <>
            <p>{t("update.available", { version: state.info.version })}</p>
            {state.info.notes && <pre className="update-dialog__notes">{state.info.notes}</pre>}
            <div className="update-dialog__actions">
              <button className="update-dialog__primary" onClick={onInstall}>{t("update.install")}</button>
              <button onClick={onDismiss}>{t("update.later")}</button>
            </div>
          </>
        )}

        {state.kind === "downloading" && (
          <>
            <p>{t("update.downloading")}</p>
            <progress
              role="progressbar"
              aria-valuenow={state.fraction >= 0 ? Math.round(state.fraction * 100) : undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              value={state.fraction >= 0 ? state.fraction : undefined}
            />
          </>
        )}

        {state.kind === "installed" && (
          <>
            <p>{t("update.installed")}</p>
            <div className="update-dialog__actions">
              <button className="update-dialog__primary" onClick={onRelaunch}>{t("update.restart")}</button>
            </div>
          </>
        )}

        {state.kind === "error" && (
          <>
            <p>{t("update.error")}: {state.message}</p>
            <div className="update-dialog__actions">
              <button className="update-dialog__primary" onClick={onInstall}>{t("update.retry")}</button>
              <button onClick={onDismiss}>{t("update.later")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/components/UpdateDialog.test.tsx`
Expected: PASS (전부). (참고: `<progress value={0.42}>`의 `aria-valuenow`는 명시 지정값 `42`.)

- [ ] **Step 6: 최소 스타일 추가**

`src/styles/theme.css` 맨 끝에 추가:
```css
.update-dialog__backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1000;
}
.update-dialog {
  background: var(--surface, #fff);
  color: var(--text, #111);
  border-radius: 10px;
  padding: 20px;
  width: min(420px, 90vw);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}
.update-dialog__title { margin: 0 0 8px; font-size: 1.1rem; }
.update-dialog__notes {
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 0.85rem;
  background: rgba(127, 127, 127, 0.1);
  padding: 8px;
  border-radius: 6px;
}
.update-dialog__actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.update-dialog__primary { font-weight: 600; }
.update-dialog progress { width: 100%; }
```

- [ ] **Step 7: i18n 패리티 및 전체 테스트**

Run: `npx vitest run src/i18n.test.ts src/components/UpdateDialog.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/UpdateDialog.tsx src/components/UpdateDialog.test.tsx src/locales/ko.json src/locales/en.json src/styles/theme.css
git commit -m "feat(update): add UpdateDialog with i18n and styles (#47)"
```

---

### Task 5: 설정 내 업데이트 섹션 (`UpdateSettingsSection`)

**Files:**
- Create: `src/components/UpdateSettingsSection.tsx`
- Test: `src/components/UpdateSettingsSection.test.tsx`
- Modify: `src/components/SettingsPanel.tsx` (섹션 삽입)

**Interfaces:**
- Consumes: `useUpdater`(Task 3), `getCurrentVersion`(Task 2), `relaunchApp`. i18n `update.*` 키(Task 4).
- Produces: `UpdateSettingsSection()` — 자체 `useUpdater` 인스턴스로 수동 확인 흐름을 렌더(스로틀·dismissed 무시). SettingsPanel에서 `<UpdateSettingsSection />`로 사용.

- [ ] **Step 1: 실패 테스트 작성**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import { UpdateSettingsSection } from "./UpdateSettingsSection";

vi.mock("../lib/updater", () => ({
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  relaunchApp: vi.fn(),
  getCurrentVersion: vi.fn().mockResolvedValue("1.0.4"),
}));
vi.mock("../lib/updater-store", () => ({ setDismissedVersion: vi.fn() }));

import { checkForUpdate } from "../lib/updater";

beforeEach(() => vi.clearAllMocks());

describe("UpdateSettingsSection", () => {
  it("shows the current version", async () => {
    render(<UpdateSettingsSection />);
    await waitFor(() => expect(screen.getByText(/1\.0\.4/)).toBeInTheDocument());
  });

  it("says up to date when no update", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<UpdateSettingsSection />);
    screen.getByRole("button", { name: "업데이트 확인" }).click();
    await waitFor(() =>
      expect(screen.getByText("최신 버전을 사용 중입니다.")).toBeInTheDocument()
    );
  });

  it("shows an update when available", async () => {
    (checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: "1.1.0", notes: "", update: {},
    });
    render(<UpdateSettingsSection />);
    screen.getByRole("button", { name: "업데이트 확인" }).click();
    await waitFor(() =>
      expect(screen.getByText(/업데이트가 있습니다 \(v1\.1\.0\)/)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "자동 업데이트" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/components/UpdateSettingsSection.test.tsx`
Expected: FAIL — `Cannot find module './UpdateSettingsSection'`.

- [ ] **Step 3: `UpdateSettingsSection.tsx` 구현**

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdater } from "../lib/useUpdater";
import { getCurrentVersion } from "../lib/updater";

export function UpdateSettingsSection() {
  const { t } = useTranslation();
  const { state, check, install, relaunch } = useUpdater();
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    getCurrentVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  return (
    <div className="settings-update">
      <div className="settings-update__current">
        {version && t("update.current", { version })}
      </div>

      <button
        className="settings-update__check"
        onClick={() => check()}
        disabled={state.kind === "checking" || state.kind === "downloading"}
      >
        {state.kind === "checking" ? t("update.checking") : t("update.check")}
      </button>

      <div className="settings-update__status" role="status">
        {state.kind === "upToDate" && <span>{t("update.upToDate")}</span>}

        {state.kind === "available" && (
          <>
            <span>{t("update.hasUpdate", { version: state.info.version })}</span>
            <button className="settings-update__install" onClick={() => install()}>
              {t("update.install")}
            </button>
          </>
        )}

        {state.kind === "downloading" && (
          <progress
            role="progressbar"
            aria-valuenow={state.fraction >= 0 ? Math.round(state.fraction * 100) : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            value={state.fraction >= 0 ? state.fraction : undefined}
          />
        )}

        {state.kind === "installed" && (
          <>
            <span>{t("update.installed")}</span>
            <button className="settings-update__install" onClick={() => relaunch()}>
              {t("update.restart")}
            </button>
          </>
        )}

        {state.kind === "error" && <span>{t("update.error")}: {state.message}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/components/UpdateSettingsSection.test.tsx`
Expected: PASS (전부).

- [ ] **Step 5: SettingsPanel에 섹션 삽입**

`src/components/SettingsPanel.tsx` 상단 import에 추가:
```tsx
import { UpdateSettingsSection } from "./UpdateSettingsSection";
```
그리고 interval `<label>` 블록과 close 버튼 사이에 삽입:
```tsx
      </label>
      <UpdateSettingsSection />
      <button className="settings-panel__close" aria-label={t("app.close")} onClick={onClose}>×</button>
```

- [ ] **Step 6: 기존 SettingsPanel 테스트 회귀 확인**

Run: `npx vitest run src/components/SettingsPanel.test.tsx src/components/UpdateSettingsSection.test.tsx`
Expected: PASS. (SettingsPanel.test는 `../lib/updater`를 모킹하지 않으므로, 만약 실제 IPC 접근으로 깨지면 SettingsPanel.test.tsx 상단에 Step 1과 동일한 `vi.mock("../lib/updater", ...)`/`vi.mock("../lib/updater-store", ...)`를 추가한다.)

- [ ] **Step 7: Commit**

```bash
git add src/components/UpdateSettingsSection.tsx src/components/UpdateSettingsSection.test.tsx src/components/SettingsPanel.tsx
git commit -m "feat(update): add manual update section to settings (#47)"
```

---

### Task 6: App 시작 시 자동 확인·팝업 배선

**Files:**
- Modify: `src/App.tsx` (훅 사용, 시작 effect, `UpdateDialog` 렌더)
- Test: `src/App.test.tsx` (자동 확인 동작)

**Interfaces:**
- Consumes: `useUpdater`(Task 3), `UpdateDialog`(Task 4), `shouldAutoCheck`/`shouldPrompt`/`getLastCheckAt`/`setLastCheckAt`/`getDismissedVersion`(Task 2).
- Produces: 없음 (최종 통합).

- [ ] **Step 1: 기존 App.test.tsx의 모킹 방식 확인**

Run: `sed -n '1,40p' src/App.test.tsx`
목적: 기존 `vi.mock` 대상(`./lib/usage`, `./lib/settings` 등)을 파악해, 아래 추가 모킹이 충돌하지 않도록 한다.

- [ ] **Step 2: 자동 확인 실패 테스트 작성**

`src/App.test.tsx`에 아래 테스트를 추가한다. 파일 상단에 이미 다른 `vi.mock`이 있으면 그 옆에 이어서 둔다. (`./lib/updater`, `./lib/updater-store`를 모킹.)
```tsx
vi.mock("./lib/updater", () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
  installUpdate: vi.fn(),
  relaunchApp: vi.fn(),
  getCurrentVersion: vi.fn().mockResolvedValue("1.0.4"),
}));
vi.mock("./lib/updater-store", async () => {
  const actual = await vi.importActual<typeof import("./lib/updater-store")>("./lib/updater-store");
  return actual; // 실제 localStorage 로직 사용
});

import { checkForUpdate } from "./lib/updater";

describe("auto update check", () => {
  beforeEach(() => localStorage.clear());

  it("checks for updates on mount when never checked", async () => {
    render(<App />);
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalled());
  });

  it("skips the check within 24h of the last check", async () => {
    localStorage.setItem("updater.lastCheckAt", String(Date.now()));
    render(<App />);
    // 짧게 대기 후에도 호출되지 않아야 한다.
    await new Promise((r) => setTimeout(r, 50));
    expect(checkForUpdate).not.toHaveBeenCalled();
  });
});
```
(이미 `render`, `waitFor`, `App`, `describe`, `it`, `vi`, `beforeEach`가 import되어 있다고 가정한다. 없으면 상단 import에 추가한다.)

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/App.test.tsx -t "auto update check"`
Expected: FAIL (App이 아직 `checkForUpdate`를 부르지 않음).

- [ ] **Step 4: App.tsx 배선 구현**

상단 import 블록에 추가:
```tsx
import { useUpdater } from "./lib/useUpdater";
import { UpdateDialog } from "./components/UpdateDialog";
import {
  shouldAutoCheck,
  shouldPrompt,
  getLastCheckAt,
  setLastCheckAt,
  getDismissedVersion,
} from "./lib/updater-store";
```

컴포넌트 본문 상단(다른 `useState`들 근처)에 훅 추가:
```tsx
  const updater = useUpdater();
```

새 `useEffect` 추가 (초기 로드 effect 근처, 의존성 배열은 `[]` — 마운트 1회):
```tsx
  // 하루 1회 자동 업데이트 확인. 결과와 무관하게 확인 시각을 기록한다.
  useEffect(() => {
    if (!shouldAutoCheck(Date.now(), getLastCheckAt())) return;
    updater.check().finally(() => setLastCheckAt(Date.now()));
    // updater.check는 안정적인 useCallback이라 마운트 시 1회만 실행하면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

렌더 트리 최상단(반환 JSX의 루트 요소 안 첫 자식)에 다이얼로그 추가. 단, 자동 팝업은 `dismissedVersion`과 다를 때만 노출한다:
```tsx
      {(() => {
        const s = updater.state;
        const suppressed =
          s.kind === "available" && !shouldPrompt(s.info.version, getDismissedVersion());
        return suppressed ? null : (
          <UpdateDialog
            state={s}
            onInstall={updater.install}
            onDismiss={updater.dismiss}
            onRelaunch={updater.relaunch}
          />
        );
      })()}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS (신규 + 기존 전부).

- [ ] **Step 6: 전체 테스트 스위트 + 빌드**

Run:
```bash
npm test
npm run build
```
Expected: 모든 테스트 PASS, 빌드 성공.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(update): auto-check on startup and show update dialog (#47)"
```

---

### Task 7: 릴리스 CI 서명·latest.json + 문서화

**Files:**
- Modify: `.github/workflows/release.yml` (서명 env + updater json)
- Modify: `README.md` (자동 업데이트 섹션 + 한계 + 유지관리자 셋업)

**Interfaces:**
- Consumes: Task 1에서 생성한 공개키(config에 반영됨), 개인키/비밀번호(Secrets).
- Produces: 없음 (배포 파이프라인).

- [ ] **Step 1: GitHub Secrets 등록 안내 (유지관리자가 수행)**

아래 두 Secret을 저장소에 등록한다 (Task 1 Step 1의 값):
```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < "$HOME/.tauri/token-usage-app.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # 프롬프트에 비밀번호 입력(없으면 빈 값)
```
Expected: `gh secret list`에 두 항목이 보인다.

- [ ] **Step 2: release.yml에 서명 env와 updater json 추가**

`.github/workflows/release.yml`의 `Build and release Tauri app` 스텝을 아래로 교체:
```yaml
      - name: Build and release Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'token-usage-app v__VERSION__'
          releaseBody: ${{ steps.changelog.outputs.notes }}
          releaseDraft: true
          prerelease: false
          includeUpdaterJson: true
          args: ${{ matrix.args }}
```

- [ ] **Step 3: YAML 유효성 확인**

Run: `npx --yes js-yaml .github/workflows/release.yml >/dev/null && echo OK`
Expected: `OK` (파싱 에러 없음).

- [ ] **Step 4: README에 자동 업데이트 섹션 추가**

`README.md` 끝에 추가:
```markdown
## 자동 업데이트

앱은 시작 시 하루 1회 최신 버전을 확인하고, 새 버전이 있으면 팝업으로 안내합니다.
`[자동 업데이트]`를 누르면 내려받아 설치 후 재시작하고, `[다음에 하기]`를 누르면 해당
버전은 다시 묻지 않습니다. 설정 화면에서 **현재 버전 확인**과 **수동 업데이트 확인**도
가능합니다.

### 유지관리자 셋업 (최초 1회)

1. 서명 키페어 생성: `npm run tauri signer generate -- -w ~/.tauri/token-usage-app.key`
2. 출력된 **Public key**를 `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에 반영.
3. GitHub Secrets 등록:
   - `TAURI_SIGNING_PRIVATE_KEY` = 개인키 파일 내용
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = 개인키 비밀번호
4. `v*` 태그를 push하면 CI가 서명된 설치 파일과 `latest.json`을 Draft 릴리스에 올립니다.
   내용을 확인한 뒤 릴리스를 **Publish**하면 사용자에게 업데이트가 배포됩니다.

### 한계

- **Linux**: AppImage만 자동 업데이트를 지원합니다. `.deb`/`.rpm` 사용자는 릴리스
  페이지에서 수동으로 새 버전을 내려받아야 합니다.
- **OS 코드서명 미적용**: 설치·실행 시 Windows SmartScreen 또는 macOS Gatekeeper 경고가
  나타날 수 있습니다. 이는 업데이트 서명(minisign)과는 별개이며 자동 업데이트 동작에는
  영향을 주지 않습니다. OS 코드서명은 별도 이슈로 다룹니다.
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml README.md
git commit -m "ci(update): sign updater artifacts and publish latest.json (#47)"
```

---

## Self-Review

**1. Spec coverage:**
- 자동 업데이트 팝업(버튼 2개) → Task 4(UpdateDialog) + Task 6(시작 배선). ✅
- 하루 1회 확인 → Task 2(`shouldAutoCheck`) + Task 6. ✅
- "다음에 하기" = 이 버전 무시 → Task 2(`shouldPrompt`/`setDismissedVersion`) + Task 3(dismiss) + Task 6(suppress). ✅
- 설정: 현재 버전 표시 → Task 5. ✅
- 설정: 업데이트 확인 버튼 → Task 5. ✅
- 설정: "최신 버전 사용 중" / "업데이트 하시겠습니까" → Task 5(`upToDate`/`hasUpdate`+install). ✅
- 엔드포인트/서명/CI → Task 1 + Task 7. ✅
- Linux·OS서명 한계 문서화 → Task 7. ✅

**2. Placeholder scan:** `PASTE_PUBLIC_KEY_HERE`는 엔지니어가 Step 1 생성값으로 교체하는 실제 값 자리(플랜 결함 아님, 명령·위치 명시됨). 그 외 TBD/TODO/모호 지시 없음. ✅

**3. Type consistency:**
- `UpdateInfo = { version, notes, update }` — Task 2 정의, Task 3/4/5에서 동일 사용. ✅
- `UpdaterState` 유니온 — Task 3 정의, Task 4(UpdateDialog)·Task 5·Task 6에서 동일 `kind` 값(`idle|checking|upToDate|available|downloading|installed|error`) 사용. ✅
- `useUpdater()` 반환 `{ state, check, install, dismiss, relaunch }` — Task 5/6 사용 일치. ✅
- `installUpdate(info, onProgress: (fraction) => void)` — Task 2 정의, Task 3 사용 일치(0..1, 불명 시 -1). ✅
- i18n `update.*` 키 — Task 4에서 추가, Task 5에서 소비하는 키(`current/check/checking/upToDate/hasUpdate/install/installed/restart/error`) 모두 존재. ✅
