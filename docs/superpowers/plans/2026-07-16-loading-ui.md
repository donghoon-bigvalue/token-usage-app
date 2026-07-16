# 로딩 UI 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `…`·빈 화면·`—`로 표현되던 로딩을, 콜드 로드는 shimmer 스켈레톤으로 새로고침은 버튼 인라인 스피너로 교체한다.

**Architecture:** 두 개의 순수 프레젠테이션 프리미티브(`Skeleton`, `Spinner`)를 만들고, 기존 컴포넌트의 클래스·치수를 그대로 흉내낸 스켈레톤을 조합한다. "화면에 내용이 있는가"로 표현을 가른다 — 없으면 스켈레톤, 있으면 기존 내용 유지 + 버튼 스피너. 로딩 상태가 영원히 끝나지 않는 경로(fetch 실패)를 함께 막는다.

**Tech Stack:** React 19, TypeScript, 순수 CSS(애니메이션 라이브러리 없음), react-i18next, vitest + @testing-library/react

**설계 문서:** `docs/superpowers/specs/2026-07-16-loading-ui-design.md`

## Global Constraints

- **새 색 토큰 금지** — 기존 `--track` / `--card` / `--muted` / `--border` 변수만 사용한다. 라이트·다크는 이 변수들로 자동 대응된다.
- **애니메이션 라이브러리 도입 금지** — 순수 CSS `@keyframes`만 사용한다.
- **`src/lib/format.ts`를 수정하지 않는다** — `formatUsd(null)` → `—`는 로딩이 아니라 "값이 영영 없음"이다 (설계 §3.1).
- **아이콘을 넣는 버튼은 라벨을 반드시 별도 `<span>`으로 감싼다** — `getByText`는 `textContent` 전체와 비교하므로, 감싸지 않으면 기존 테스트가 깨진다 (설계 §10).
- **기존 테스트를 수정하지 않는다** — `App.test.tsx`·`UsageHistoryView.test.tsx`의 기존 `it(...)` 블록은 한 줄도 고치지 않고 통과해야 한다. 유일한 예외는 Task 2의 mock 셋업 리팩터링(테스트 인프라이며, 기존 단언은 그대로).
- **i18n 키는 ko·en 양쪽에 추가한다** — 한쪽만 추가하면 다른 언어에서 키 문자열이 그대로 노출된다.
- **모든 스켈레톤 블록은 `aria-hidden="true"`**, 컨테이너에만 `role="status"`를 둔다. 스켈레톤 하나하나가 status면 스크린리더가 "로딩 중"을 여러 번 읽는다.
- **행 번호는 원본 파일 기준 힌트일 뿐이다.** 앞선 태스크가 같은 파일을 이미 고쳤다면 어긋난다 (`Header.tsx`·`App.tsx`·`UsageHistoryView.tsx`는 여러 태스크가 건드린다). 항상 **내용으로 찾아** 교체하고, 행 번호와 실제가 다르면 내용을 따른다.

**테스트 실행:** `npx vitest run <파일> -t "<테스트 이름>"` / 전체: `npm test`

---

### Task 1: Skeleton·Spinner 프리미티브와 CSS

shimmer 블록과 회전 아이콘, 그리고 이 둘의 CSS. 이후 모든 태스크가 여기에 의존한다.

**Files:**
- Create: `src/components/Skeleton.tsx`
- Create: `src/components/Spinner.tsx`
- Create: `src/components/Skeleton.test.tsx`
- Modify: `src/styles/theme.css` (파일 끝에 추가, `.history-loading` 삭제)
- Modify: `src/locales/ko.json:2` (`app` 객체)
- Modify: `src/locales/en.json:2` (`app` 객체)
- Modify: `src/i18n.test.ts` (신규 `it` 2개)

**Interfaces:**
- Consumes: 없음 (기반 태스크)
- Produces:
  - `Skeleton({ width: string; height?: number; radius?: number })` — `height` 기본 12, `radius` 기본 999
  - `Spinner({ spinning: boolean })` — 항상 렌더되며 `spinning`일 때만 회전 (폭 고정 → 레이아웃 시프트 없음)
  - i18n 키 `app.loading`, `app.loadFailed`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/Skeleton.test.tsx` 생성:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./Skeleton";
import { Spinner } from "./Spinner";

describe("Skeleton", () => {
  it("is decorative — the container carries the loading announcement", () => {
    const { container } = render(<Skeleton width="80px" />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("skeleton");
  });

  it("applies the given dimensions", () => {
    const { container } = render(<Skeleton width="50%" height={8} radius={4} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("50%");
    expect(el.style.height).toBe("8px");
    expect(el.style.borderRadius).toBe("4px");
  });
});

describe("Spinner", () => {
  it("renders whether or not it is spinning, so the button width never shifts", () => {
    const { rerender, container } = render(<Spinner spinning={false} />);
    const el = () => container.firstChild as HTMLElement;
    expect(el().textContent).toBe("↻");
    expect(el().className).not.toContain("spinner--on");

    rerender(<Spinner spinning={true} />);
    expect(el().textContent).toBe("↻");
    expect(el().className).toContain("spinner--on");
  });

  it("is decorative — the button's own label carries the meaning", () => {
    const { container } = render(<Spinner spinning={true} />);
    expect((container.firstChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/components/Skeleton.test.tsx`
Expected: FAIL — `Failed to resolve import "./Skeleton"` (파일이 아직 없음)

- [ ] **Step 3: Skeleton 구현**

`src/components/Skeleton.tsx` 생성:

```tsx
/**
 * A shimmer placeholder block. Purely decorative — callers put `role="status"`
 * on the container so screen readers hear "loading" once, not once per block.
 */
export function Skeleton({
  width,
  height = 12,
  radius = 999,
}: {
  width: string;
  height?: number;
  radius?: number;
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius }}
    />
  );
}
```

- [ ] **Step 4: Spinner 구현**

`src/components/Spinner.tsx` 생성:

