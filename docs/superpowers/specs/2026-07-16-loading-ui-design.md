# 로딩 UI 개선 — 설계 문서

- **날짜:** 2026-07-16
- **이슈:** [donghoon-bigvalue/token-usage-app#23](https://github.com/donghoon-bigvalue/token-usage-app/issues/23)
- **상태:** 승인됨 (설계 확정, 사용자 확인 완료)

## 1. 목적

현재 앱은 로딩을 `…` 글자 하나나 빈 화면으로 표현한다. 이를 앱의 기존 디자인 언어에 맞는 스켈레톤 + 인라인 진행 표시로 교체해, 사용자가 "멈춘 것 같은" 구간을 겪지 않게 한다.

이슈 요구사항:

- 현재 `…` / `-` 같은 텍스트 로딩 표시를 유려한 UI로 교체
- 널리 쓰이는 레퍼런스를 앱 디자인에 맞게 적용

## 2. 확정된 결정사항

| 항목 | 결정 |
| --- | --- |
| 표현 방식 | **상황별 하이브리드** — 화면에 내용이 없으면 스켈레톤, 있으면 기존 내용 유지 + 인라인 진행 표시 |
| 스켈레톤 모션 | **shimmer 슬로우 스윕** (1.6s, 좌→우). Facebook·LinkedIn 레퍼런스. 방향성이 있어 "오는 중"으로 읽힘 |
| 새로고침 진행 표시 | **버튼 자체에** — 누른 버튼이 직접 반응. 상단 바는 640px 창에 과하고, 어떤 작업의 진행인지 모호함 |
| 색상 토큰 | **신규 없음** — 기존 `--track` / `--card` 변수만으로 라이트·다크 자동 대응 |
| 오류 처리 | **동반 수정** — 무한 shimmer 방지 (§6) |

### 2.1 하이브리드가 필요한 이유

`UsageHistoryView`는 이미 *새로고침 중에는 기존 테이블을 유지*하도록 설계돼 있다 (`if (!isRefresh) setLoading(true)`, `UsageHistoryView.tsx:48`). 이미 본 데이터를 회색 블록으로 되돌리는 것은 퇴보다. 따라서 스켈레톤은 **콜드 로드 전용**이고, 새로고침은 다른 표현을 쓴다.

### 2.2 자동 갱신에는 진행 표시를 붙이지 않는다

한도 탭의 자동 갱신은 `onUsageUpdated` 푸시 이벤트로 들어온다 (`App.tsx:40`). 프런트는 그 작업의 **시작 시점을 알 수 없다** — 도착만 안다. 따라서 정직하게 진행 표시를 붙일 수 있는 것은 사용자가 새로고침 버튼을 누른 경우뿐이다. 이 제약이 "버튼 자체에" 결정의 근거이기도 하다.

## 3. 상황별 매핑

| 상황 | 현재 | 변경 후 |
| --- | --- | --- |
| 한도 탭 콜드 로드 | 빈 화면 (`App.tsx:78`, `report &&`) | `ProviderCardSkeleton` ×2 (bars 3 / 2) |
| 이력 탭 콜드 로드 | `…` (`UsageHistoryView.tsx:73`) | `HistorySkeleton` (카드 2 + 테이블 행 5) |
| Header 갱신 시각 미확정 | `—` (`Header.tsx:21`) | span 전체를 shimmer pill로 |
| 새로고침 버튼 | 표시 없음 | `↻` 아이콘 회전, 라벨·폭 고정 |
| 다운로드 버튼 | `disabled`만 (`UsageHistoryView.tsx:138`) | 스피너 추가, 폭 고정 |
| 이력 테이블 `—` (추정 불가) | `—` (`format.ts:35`) | **변경 없음** — 아래 참조 |

### 3.1 `format.ts`의 `—`를 건드리지 않는 이유

`formatUsd(null)` → `—`는 **이미 로드된** 데이터의 비용을 추정할 수 없을 때 쓰인다 (미등록 모델 단가). 로딩이 아니라 "값이 영영 없음"이다. 여기에 shimmer를 붙이면 "곧 값이 나온다"는 거짓 신호가 된다.

반대로 `Header.tsx`의 `—`는 **스냅샷이 아직 없는** 상태이므로 진짜 로딩이며, 교체 대상이다.

## 4. 컴포넌트 구조

### 4.1 `src/components/Skeleton.tsx` (신규)

- `Skeleton` — shimmer 블록 프리미티브. 폭/높이/라운드만 받는다.
- `ProviderCardSkeleton({ bars })` — `ProviderCard`의 형태를 그대로 흉내: head(이름 블록 + 플랜 pill) + `bars`개의 한도 바.
- `HistorySkeleton` — 이번 달 카드 2개 + 테이블 행 5개.

### 4.2 `src/components/Spinner.tsx` (신규)

버튼 안에 들어가는 회전 아이콘. 새로고침 버튼과 다운로드 버튼이 공유한다.

두 파일 모두 순수 프레젠테이션 — 데이터·상태 의존 없음. 기존 `EmptyState.tsx`가 같은 결의 단순 프리미티브라 패턴이 일치한다.

### 4.3 스켈레톤 바 개수는 provider마다 다르다

`types.ts`의 `WindowId` 기준으로 Claude는 3개(`claude_session`, `claude_weekly_all`, `claude_weekly_fable`), Codex는 2개(`codex_weekly`, `codex_spark_weekly`)다. 스켈레톤이 이 개수를 맞춰야 실제 데이터 도착 시 레이아웃 시프트가 없다 — 스켈레톤을 쓰는 이유 자체가 그것이다.

### 4.4 개수만 맞추면 부족하다 — 행 높이도 맞춰야 한다

바 개수가 맞아도 **행이 차지하는 세로 공간**이 다르면 카드가 자란다. 실측 결과 시프트가 총 38px이었다:

| | 스켈레톤 | 실제 | 차이 |
| --- | --- | --- | --- |
| `.app__cards` 높이 | 398 | 436 | +38 |
| `.limit-bar__row` | 12 | 18 | +6 (바 5개) |
| `.provider-card__head` | 18 | 22 | +4 |

원인은 두 가지가 겹친 것이다:

1. `Skeleton`에 넘긴 높이는 **폰트 크기**(12·16px)인데, 실제 텍스트가 차지하는 것은 **line box**(13px→18px, 16px→22px)다.
2. `.limit-bar__row`와 `.provider-card__head`는 `display: flex`라 컨테이너 높이가 자식 높이로 결정된다 — 텍스트라면 개입했을 strut이 없다.

따라서 스켈레톤이 흉내내는 flex 행에는 **명시적 높이를 주는 모디파이어 클래스**를 붙인다:

```css
.provider-card__head--skeleton { height: 22px; }
.limit-bar__row--skeleton { height: 18px; }
```

블록 자체는 얇게(12px) 두고 행만 실제 line box를 예약하므로, 시각적으로는 가볍고 레이아웃은 정확하다.

> **이 결함은 jsdom 테스트로는 잡을 수 없다.** jsdom에 레이아웃이 없어 65개 테스트가 전부 통과하고 태스크 리뷰 6건이 승인된 뒤에도 남아 있었다. 실제 브라우저 측정에서만 드러났다. 단위 테스트는 모디파이어 클래스의 *존재*만 지킬 수 있고 픽셀 값은 지키지 못하므로, 스켈레톤 치수를 바꿀 때는 브라우저 재측정이 필요하다.

### 4.5 이력 탭은 0이 될 수 없다 — 그리고 그건 결함이 아니다

한도 탭은 시프트 0을 달성한다 — **단, 그건 창 개수가 `WindowId`로 고정(3/2)이기 때문만이 아니라 §4.6으로 바 높이까지 고정했기 때문이다.** 이력 탭은 다르다. 측정된 87px의 내역:

| 원인 | 시프트 | 성격 |
| --- | --- | --- |
| 스켈레톤에 다운로드 버튼이 없음 | 39 | 구조 누락 — 고침 |
| 카드 내부 3줄의 line box (13/13/18 → 18/18/24) | 22 | 높이 — 고침 |
| 안내문 line box (12 → 17) | 5 | 높이 — 고침 |
| 테이블 행 (5행 추정 → thead + 실제 행 수) | 21 | **고칠 수 없음** |

테이블 행 수는 **사용자에게 몇 달치 기록이 있느냐**에 달려 있고, 그건 스캔이 끝나야 안다. 스켈레톤의 5행은 추측일 수밖에 없다 — 3개월치면 스켈레톤이 크고, 10개월치면 작다. 따라서 이력 탭의 목표는 **알 수 있는 것(카드 2개·안내문·다운로드 버튼)을 정확히 맞추고, 테이블 구간의 잔여 시프트는 받아들이는 것**이다.

87 → 약 21px로 줄인다. 남은 21px를 결함으로 오해하지 말 것 — 없앨 방법은 "행 수를 알 때까지 테이블 자리를 비워두는 것"뿐이고, 그건 목록이 올 자리가 빈칸으로 보여 더 나쁘다.

### 4.6 스켈레톤이 예측할 수 없으면, 실제 컴포넌트가 변동을 멈춘다

`LimitBar`는 리셋 카운트다운 줄을 **조건부로** 그렸다 — `available === false`인 창은 아예 없고, available이어도 `resets_at == null`이면 없다. 스켈레톤은 그 줄을 무조건 그리므로, unavailable 창 하나당 실제 카드가 **18px 짧아진다**.

가설이 아니다. `providers/codex.rs`의 rollout 경로는 `LimitWindow::unavailable(CodexSparkWeekly)`를 **무조건** push하고(rollout `rate_limits`에 Spark가 없다), `providers/claude.rs`도 Fable 주간 한도가 없는 계정에 `unavailable(ClaudeWeeklyFable)`을 push한다 — 이쪽이 흔한 경우다. 즉 **해당 경로의 모든 Codex 사용자**가 이 시프트를 겪는다.

스켈레톤은 어느 창이 unavailable일지 미리 알 수 없다. 그래서 해법은 스켈레톤이 아니라 **실제 컴포넌트가 변동을 멈추는 것**이다: `LimitBar`가 양쪽 분기에서 리셋 줄을 항상 렌더하고, 카운트다운이 없으면 빈 줄로 둔다. 모든 바가 같은 높이가 되어 스켈레톤이 예측할 것이 사라지고, 바 리듬도 일정해진다.

> §4.4가 "개수만 맞으면 부족하다"였다면, 이건 한 단계 더 아래다 — **높이가 데이터에 따라 변하면 개수도 높이도 소용없다.** 이 결함은 모든 창이 available인 픽스처로 측정해서 놓쳤다. 스켈레톤을 측정할 때는 실제 컴포넌트가 렌더할 수 있는 *모든 모양*을 넣어야 한다.

## 5. shimmer 구현

기존 `--track`을 베이스로 `--card` 쪽으로 이동하는 gradient를 만들고, `background-position`을 1.6s 선형으로 이동시킨다. 두 변수 모두 `[data-theme]`에 이미 정의돼 있어 라이트·다크가 자동 대응된다.

> **라이트에서는 밝아지고 다크에서는 어두워진다.** 라이트는 `--track`(#e6e6e6) → `--card`(#ffffff)로 광택이 지나가지만, 다크는 `--track`(#3a3a3d)이 `--card`(#262629)보다 밝아 **그림자가 지나간다**. sweep 진폭은 양쪽이 비슷해(라이트 25단계 / 다크 20단계) 모션은 동등하게 읽히므로 수용한다. 다크에서도 밝아지게 하려면 `rgba(255,255,255,.06)` 같은 알파 오버레이를 `--track` 위에 얹으면 되고 — 이는 새 *색 토큰*이 아니므로 §2의 제약에 걸리지 않는다 — 후속 개선 후보다.

```css
.skeleton {
  background: linear-gradient(90deg, var(--track) 25%, var(--card) 50%, var(--track) 75%);
  background-size: 200% 100%;
  animation: skeleton-sweep 1.6s linear infinite;
  border-radius: 999px;
}
@keyframes skeleton-sweep {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}
```

한도 바 스켈레톤은 기존 `.limit-bar__track`과 같은 높이(8px)·라운드(999px)를 쓴다 — 스켈레톤이 곧 트랙의 형태가 된다.

## 6. 무한 shimmer 방지 (동반 수정)

`App.tsx:39`의 `fetchUsage().then(applyReport)`에는 **`.catch`가 없다.** 지금은 실패 시 영원히 빈 화면이지만, 스켈레톤을 넣으면 **영원히 반짝이는 화면**이 된다 — 현재보다 나쁘다. 로딩 UI가 거짓말을 하게 두지 않기 위해 함께 고친다.

- `App`에 `loadFailed: string | null` 상태 추가
- 최초 `fetchUsage()`가 reject하면 `loadFailed` 설정
- `report === null && loadFailed` → 스켈레톤 대신 오류 메시지
- `report === null && !loadFailed` → 스켈레톤
- `report !== null` → 카드 (이후 실패는 `mergeReport`가 이미 이전 스냅샷을 지켜준다)

`UsageHistoryView`는 이미 `loadError`로 같은 처리를 하고 있으므로 (`UsageHistoryView.tsx:75`), 이는 새 패턴이 아니라 한도 탭을 기존 패턴에 맞추는 작업이다.

i18n 키 `app.loadFailed` 신규 추가 (기존 `history.loadFailed`와 대응).

### 6.1 헤더 시각도 같은 구멍이 있다

카드 영역만 막으면 부족하다. 헤더 시각은 `updatedAt === null`일 때 shimmer인데, 로드가 실패하면 `updatedAt`이 영영 null이다 — 한도 탭은 `report`가 null로 남고, 이력 탭은 `onScannedAt`이 성공에만 발화하므로 스캔 실패 시 역시 null이다.

두 탭 모두 "시각이 곧 도착하는가"를 판단할 신호가 필요하다:

- 한도 탭: `report === null && loadFailed === null`
- 이력 탭: `historyBusy` (§7 — `.finally()`라 실패에도 false로 떨어진다)

둘 다 false면 shimmer 대신 기존 `—`를 보여준다. 즉 `—`는 사라지는 것이 아니라 **"로딩이 아닌 시각 없음"** 이라는 정확한 의미만 남긴다.

## 7. 인터페이스 변경

`UsageHistoryView`에 `onLoadingChange?: (busy: boolean) => void` 추가.

App이 이력 탭 새로고침의 **완료 시점**을 알아야 버튼 회전을 멈출 수 있는데, 그 상태는 자식이 소유한다. 기존 `onScannedAt`과 같은 결의 상향 보고 콜백이다.

**콜백은 모든 로드(콜드 + 새로고침)에서 발화하고, 회전 여부는 App이 판단한다.** App은 `refresh()`를 소유하므로 사용자가 버튼을 눌렀는지 알고 있다:

- 버튼 회전 = `historyBusy && refreshPressed` → 콜드 로드에서는 안 돈다 (§2 "누른 버튼이 반응한다" 유지)
- 헤더 시각 shimmer = `historyBusy` → 스캔이 끝나면(성공이든 실패든) 멈춘다

콜드 로드에서 발화를 막는 대안도 있었으나, 그러면 **스캔 실패 시 헤더가 영원히 반짝인다** — `onScannedAt`은 성공에만 발화하므로 `updatedAt`이 null로 남는다. `.finally()`는 실패에도 실행되므로 모든 로드에서 발화시키는 편이 §6의 무한 shimmer 방지를 헤더까지 확장한다. 콜백은 하나로 유지된다.

`Header`에 `refreshing: boolean`, `loading: boolean` prop 추가.

### 7.1 보고는 살아있는 인스턴스만 한다

`.finally()`의 `false` 보고는 **`alive`로 가드한다** — `setLoading(false)`와 같은 조건이다. 그리고 App은 **이력 탭을 떠날 때 `historyBusy`·`refreshPressed`를 정리한다.**

플래그를 App이 소유하는데 `UsageHistoryView`는 탭 전환마다 언마운트된다는 비대칭이 핵심이다. 언마운트된 인스턴스가 뒤늦게 보고하게 두면:

1. 이력 탭에서 새로고침 → `refreshPressed=true`, 인스턴스 A 스캔 시작
2. 스캔 중 한도 탭으로 전환 → A 언마운트, `refreshPressed`는 true로 방치
3. 이력 탭 복귀 → 인스턴스 B가 콜드 로드 → `historyBusy=true`, 방치된 `refreshPressed`와 만나 **누르지도 않은 버튼이 돈다** (§2 위반)
4. A의 `.finally()`가 뒤늦게 발화 → **살아있는 B의 스캔 중에 `historyBusy`를 꺼버린다**

"보고하지 않으면 버튼이 영원히 돈다"는 우려로 언마운트 후 보고를 넣었으나, 그 전제가 틀렸다 — 버튼은 `view === "history"`일 때만 도는데 그때는 항상 인스턴스가 살아있다. 한도 탭에 있는 동안 방치된 플래그는 보이지 않고(`limitsRefreshing`이 표시를 담당), 이력 탭 복귀 시 App이 정리한다.

`alive` 가드는 **연속 새로고침 레이스도 함께 막는다.** `refreshSignal`이 바뀌면 cleanup이 먼저 돌아 이전 실행의 `alive`가 false가 되므로, 늦게 끝난 스캔 #1은 침묵하고 스캔 #2만 보고한다. 별도의 시퀀스 카운터는 필요 없다.

## 8. 데이터 흐름

```
앱 시작
  → report === null, loadFailed === null → ProviderCardSkeleton ×2
  → fetchUsage() 성공 → report 설정 → 카드 렌더 (시프트 없음)
  → fetchUsage() 실패 → loadFailed 설정 → 오류 메시지 (shimmer 정지)

새로고침 버튼 클릭 (한도 탭)
  → refreshing = true → 버튼 아이콘 회전 (기존 카드 유지)
  → fetchUsage() 완료/실패 → refreshing = false

새로고침 버튼 클릭 (이력 탭)
  → historyRefresh 증가
  → UsageHistoryView가 스캔 시작 → onLoadingChange(true) → 버튼 회전
  → 스캔 완료 → onLoadingChange(false) → 회전 정지 (기존 테이블 유지)

이력 탭 콜드 로드 (사용자가 누르지 않음)
  → HistorySkeleton + onLoadingChange(true) → historyBusy=true
  → 하지만 refreshPressed=false이므로 버튼은 정지 (§7)
  → 스캔 완료/실패 → onLoadingChange(false)
```

> 콜드 로드에서도 콜백은 **발화한다.** 발화를 막으면 §6.1의 헤더 무한 shimmer가 되열린다 — 이 줄을 "발화 없음"으로 되돌리지 말 것.

## 9. 접근성

- 스켈레톤 블록은 `aria-hidden="true"` (장식). 컨테이너에 `role="status"` + 스크린리더용 텍스트 — i18n 키 `app.loading` 신규.
- 새로고침 버튼에 `aria-busy={refreshing}`.
- `prefers-reduced-motion: reduce` → shimmer·회전 정지, 정적 블록으로 표시. 모션을 뺀 상태는 "멈춤과 구분 불가"라는 이슈의 원래 문제로 되돌아가지만, 접근성 배려로서 의도된 예외다.

## 10. 기존 테스트 제약 — 아이콘을 넣는 모든 버튼

testing-library의 `getByText`는 **엘리먼트의 `textContent` 전체**와 비교한다. 버튼에 스피너 문자를 직접 넣으면 `textContent`가 `"↻Refresh"`가 되어 `getByText("Refresh")`가 아무것도 매치하지 못한다.

영향받는 기존 테스트:

- `App.test.tsx:58`, `:72`, `:106` — `fireEvent.click(screen.getByText("Refresh"))`
- `UsageHistoryView.test.tsx:45`, `:53`, `:58`, `:73` — `findByText("Download Excel")`, `.closest("button")!.disabled`

→ **두 버튼 모두 라벨을 별도 엘리먼트로 감싼다:**

```tsx
<button><Spinner spinning={busy} /><span>{t("app.refresh")}</span></button>
```

`getByText`가 내부 span에 매치되고, 클릭은 버튼으로 버블링되며, `.closest("button")`도 그대로 동작한다. 기존 테스트를 한 줄도 고치지 않고 통과한다.

## 11. 테스트 전략

TDD로 진행한다.

**신규 (vitest):**
- 한도 탭 콜드 로드 시 스켈레톤 렌더, `report` 도착 후 사라짐
- `fetchUsage()` 실패 시 스켈레톤이 아니라 오류 메시지 (무한 shimmer 회귀 방지 — §6의 핵심)
- 이력 탭 콜드 로드 시 `HistorySkeleton`, `…` 없음
- 새로고침 중 버튼 `aria-busy`, 완료 후 해제
- 이력 탭 **콜드 로드** 시에는 버튼이 돌지 않음 (§7 — 누르지 않은 버튼은 반응하지 않는다)
- 이력 탭 새로고침 시 기존 테이블 유지 (스켈레톤으로 대체되지 않음)
- i18n 키 `app.loading` / `app.loadFailed` ko·en 양쪽 존재

**기존 (회귀):**
- `App.test.tsx` · `UsageHistoryView.test.tsx` 전부 통과. 특히 `getByText("Refresh")` (§10)와 "keeps the last good table when a refresh fails" (`UsageHistoryView.test.tsx:103`)가 관문.

## 12. 범위 밖 (YAGNI)

- `format.ts`의 `—` (§3.1 — 로딩이 아님)
- 자동 갱신(푸시 이벤트) 진행 표시 (§2.2 — 시작 시점을 알 수 없음)
- 상단 전역 프로그레스 바
- 스켈레톤 지연 표시(로드가 빠를 때 깜빡임 방지) — 실측 후 필요하면 후속
- 애니메이션 라이브러리 도입 (순수 CSS로 충분)
- 설정 패널·오류 메시지 등 로딩과 무관한 UI 리터치
