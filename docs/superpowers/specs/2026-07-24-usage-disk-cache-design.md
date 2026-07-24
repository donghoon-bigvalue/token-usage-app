# 마지막 성공 스냅샷 디스크 캐시 + 백그라운드 갱신

작성일: 2026-07-24 · 관련 이슈: #53 후속

## 배경 / 문제

Claude 한도 데이터(세션 %, 주간 % 등)는 오직 원격 OAuth 엔드포인트
(`GET https://api.anthropic.com/api/oauth/usage`)에서만 오고, 앱에 로컬 폴백이
없다. 콜드 스타트엔 액세스 토큰이 만료돼 있어 리프레시(네트워크) → 사용량
조회(네트워크) 두 번의 왕복이 필요하고, 실행 직후 네트워크 미준비나 리프레시
토큰 회전 레이스로 첫 요청이 실패할 수 있다. 그동안 사용자는 빈 스켈레톤(또는
이슈 #53 이전엔 "로그인 안내")을 본다.

반면 Codex는 로컬 `codex app-server` 프로세스 + 로컬 rollout 파일 폴백이 있어
디스크에서 즉시 데이터를 보여줄 수 있고, 이 현상이 사실상 없다.

**목표:** Claude에도 Codex 같은 즉시성을 준다. 마지막으로 성공한 스냅샷을
디스크에 저장해 두고, 다음 실행 때 **캐시(캐시 시각 포함)로 즉시** 보여준 뒤
백그라운드에서 라이브로 갱신한다. 저장된 스냅샷이 없으면 지금처럼
스켈레톤/스피너를 보여준다.

## 앱 생명주기 전제

이 앱은 **트레이 앱**이다(`src-tauri/src/lib.rs`). 창을 닫아도 숨겨질 뿐이고,
완전 종료는 트레이 "종료"(`app.exit(0)`)나 OS 종료 때만 일어난다. 프로세스는
오래 살아있으므로 **디스크 캐시는 오직 재시작 사이에만 필요**하다. 따라서 매 폴
주기마다 디스크에 쓰지 않고, **종료 시 1회 저장**한다.

## 설계

### 1. 백엔드 — 인메모리 홀더 + 종료 시 1회 flush

새 모듈 `src-tauri/src/usage_cache.rs`.

- **인메모리 관리 상태 `LastGood(Mutex<Option<UsageReport>>)`** — `UsageCache`
  (히스토리용, `commands.rs`)와 동일한 관리-상태 패턴. `.manage(...)`로 등록.
- **순수 함수 `merge_persisted(prev: Option<&UsageReport>, fresh: &UsageReport)
  -> UsageReport`** — provider별로, `fresh`의 스냅샷이 `error.is_none()`이면 그걸
  쓰고, 에러면 `prev`의 해당 provider를 유지(prev 없으면 `fresh` 그대로).
  Claude/Codex를 독립적으로 다뤄, 한쪽만 성공해도 다른 쪽의 마지막 성공분이
  지워지지 않는다.
- **`update(state, &fresh)`** — `merge_persisted`로 `LastGood`을 갱신. 폴러가 매
  수집 직후, `get_usage` 커맨드가 수집 직후 호출.
- **`read_disk(app) -> Option<UsageReport>` / `write_disk(app, &report)`** —
  store 파일 `usage-cache.json`(키 `report`)에 대한 얇은 I/O.
  `tauri-plugin-store`(`app.store(...)`) 사용, 설정 저장과 동일 패턴. 모두
  best-effort(실패해도 패닉 없음).

**시작 시 시딩** (`lib.rs` `setup()`):
`LastGood` ← `read_disk(app)`. 이번 세션에 한 provider가 한 번도 성공 못 해도
종료 시 그 칸을 빈 값으로 덮어써 예전 데이터를 날리는 일을 막는다.

**종료 시 flush** (`lib.rs`): `.run(context)`를 `.build(context)?.run(|handle,
event| …)` 형태로 바꿔 `RunEvent::Exit`에서 `write_disk(handle,
&LastGood)`(있을 때). 동기 저장 — 이벤트는 메인 스레드에서 종료 직전 실행.

**새 커맨드 `get_cached_usage(state) -> Option<UsageReport>`** — `LastGood`(시작
시엔 디스크 시딩값)을 각 스냅샷 `source = Cache`로 표시해 반환.

### 2. 프론트엔드 — 캐시 즉시 그리기 → 라이브 교체

`src/lib/usage.ts`에 `fetchCachedUsage(): Promise<UsageReport | null>`
(`invoke("get_cached_usage")`) 추가.

`src/App.tsx` 초기 로드 `useEffect` 및 위젯 `src/lib/useUsageReport.ts`:

1. 마운트 시 `fetchCachedUsage()` 먼저 호출. 결과가 있으면 즉시
   `applyReport(cached)`(캐시 뱃지와 함께 그림) + `refreshing = true`.
2. 이어서 기존 `load()`(라이브 `get_usage`)가 resolve되면 `applyReport(live)`로
   교체하고 `refreshing = false`.
3. 캐시가 `null`이면 지금처럼 스켈레톤 표시 후 `load()` 대기.

**병합 동작은 기존 `mergeReport`가 이미 지원**(수정 불필요):
- 캐시 있음 + 라이브 성공 → 라이브로 교체.
- 캐시 있음 + 일시 오류 → 캐시 유지(뱃지 그대로). 이슈 #53의 재시도
  스켈레톤은 **캐시가 아예 없을 때만** 나온다.
- 캐시 있음 + 인증 오류 → 로그인 안내로 교체(진짜 로그아웃이므로 정상).

### 3. 갱신 표시 (헤더 스피너)

백그라운드 갱신(`refreshing`) 동안 헤더의 새로고침 `↻` 스피너를 회전시킨다.
기존 수동 새로고침용 `limitsRefreshing`(App)·`refreshing`(위젯) 메커니즘을
재사용한다. 별도 UI 요소 추가 없음.

### 4. 캐시 시각 표시

- `src/lib/format.ts`에 **`formatRelativeAge(epoch, now, locale)`** 추가 —
  "방금", "N분 전", "N시간 전", "N일 전" / "just now", "Nm ago" 등.
- `src/components/ProviderCard.tsx`의 `캐시됨` 뱃지를 **`캐시됨 · {상대시간}`**
  으로 확장(스냅샷 `updated_at` 기준). 뱃지 노출 조건은 기존과 동일
  (`source === "cache" && !error`).
- 헤더의 `{시각} 갱신` 표기는 그대로 둔다.
- 오래된 캐시도 만료시키지 않고 나이를 정직하게 표기한다(빈 화면보다 낫다).

## 트레이드오프

강제 종료·크래시·하드 셧다운 시 `RunEvent::Exit`가 실행되지 않아, 디스크
캐시는 **직전 정상 종료 시점**으로 남는다. 라벨(캐시 시각)이 붙고 실행 즉시
라이브 갱신되므로 실질 영향은 작다. 최초 실행엔 캐시가 없어 기존 스켈레톤.

## 테스트

**백엔드**
- `merge_persisted`: 성공→덮어쓰기 / 에러→기존 유지 / prev 없음→fresh /
  provider 독립(Claude 성공·Codex 에러일 때 각각 올바르게).
- `get_cached_usage`가 반환 스냅샷의 `source`를 `Cache`로 표시하는지(순수부만
  단위 테스트, store I/O는 얇게).

**프론트엔드**
- `formatRelativeAge` 단위 테스트(경계: <1분, 분, 시간, 일; ko/en).
- `App`/`useUsageReport`: 마운트 시 캐시 먼저 그린 뒤 라이브로 교체되는 순서
  (invoke 목킹). 캐시 없을 때 스켈레톤 유지.
- `ProviderCard`: 캐시 뱃지에 상대시간이 붙는지.

## 범위 밖 (YAGNI)

- 캐시 TTL/만료, 캐시 크기 제한.
- 히스토리 탭 캐시(이미 `UsageCache` 세션 캐시가 있음).
- 매 폴/주기 디스크 쓰기(종료 시 1회로 충분).
- 다중 계정.

## 영향 파일

- 신규: `src-tauri/src/usage_cache.rs`, `docs/.../2026-07-24-usage-disk-cache-design.md`
- 수정: `src-tauri/src/lib.rs`(시딩·flush·manage·커맨드 등록),
  `src-tauri/src/commands.rs`(`get_cached_usage`, `get_usage`에서 `update`),
  `src-tauri/src/poller.rs`(수집 후 `update`),
  `src/lib/usage.ts`, `src/App.tsx`, `src/lib/useUsageReport.ts`,
  `src/lib/format.ts`, `src/components/ProviderCard.tsx`, 로케일(en/ko).