```tsx
/**
 * Always rendered, spinning or not — swapping it in and out would change the
 * button's width mid-click.
 */
export function Spinner({ spinning }: { spinning: boolean }) {
  return (
    <span className={`spinner${spinning ? " spinner--on" : ""}`} aria-hidden="true">
      ↻
    </span>
  );
}
```

- [ ] **Step 5: CSS 추가**

`src/styles/theme.css`에서 `.history-loading` 줄(146행)을 **삭제**하고, 파일 끝에 추가:

```css
/* Loading — cold loads get a skeleton, in-flight refreshes get a button spinner.
   Both are built from --track/--card so light and dark follow for free. */
.skeleton {
  display: inline-block;
  background: linear-gradient(90deg, var(--track) 25%, var(--card) 50%, var(--track) 75%);
  background-size: 200% 100%;
  animation: skeleton-sweep 1.6s linear infinite;
}
@keyframes skeleton-sweep {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}

.spinner { display: inline-block; margin-right: 4px; }
.spinner--on { animation: spinner-rotate .8s linear infinite; }
@keyframes spinner-rotate {
  to { transform: rotate(360deg); }
}

/* Motion here is the whole point (a static block reads as "frozen"), but a
   reader who asked for no motion gets the static block anyway. */
@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; background: var(--track); }
  .spinner--on { animation: none; }
}
```

- [ ] **Step 6: i18n 키 추가**

`src/locales/ko.json`의 `app` 객체(2행)에 `loading`·`loadFailed` 추가:

```json
  "app": { "title": "토큰 사용량", "refresh": "새로고침", "settings": "설정", "close": "닫기", "lastUpdated": "{{time}} 갱신", "cached": "캐시됨", "loading": "불러오는 중", "loadFailed": "사용량을 불러오지 못했어요" },
```

`src/locales/en.json`의 `app` 객체(2행):

```json
  "app": { "title": "Token Usage", "refresh": "Refresh", "settings": "Settings", "close": "Close", "lastUpdated": "Updated {{time}}", "cached": "cached", "loading": "Loading", "loadFailed": "Couldn't load usage" },
```

- [ ] **Step 7: i18n 키 테스트 추가**

키를 한쪽 로케일에만 넣으면 다른 언어에서 `app.loading`이 날것으로 노출된다. `src/i18n.test.ts`의 `describe` 안에 추가:

```ts
  it("has loading keys in both locales", () => {
    expect(i18n.getFixedT("en")("app.loading")).toBe("Loading");
    expect(i18n.getFixedT("ko")("app.loading")).toBe("불러오는 중");
  });
  it("has load-failure keys in both locales", () => {
    expect(i18n.getFixedT("en")("app.loadFailed")).toBe("Couldn't load usage");
    expect(i18n.getFixedT("ko")("app.loadFailed")).toBe("사용량을 불러오지 못했어요");
  });
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npx vitest run src/components/Skeleton.test.tsx src/i18n.test.ts`
Expected: PASS (8 tests — Skeleton/Spinner 4 + i18n 기존 2 + 신규 2)

- [ ] **Step 9: 회귀 확인**

Run: `npm test`
Expected: 기존 테스트 전부 PASS (`.history-loading`은 CSS일 뿐이라 아직 `…`를 렌더하는 코드는 그대로 — 이 시점에는 스타일 없는 `…`가 잠깐 존재하며 Task 3에서 제거된다)

- [ ] **Step 10: 커밋**

```bash
git add src/components/Skeleton.tsx src/components/Spinner.tsx src/components/Skeleton.test.tsx src/styles/theme.css src/locales/ko.json src/locales/en.json src/i18n.test.ts
git commit -m "feat(ui): shimmer 스켈레톤·스피너 프리미티브 추가 (#23)"
```

---

### Task 2: 한도 탭 콜드 로드 — 스켈레톤과 무한 shimmer 차단

빈 화면을 스켈레톤으로 교체하되, **같은 커밋에서** fetch 실패 경로를 막는다. 스켈레톤만 넣고 오류 처리를 미루면 실패 시 "영원히 반짝이는 화면"이 되어 현재보다 나쁘다 (설계 §6).

**Files:**
- Create: `src/components/ProviderCardSkeleton.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx` (mock 셋업만 — 기존 `it` 블록은 불변)
- Modify: `src/styles/theme.css` (`.history-error` → `.error-banner` 이름 변경)
- Modify: `src/components/UsageHistoryView.tsx:76,143,146` (클래스 이름 반영)

**Interfaces:**
- Consumes: `Skeleton` (Task 1), i18n `app.loading`·`app.loadFailed` (Task 1)
- Produces:
  - `ProviderCardSkeleton({ bars: number })` — `data-testid="provider-skeleton"`
  - CSS 클래스 `.error-banner` (구 `.history-error`)

- [ ] **Step 1: mock 셋업 리팩터링 (테스트 인프라)**

`vi.clearAllMocks()`는 호출 기록만 지우고 **구현은 남긴다**. 지금 구조에서 한 테스트가 `mockImplementation`으로 실패를 주입하면 그 구현이 이후 테스트로 새어나간다. 구현을 이름 있는 함수로 빼고 `beforeEach`에서 매번 다시 심는다.

`src/App.test.tsx:23-38`을 교체:

```tsx
// The mock factory is hoisted above the fixtures, so it can't close over them —
// the implementation is installed per-test in beforeEach instead. That also
// keeps a failure injected by one test from leaking into the next, which
// clearAllMocks does not prevent (it clears calls, not implementations).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(() => Promise.resolve(null)) }));

import App from "./App";
import { invoke } from "@tauri-apps/api/core";

function defaultInvoke(cmd: string) {
  if (cmd === "get_usage") return Promise.resolve(report);
  if (cmd === "get_settings") return Promise.resolve(settings);
  if (cmd === "set_settings") return Promise.resolve(settings);
  if (cmd === "get_usage_history") return Promise.resolve(history);
  return Promise.resolve(null);
}

const invoked = (cmd: string) => vi.mocked(invoke).mock.calls.filter((c) => c[0] === cmd);
```

그리고 `src/App.test.tsx:41`의 `beforeEach`를 교체:

```tsx
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(defaultInvoke as never);
  });
```

- [ ] **Step 2: 회귀 확인 — 리팩터링이 아무것도 깨지 않았는지**

Run: `npx vitest run src/App.test.tsx`
Expected: 기존 5개 테스트 전부 PASS (동작 변경 없음, 구현 주입 위치만 이동)

- [ ] **Step 3: 커밋 (리팩터링 분리)**

```bash
git add src/App.test.tsx
git commit -m "test(app): invoke 구현을 beforeEach로 옮겨 테스트 간 누수 차단 (#23)"
```

- [ ] **Step 4: 실패하는 테스트 작성**

`src/App.test.tsx`의 `describe("App", ...)` 안, 마지막 `it` 뒤에 추가:

```tsx
  it("shows a skeleton — not a blank screen — while the first load is in flight", async () => {
    let release!: (r: typeof report) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage"
        ? new Promise((res) => { release = res as (r: typeof report) => void; })
        : defaultInvoke(cmd)) as never);

    render(<App />);

    // Two cards' worth of skeleton, matching the real layout.
    expect(screen.getAllByTestId("provider-skeleton")).toHaveLength(2);
    expect(screen.getByRole("status")).toBeInTheDocument();

    release(report);
    await screen.findByText("Max 20x");
    expect(screen.queryByTestId("provider-skeleton")).toBeNull();
  });

  it("reports a failed first load instead of shimmering forever", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.reject(new Error("claude cli missing")) : defaultInvoke(cmd)) as never);

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("claude cli missing");
    // The whole point: a skeleton that never resolves is worse than the blank
    // screen it replaced.
    expect(screen.queryByTestId("provider-skeleton")).toBeNull();
  });
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `npx vitest run src/App.test.tsx -t "shimmering forever"`
Expected: FAIL — `Unable to find role="alert"` (App에 오류 처리가 없음)

- [ ] **Step 6: ProviderCardSkeleton 구현**

`src/components/ProviderCardSkeleton.tsx` 생성:

```tsx
import { Skeleton } from "./Skeleton";

/**
 * Mirrors ProviderCard's classes and dimensions so the real card drops in
 * without moving anything. `bars` differs per provider — Claude has 3 windows,
 * Codex 2 — and a wrong count would shift the layout on arrival, which is the
 * one thing a skeleton exists to prevent.
 */
export function ProviderCardSkeleton({ bars }: { bars: number }) {
  return (
    <section className="provider-card" data-testid="provider-skeleton" aria-hidden="true">
      <header className="provider-card__head">
        <Skeleton width="84px" height={16} radius={6} />
        <Skeleton width="52px" height={18} />
      </header>
      <div className="provider-card__bars">
        {Array.from({ length: bars }, (_, i) => (
          <div className="limit-bar" key={i}>
            <div className="limit-bar__row">
              <Skeleton width="112px" height={12} radius={4} />
              <Skeleton width="32px" height={12} radius={4} />
            </div>
            <div className="limit-bar__track">
              <Skeleton width="100%" height={8} />
            </div>
            <div className="limit-bar__reset">
              <Skeleton width="96px" height={10} radius={4} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 7: App에 스켈레톤·오류 상태 배선**

`src/App.tsx`를 수정한다.

임포트에 추가 (`src/App.tsx:1-11` 구역):

```tsx
import { ProviderCardSkeleton } from "./components/ProviderCardSkeleton";
```

`useTranslation()` 호출(14행)에서 `t`도 꺼낸다:

```tsx
  const { t, i18n } = useTranslation();
```

상태 추가 (16행 `settings` 상태 옆):

```tsx
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
```

`applyReport`(28-30행) 아래에 로더를 추가한다:

```tsx
  // The one place limits are fetched — a rejection here used to vanish, leaving
  // the card area blank forever. Now it resolves the loading state instead.
  const load = useCallback(
    () =>
      fetchUsage()
        .then((r) => { applyReport(r); setLoadFailed(null); })
        .catch((e) => setLoadFailed(e instanceof Error ? e.message : String(e))),
    [applyReport]
  );
```

초기 로드 effect(39행)의 `fetchUsage().then(applyReport);`를 교체:

```tsx
    load();
```

그리고 그 effect의 의존성 배열(42행)을 교체:

```tsx
  }, [i18n, applyReport, load]);
```

`refresh` 콜백(50-53행)의 `else` 분기를 교체:

```tsx
    else load();
```

의존성 배열도:

```tsx
  }, [view, load]);
```

렌더의 `view === "limits"` 분기(77-83행)를 교체:

```tsx
      {view === "limits" ? (
        report ? (
          <div className="app__cards">
            <ProviderCard snapshot={report.claude} now={now} locale={locale} />
            <ProviderCard snapshot={report.codex} now={now} locale={locale} />
          </div>
        ) : loadFailed ? (
          <p className="error-banner" role="alert">{t("app.loadFailed")}: {loadFailed}</p>
        ) : (
          <div className="app__cards" role="status" aria-label={t("app.loading")}>
            <ProviderCardSkeleton bars={3} />
            <ProviderCardSkeleton bars={2} />
          </div>
        )
      ) : (
```

- [ ] **Step 8: `.history-error` → `.error-banner` 이름 변경**

App이 같은 배너를 쓰는데 클래스 이름이 `history-`면 거짓말이다. `src/styles/theme.css:148`의 선택자를 교체:

```css
.error-banner {
```

`src/components/UsageHistoryView.tsx`의 3곳(76·143·146행)에서 `className="history-error"` → `className="error-banner"`.

- [ ] **Step 9: 테스트 통과 확인**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS (7 tests — 기존 5 + 신규 2)

- [ ] **Step 10: 전체 회귀 확인**

Run: `npm test`
Expected: 전부 PASS

- [ ] **Step 11: 커밋**

```bash
git add src/components/ProviderCardSkeleton.tsx src/App.tsx src/App.test.tsx src/styles/theme.css src/components/UsageHistoryView.tsx
git commit -m "feat(ui): 한도 탭 콜드 로드 스켈레톤 + 로드 실패 표시 (#23)"
```

---

### Task 3: 이력 탭 콜드 로드 스켈레톤

`…` 한 글자를 테이블 형태의 스켈레톤으로 교체한다.

**Files:**
- Create: `src/components/HistorySkeleton.tsx`
- Modify: `src/components/UsageHistoryView.tsx:73`
- Modify: `src/components/UsageHistoryView.test.tsx` (신규 `it` 2개)
- Modify: `src/styles/theme.css` (`.history-skeleton__rows` 추가)

**Interfaces:**
- Consumes: `Skeleton` (Task 1), i18n `app.loading` (Task 1)
- Produces: `HistorySkeleton()` — `data-testid="history-skeleton"`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/UsageHistoryView.test.tsx`의 `describe` 안 마지막에 추가:

```tsx
  it("shows a table-shaped skeleton on a cold load, not an ellipsis", async () => {
    let release!: (h: typeof HISTORY) => void;
    getUsageHistory.mockReturnValue(new Promise((res) => { release = res; }));

    render(<UsageHistoryView />);

    expect(screen.getByTestId("history-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("…")).toBeNull();

    release(HISTORY);
    await screen.findByText("Download Excel");
    expect(screen.queryByTestId("history-skeleton")).toBeNull();
  });

  it("keeps the table on screen during a refresh instead of falling back to the skeleton", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    const { rerender } = render(<UsageHistoryView refreshSignal={0} />);
    await screen.findByText("Download Excel");

    let release!: (h: typeof HISTORY) => void;
    getUsageHistory.mockReturnValue(new Promise((res) => { release = res; }));
    rerender(<UsageHistoryView refreshSignal={1} />);

    // Data the user has already read must not revert to grey blocks.
    expect(screen.queryByTestId("history-skeleton")).toBeNull();
    expect(screen.getAllByText("2026-07").length).toBeGreaterThan(0);

    release(HISTORY);
    await waitFor(() => expect(getUsageHistory).toHaveBeenCalledTimes(2));
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/components/UsageHistoryView.test.tsx -t "table-shaped skeleton"`
Expected: FAIL — `Unable to find an element by: [data-testid="history-skeleton"]`

> 두 번째 테스트("keeps the table…")는 기존 `if (!isRefresh) setLoading(true)` 로직 덕에 구현 없이도 통과한다. 이것은 회귀 방어용이다 — 스켈레톤을 도입하면서 이 분기를 무심코 지우면 즉시 잡힌다.

- [ ] **Step 3: HistorySkeleton 구현**

`src/components/HistorySkeleton.tsx` 생성:

```tsx
import { Skeleton } from "./Skeleton";

/**
 * Mirrors UsageHistoryView's loaded shape: the "this month" heading and two
 * cards, the estimate note, then table rows. Five rows is a plausible history —
 * enough to read as a table, few enough not to overstate what's coming.
 */
export function HistorySkeleton() {
  return (
    <div className="history-view" data-testid="history-skeleton" aria-hidden="true">
      <section className="history-current">
        <Skeleton width="64px" height={15} radius={4} />
        <div className="history-cards">
          {[0, 1].map((i) => (
            <div className="history-card" key={i}>
              <Skeleton width="52px" height={13} radius={4} />
              <Skeleton width="88px" height={13} radius={4} />
              <Skeleton width="72px" height={18} radius={4} />
            </div>
          ))}
        </div>
      </section>
      <Skeleton width="70%" height={12} radius={4} />
      <div className="history-skeleton__rows">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} width="100%" height={28} radius={6} />
        ))}
      </div>
    </div>
  );
}
```

> `.history-current h2`가 `margin: 0 0 8px`을 주므로 제목 자리의 Skeleton은 그 여백을 못 받는다. `.history-cards`가 `display:flex`라 카드 간격은 유지된다. 시각 확인은 Task 6의 Step 5에서 한다.

- [ ] **Step 4: 테이블 행 간격 CSS 추가**

`src/styles/theme.css`의 `.spinner--on` 규칙 아래(reduced-motion 미디어쿼리 **위**)에 추가:

```css
.history-skeleton__rows { display: flex; flex-direction: column; gap: 6px; }
```

- [ ] **Step 5: UsageHistoryView 배선**

`src/components/UsageHistoryView.tsx`의 임포트에 추가:

```tsx
import { HistorySkeleton } from "./HistorySkeleton";
```

73행을 교체:

```tsx
  if (loading) {
    return (
      <div role="status" aria-label={t("app.loading")}>
        <HistorySkeleton />
      </div>
    );
  }
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run src/components/UsageHistoryView.test.tsx`
Expected: PASS (12 tests — 기존 10 + 신규 2)

- [ ] **Step 7: 커밋**

```bash
git add src/components/HistorySkeleton.tsx src/components/UsageHistoryView.tsx src/components/UsageHistoryView.test.tsx src/styles/theme.css
git commit -m "feat(ui): 이력 탭 콜드 로드 스켈레톤으로 … 교체 (#23)"
```

---

### Task 4: 새로고침 버튼 스피너

누른 버튼이 반응하게 한다. 자동 갱신(푸시 이벤트)에는 붙이지 않는다 — 시작 시점을 알 수 없기 때문이다 (설계 §2.2).

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/UsageHistoryView.tsx`
- Modify: `src/App.test.tsx` (신규 `it` 추가)
- Modify: `src/components/UsageHistoryView.test.tsx` (신규 `it` 추가)

**Interfaces:**
- Consumes: `Spinner` (Task 1), App의 `load()`·`view` (Task 2)
- Produces:
  - `Header`에 `refreshing: boolean` prop
  - `UsageHistoryView`에 `onLoadingChange?: (busy: boolean) => void` — **모든** 로드에서 발화 (콜드 + 새로고침)
  - App의 `historyBusy` 상태 — Task 5가 헤더 shimmer에 재사용한다

- [ ] **Step 1: 실패하는 테스트 작성 (UsageHistoryView)**

`src/components/UsageHistoryView.test.tsx`의 `describe` 안 마지막에 추가:

```tsx
  it("reports load progress for both cold loads and refreshes", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    const onLoadingChange = vi.fn();
    const { rerender } = render(<UsageHistoryView refreshSignal={0} onLoadingChange={onLoadingChange} />);

    await waitFor(() => expect(onLoadingChange).toHaveBeenLastCalledWith(false));
    expect(onLoadingChange.mock.calls.map((c) => c[0])).toEqual([true, false]);

    rerender(<UsageHistoryView refreshSignal={1} onLoadingChange={onLoadingChange} />);
    await waitFor(() => expect(onLoadingChange.mock.calls.map((c) => c[0])).toEqual([true, false, true, false]));
  });

  it("reports progress as finished when a scan fails, so the caller can stop spinning", async () => {
    getUsageHistory.mockRejectedValue("scan failed");
    const onLoadingChange = vi.fn();
    render(<UsageHistoryView onLoadingChange={onLoadingChange} />);

    await screen.findByRole("alert");
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps reporting busy when a superseded scan resolves after a newer one started", async () => {
    let releaseFirst!: (h: typeof HISTORY) => void;
    getUsageHistory.mockReturnValueOnce(new Promise((res) => { releaseFirst = res; }));
    const onLoadingChange = vi.fn();
    const { rerender } = render(<UsageHistoryView refreshSignal={0} onLoadingChange={onLoadingChange} />);

    // A second scan starts while the first is still in flight.
    let releaseSecond!: (h: typeof HISTORY) => void;
    getUsageHistory.mockReturnValueOnce(new Promise((res) => { releaseSecond = res; }));
    rerender(<UsageHistoryView refreshSignal={1} onLoadingChange={onLoadingChange} />);

    // Drain the stale scan's whole .then/.catch/.finally chain before asserting,
    // so the assertion tests the guard rather than microtask timing.
    await act(async () => { releaseFirst(HISTORY); });
    // The stale scan must not clear the flag — scan two is still running.
    expect(onLoadingChange).toHaveBeenLastCalledWith(true);

    await act(async () => { releaseSecond(HISTORY); });
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });

  it("goes silent after unmount — a dead scan must not speak for a live one", async () => {
    let release!: (h: typeof HISTORY) => void;
    getUsageHistory.mockReturnValue(new Promise((res) => { release = res; }));
    const onLoadingChange = vi.fn();
    const { unmount } = render(<UsageHistoryView onLoadingChange={onLoadingChange} />);
    await waitFor(() => expect(onLoadingChange).toHaveBeenCalledWith(true));

    // The user switches tabs mid-scan; App owns the flag and clears it itself.
    unmount();
    onLoadingChange.mockClear();
    await act(async () => { release(HISTORY); });

    expect(onLoadingChange).not.toHaveBeenCalled();
  });
```

> `act`를 `@testing-library/react` 임포트에 추가한다: `import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";`

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/components/UsageHistoryView.test.tsx -t "reports load progress"`
Expected: FAIL — `expected "spy" to be called with arguments: [ false ]` (콜백이 없음)

- [ ] **Step 3: UsageHistoryView에 진행 보고 추가**

`src/components/UsageHistoryView.tsx`의 props 타입(19-25행)에 추가:

```tsx
export default function UsageHistoryView({
  refreshSignal = 0,
  onScannedAt,
  onLoadingChange,
}: {
  refreshSignal?: number;
  onScannedAt?: (unixSeconds: number) => void;
  onLoadingChange?: (busy: boolean) => void;
}) {
```

`onScannedAtRef`(40-41행) 옆에 ref를 추가:

```tsx
  const onLoadingChangeRef = useRef(onLoadingChange);
  onLoadingChangeRef.current = onLoadingChange;
```

effect(43-59행)를 교체:

```tsx
  useEffect(() => {
    let alive = true;
    const isRefresh = refreshSignal !== seenSignal.current;
    seenSignal.current = refreshSignal;
    // A refresh keeps the old table on screen; only a cold mount blanks it.
    if (!isRefresh) setLoading(true);
    onLoadingChangeRef.current?.(true);
    getUsageHistory(isRefresh)
      .then((h) => {
        if (!alive) return;
        setHistory(h);
        setLoadError(null);
        onScannedAtRef.current?.(h.scanned_at);
      })
      .catch((e) => { if (alive) setLoadError(reason(e)); })
      .finally(() => {
        // Only a live run reports. A superseded run (cleanup already set alive
        // false) staying silent is what keeps back-to-back refreshes from
        // stopping the spinner early; App clears the flags when the tab closes,
        // so a dead mount never speaks for a live one.
        if (alive) {
          onLoadingChangeRef.current?.(false);
          setLoading(false);
        }
      });
    return () => { alive = false; };
  }, [refreshSignal]);
```

- [ ] **Step 4: UsageHistoryView 테스트 통과 확인**

Run: `npx vitest run src/components/UsageHistoryView.test.tsx`
Expected: PASS (15 tests — Task 3의 12 + 신규 3)

- [ ] **Step 5: 실패하는 테스트 작성 (App)**

`src/App.test.tsx`의 `describe` 안 마지막에 추가:

```tsx
  const refreshButton = () => screen.getByText("Refresh").closest("button")!;

  it("marks the refresh button busy while a limits refresh is in flight", async () => {
    render(<App />);
    await screen.findByText("Max 20x");
    expect(refreshButton().getAttribute("aria-busy")).toBe("false");

    let release!: (r: typeof report) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage"
        ? new Promise((res) => { release = res as (r: typeof report) => void; })
        : defaultInvoke(cmd)) as never);

    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("true"));
    // The cards stay — a refresh must not blank what the user is reading.
    expect(screen.getByText("Max 20x")).toBeInTheDocument();

    release(report);
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("false"));
  });

  it("stops the refresh button spinning when a limits refresh fails", async () => {
    render(<App />);
    await screen.findByText("Max 20x");

    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.reject(new Error("boom")) : defaultInvoke(cmd)) as never);

    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("false"));
  });

  it("does not spin the refresh button on a history cold load — the user never pressed it", async () => {
    render(<App />);
    await screen.findByText("Max 20x");

    let release!: (h: typeof history) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage_history"
        ? new Promise((res) => { release = res as (h: typeof history) => void; })
        : defaultInvoke(cmd)) as never);

    fireEvent.click(screen.getByText("Usage history"));

    // The skeleton already says "loading" — a button the user never pressed
    // must not respond.
    await screen.findByTestId("history-skeleton");
    expect(refreshButton().getAttribute("aria-busy")).toBe("false");

    release(history);
    await waitFor(() => expect(screen.queryByTestId("history-skeleton")).toBeNull());
  });

  it("spins the refresh button when the user refreshes the history tab", async () => {
    render(<App />);
    await screen.findByText("Max 20x");
    fireEvent.click(screen.getByText("Usage history"));
    await waitFor(() => expect(invoked("get_usage_history")).toHaveLength(1));

    let release!: (h: typeof history) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage_history"
        ? new Promise((res) => { release = res as (h: typeof history) => void; })
        : defaultInvoke(cmd)) as never);

    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("true"));

    release(history);
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("false"));
  });

  it("abandons a history refresh when the user leaves the tab mid-scan", async () => {
    render(<App />);
    await screen.findByText("Max 20x");
    fireEvent.click(screen.getByText("Usage history"));
    await waitFor(() => expect(invoked("get_usage_history")).toHaveLength(1));

    // Press refresh, then walk away before the scan finishes.
    let releaseStale!: (h: typeof history) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage_history"
        ? new Promise((res) => { releaseStale = res as (h: typeof history) => void; })
        : defaultInvoke(cmd)) as never);
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("true"));

    fireEvent.click(screen.getByText("Limits"));
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("false"));

    // Coming back is a cold load the user never asked for — the abandoned press
    // must not spin the button for it.
    let releaseFresh!: (h: typeof history) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage_history"
        ? new Promise((res) => { releaseFresh = res as (h: typeof history) => void; })
        : defaultInvoke(cmd)) as never);
    fireEvent.click(screen.getByText("Usage history"));
    await screen.findByTestId("history-skeleton");
    expect(refreshButton().getAttribute("aria-busy")).toBe("false");

    // The abandoned scan landing late must not stop the live one either.
    await act(async () => { releaseStale(history); });
    expect(screen.getByTestId("history-skeleton")).toBeInTheDocument();

    await act(async () => { releaseFresh(history); });
    await waitFor(() => expect(screen.queryByTestId("history-skeleton")).toBeNull());
  });
```

> `act`를 `App.test.tsx`의 `@testing-library/react` 임포트에 추가한다.

- [ ] **Step 6: 테스트 실패 확인**

Run: `npx vitest run src/App.test.tsx -t "marks the refresh button busy"`
Expected: FAIL — `expected null to be "false"` (`aria-busy`가 없음)

- [ ] **Step 7: Header에 스피너 배선**

`src/components/Header.tsx`의 임포트에 추가:

```tsx
import { Spinner } from "./Spinner";
```

props에 `refreshing` 추가 (3-17행 구역):

```tsx
export function Header({
  onRefresh,
  onOpenSettings,
  updatedAt,
  locale,
  view,
  onViewChange,
  refreshing,
}: {
  onRefresh: () => void;
  onOpenSettings: () => void;
  updatedAt: number | null;
  locale: "en" | "ko";
  view: "limits" | "history";
  onViewChange: (v: "limits" | "history") => void;
  refreshing: boolean;
}) {
```

새로고침 버튼(39행)을 교체한다. **라벨은 반드시 span 안에** — `getByText("Refresh")`는 `textContent` 전체와 비교하므로, 감싸지 않으면 버튼이 `"↻Refresh"`가 되어 기존 테스트 3개가 깨진다:

```tsx
        <button onClick={onRefresh} aria-busy={refreshing}>
          <Spinner spinning={refreshing} />
          <span>{t("app.refresh")}</span>
        </button>
```

- [ ] **Step 8: App에 진행 상태 배선**

`src/App.tsx`에 상태 추가 (`loadFailed` 옆):

```tsx
  const [limitsRefreshing, setLimitsRefreshing] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  // Only a press should spin the button; a cold load shows a skeleton instead.
  const [refreshPressed, setRefreshPressed] = useState(false);
```

`refresh` 콜백(50-53행)을 교체:

```tsx
  const refresh = useCallback(() => {
    if (view === "history") {
      setRefreshPressed(true);
      setHistoryRefresh((n) => n + 1);
    } else {
      setLimitsRefreshing(true);
      load().finally(() => setLimitsRefreshing(false));
    }
  }, [view, load]);
```

그 아래에 핸들러를 추가:

```tsx
  // Fires for cold loads too — App decides what it means. Task 5 reuses
  // historyBusy for the header's time placeholder.
  const handleHistoryLoading = useCallback((busy: boolean) => {
    setHistoryBusy(busy);
    if (!busy) setRefreshPressed(false);
  }, []);

  // Leaving the history tab unmounts the view mid-scan, and these flags are
  // ours, not its — without this a press abandoned by a tab switch stays
  // pending and spins the button on the next cold load, which the user never
  // pressed.
  useEffect(() => {
    if (view !== "history") {
      setHistoryBusy(false);
      setRefreshPressed(false);
    }
  }, [view]);
```

`Header`에 prop 전달 (66-73행 구역, `onViewChange` 다음 줄):

```tsx
        refreshing={view === "history" ? historyBusy && refreshPressed : limitsRefreshing}
```

`UsageHistoryView`에 prop 전달 (85행):

```tsx
        <UsageHistoryView
          refreshSignal={historyRefresh}
          onScannedAt={setHistoryScannedAt}
          onLoadingChange={handleHistoryLoading}
        />
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS (11 tests — 기존 5 + Task 2의 2 + 신규 4)

- [ ] **Step 10: 전체 회귀 확인**

Run: `npm test`
Expected: 전부 PASS. 특히 `getByText("Refresh")`를 쓰는 기존 3개(`App.test.tsx:58`·`:72`·`:106`)가 span 래핑 덕에 그대로 통과해야 한다.

- [ ] **Step 11: 커밋**

```bash
git add src/components/Header.tsx src/App.tsx src/components/UsageHistoryView.tsx src/App.test.tsx src/components/UsageHistoryView.test.tsx
git commit -m "feat(ui): 새로고침 버튼에 진행 스피너 추가 (#23)"
```

---

### Task 5: 헤더 갱신 시각 shimmer

`—`를 로딩일 때만 shimmer로 바꾼다. 로딩이 아닌 "시각 없음"에서는 `—`를 유지한다 (설계 §6.1).

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx` (신규 `it` 추가)

**Interfaces:**
- Consumes: `Skeleton` (Task 1), App의 `historyBusy`·`loadFailed`·`report` (Task 2·4)
- Produces: `Header`에 `loading: boolean` prop

- [ ] **Step 1: 실패하는 테스트 작성**

`src/App.test.tsx`의 `describe` 안 마지막에 추가:

```tsx
  it("shimmers the header time while the first load is in flight", async () => {
    let release!: (r: typeof report) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage"
        ? new Promise((res) => { release = res as (r: typeof report) => void; })
        : defaultInvoke(cmd)) as never);

    const { container } = render(<App />);
    expect(container.querySelector(".app-header .skeleton")).not.toBeNull();
    expect(screen.queryByText(/Updated/)).toBeNull();
    // The skeleton is aria-hidden, so without this the header would go silent
    // to assistive tech — worse than the "Updated —" it replaced.
    expect(container.querySelector('.app-header [role="status"]')).not.toBeNull();

    release(report);
    await screen.findByText(`Updated ${hhmmss(10)}`);
    expect(container.querySelector(".app-header .skeleton")).toBeNull();
    expect(container.querySelector('.app-header [role="status"]')).toBeNull();
  });

  it("falls back to a dash — not an endless shimmer — when the first load fails", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "get_usage" ? Promise.reject(new Error("boom")) : defaultInvoke(cmd)) as never);

    const { container } = render(<App />);
    await screen.findByRole("alert");

    // A dash is honest here: no time is coming.
    expect(screen.getByText("Updated —")).toBeInTheDocument();
    expect(container.querySelector(".app-header .skeleton")).toBeNull();
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/App.test.tsx -t "shimmers the header time"`
Expected: FAIL — `expected null not to be null` (헤더에 skeleton이 없음)

- [ ] **Step 3: Header 구현**

`src/components/Header.tsx`의 임포트에 추가:

```tsx
import { Skeleton } from "./Skeleton";
```

props에 `loading` 추가:

```tsx
  loading: boolean;
```
(구조분해에도 `loading,` 추가)

`timeStr`은 **그대로 둔다** — `updatedAt`이 null일 때 `"—"`로 떨어지는 기존 동작이 그대로 필요하다 (로딩이 아닌 "시각 없음" 경로).

갱신 시각을 렌더하는 한 줄만 교체한다. 현재 코드:

```tsx
        <span className="app-header__updated">{t("app.lastUpdated", { time: timeStr })}</span>
```

교체 후:

```tsx
        {updatedAt === null && loading ? (
          <span role="status" aria-label={t("app.loading")}>
            <Skeleton width="92px" height={12} radius={4} />
          </span>
        ) : (
          <span className="app-header__updated">{t("app.lastUpdated", { time: timeStr })}</span>
        )}
```

> `Skeleton`은 `aria-hidden`이므로 래퍼가 없으면 로딩 중 헤더가 보조기술에 **아무것도** 노출하지 않는다 — 이전엔 최소한 "Updated —"가 읽혔으므로 후퇴다. 스펙 §9의 "컨테이너에만 `role="status"`" 규칙이 여기에도 적용되며, `ProviderCardSkeleton`·`HistorySkeleton`의 소비처가 이미 같은 패턴이다.

- [ ] **Step 4: App에서 loading 계산**

`src/App.tsx`의 `Header`에 prop 추가 (`refreshing` 다음 줄):

```tsx
        loading={view === "history" ? historyBusy : report === null && loadFailed === null}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS (13 tests)

- [ ] **Step 6: 전체 회귀 확인**

Run: `npm test`
Expected: 전부 PASS. 특히 `App.test.tsx:84` "shows each tab's own updated time in the header"가 통과해야 한다 — 이력 탭 전환 직후 `historyScannedAt`이 null이라 잠시 shimmer가 뜨지만, 기존 테스트는 `waitFor`로 감싸여 있다.

- [ ] **Step 7: 커밋**

```bash
git add src/components/Header.tsx src/App.tsx src/App.test.tsx
git commit -m "feat(ui): 헤더 갱신 시각을 로딩 중 shimmer로 표시 (#23)"
```

---

### Task 6: 다운로드 버튼 스피너와 최종 검증

마지막 텍스트 로딩 표시를 없애고, 실제 앱에서 눈으로 확인한다.

**Files:**
- Modify: `src/components/UsageHistoryView.tsx:138`
- Modify: `src/components/UsageHistoryView.test.tsx` (신규 `it` 추가)

**Interfaces:**
- Consumes: `Spinner` (Task 1)
- Produces: 없음 (최종 태스크)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/UsageHistoryView.test.tsx`의 `describe` 안 마지막에 추가:

```tsx
  it("marks the download button busy while the export runs", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    let release!: () => void;
    downloadUsageXlsx.mockReturnValue(new Promise<void>((res) => { release = res; }));

    render(<UsageHistoryView />);
    const label = await screen.findByText("Download Excel");
    const button = label.closest("button")!;
    expect(button.getAttribute("aria-busy")).toBe("false");

    fireEvent.click(label);
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));

    release();
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("false"));
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/components/UsageHistoryView.test.tsx -t "download button busy"`
Expected: FAIL — `expected null to be "false"`

- [ ] **Step 3: 다운로드 버튼 구현**

`src/components/UsageHistoryView.tsx`의 임포트에 추가:

```tsx
import { Spinner } from "./Spinner";
```

138-140행을 교체한다. **라벨은 반드시 span 안에** — 기존 테스트 4개(`:45`·`:53`·`:58`·`:73`)가 `findByText("Download Excel")`와 `.closest("button")`을 쓴다:

```tsx
      <button className="history-download" onClick={onDownload} disabled={downloading} aria-busy={downloading}>
        <Spinner spinning={downloading} />
        <span>{t("history.download")}</span>
      </button>
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/components/UsageHistoryView.test.tsx`
Expected: PASS (16 tests — Task 4의 15 + 신규 1)

- [ ] **Step 5: 전체 검증 — 타입·테스트·잔재**

```bash
npm test
npx tsc --noEmit
grep -rn '"…"\|>…<\|history-loading' src --include="*.tsx" --include="*.css"
```

Expected:
- `npm test` — 전부 PASS
- `tsc --noEmit` — 출력 없음
- `grep` — **매치 없음** (`…` 로딩 표시와 죽은 CSS 클래스가 모두 사라졌다는 확인). `format.ts`의 `"리셋 중…"`/`"resetting…"`은 로케일 문자열이라 `src/lib`에 있고 이 grep에 걸리지 않는다.

- [ ] **Step 6: 실제 앱에서 눈으로 확인**

지금까지는 전부 jsdom이다. shimmer가 실제로 흐르는지, 라이트·다크에서 보이는지, 레이아웃이 안 튀는지는 렌더링 없이 확인할 수 없다.

```bash
npm run dev
```

브라우저에서 확인할 것:
- 콜드 로드 시 카드 2개 형태의 스켈레톤 → 데이터 도착 시 **점프 없이** 교체되는가 (Claude 3바 / Codex 2바가 실제 창 개수와 맞는가)
- 다크 테마로 전환 시 shimmer가 보이는가 (`--track`→`--card` 대비가 살아있는가)
- 이력 탭 콜드 로드 스켈레톤이 테이블처럼 읽히는가
- 새로고침 클릭 시 `↻`가 돌고 버튼 폭이 안 변하는가
- DevTools → Rendering → "Emulate prefers-reduced-motion" 켜고 모션이 멈추는가

> 스크린샷 비교가 필요하면 `superpowers:verification-before-completion` 대신 `/run` 스킬로 앱을 띄워도 된다. Tauri 창까지 확인하려면 `npm run tauri dev`가 필요하나, WSL에서는 시스템 라이브러리 셋업이 걸릴 수 있다 — `npm run dev`의 브라우저 확인으로 충분하다.

- [ ] **Step 7: 커밋**

```bash
git add src/components/UsageHistoryView.tsx src/components/UsageHistoryView.test.tsx
git commit -m "feat(ui): 다운로드 버튼에 진행 스피너 추가 (#23)"
```

- [ ] **Step 8: PR 생성**

```bash
git push -u origin donghoon-bigvalue/issue-23-ui
gh pr create --title "feat(ui): 로딩 UI 개선 — shimmer 스켈레톤 + 인라인 스피너 (#23)" --body "$(cat <<'BODY'
## 요약

`…`·빈 화면·`—`로 표현되던 로딩을 앱 디자인에 맞는 UI로 교체합니다. Closes #23.

- **콜드 로드** → shimmer 스켈레톤 (Claude 3바 / Codex 2바 — 실제 창 개수와 맞춰 레이아웃 시프트 없음)
- **새로고침** → 기존 내용 유지 + 버튼 아이콘 회전
- **다운로드** → 버튼 스피너
- **헤더 갱신 시각** → 로딩 중에만 shimmer, 그 외에는 `—` 유지

## 함께 고친 것

`App.tsx`의 `fetchUsage()`에 `.catch`가 없어, 스켈레톤을 넣으면 로드 실패 시 **영원히 반짝이는 화면**이 될 뻔했습니다 (기존에는 영원히 빈 화면). 실패를 오류 배너로 표시하도록 함께 고쳤습니다 — 이력 탭이 이미 쓰던 패턴에 한도 탭을 맞춘 것입니다.

## 건드리지 않은 것

- `format.ts`의 `—` — 로딩이 아니라 "값이 영영 없음"(단가 미등록)이라 shimmer를 붙이면 거짓 신호가 됩니다.
- 자동 갱신 진행 표시 — 푸시 이벤트라 시작 시점을 알 수 없어 정직하게 표시할 수 없습니다.

## 설계

`docs/superpowers/specs/2026-07-16-loading-ui-design.md`

## 테스트

신규 20개, 기존 테스트는 한 줄도 고치지 않고 전부 통과합니다. 무한 shimmer(로드 실패)와 연속 새로고침 레이스가 회귀 테스트로 고정돼 있습니다.

새 색 토큰·애니메이션 라이브러리 없이 기존 CSS 변수(`--track`/`--card`)만 사용해 라이트·다크가 자동 대응하며, `prefers-reduced-motion`을 존중합니다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## 부록: 태스크 의존 관계

```
Task 1 (프리미티브·CSS·i18n)
  ├─→ Task 2 (한도 콜드 로드 + loadFailed) ──┐
  ├─→ Task 3 (이력 콜드 로드)                │
  └─→ Task 4 (새로고침 스피너) ←─────────────┘  historyBusy 생성
        └─→ Task 5 (헤더 shimmer)  historyBusy·loadFailed 소비
  └─→ Task 6 (다운로드 스피너 + 최종 검증)
```

Task 2·3은 서로 독립이다. Task 5는 Task 4의 `historyBusy`와 Task 2의 `loadFailed`를 모두 쓰므로 반드시 그 뒤에 온다. Task 6은 Task 1 이후 아무 때나 가능하나, 최종 검증을 포함하므로 마지막에 둔다.
