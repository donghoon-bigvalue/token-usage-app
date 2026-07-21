# 미니 위젯 창 (A안) 설계

- 이슈: [#36 위젯 만들기](https://github.com/donghoon-bigvalue/token-usage-app/issues/36)
- 날짜: 2026-07-17
- 상태: 승인됨 (구현 대기)

## 배경 / 목표

이슈 #36은 "Tauri에서 OS별 위젯을 만들어 앱 기능 일부를 한눈에 표현"하는 가능성을 물었다.
검토 결과 진짜 OS 네이티브 위젯(WidgetKit 등)은 코드 서명·플랫폼별 확장이 선행돼야 해
리스크가 크므로, **1단계로 "항상 위에 뜨는 미니 창"(desktop widget-style window)** 을 구현한다.

목표: 사용자가 메인 창을 열지 않아도 Claude/Codex의 5개 한도 막대와 리셋 카운트다운을
데스크톱 위에 상시 띄워 확인할 수 있다.

## 범위

**포함**
- 프레임리스·투명·항상 위·작업표시줄 숨김의 두 번째 Tauri 창("widget")
- 위젯 내용: 메인과 동일한 전체 5개 막대 컴팩트 뷰
  (Claude 세션/주간/Fable + Codex 주간/Spark)
- 열기/닫기: 트레이 우클릭 메뉴 **+** 메인 헤더 버튼 (둘 다)
- 상호작용: 드래그 이동 + 새로고침 버튼 + 닫기(×) + 본문 클릭 시 메인 창 열기
- 위젯 창 위치 기억(표시/숨김 간)
- 위젯은 메인과 동일한 테마·언어 설정을 따른다

**제외 (YAGNI)**
- 진짜 OS 네이티브 위젯(WidgetKit / Win11 위젯보드 / 모바일) — 별도 이슈
- 위젯 창 크기 조절, 위젯 전용 설정 화면
- 위젯에서 provider별 개별 새로고침(전체 새로고침만)

## 접근법 결정

프런트엔드 진입 구조는 **별도 Vite 진입점**(접근법 1)을 택한다.
- 메인(`App.tsx`)과 위젯이 렌더·크기·동작이 전혀 달라 격리가 유지보수에 유리
- 잘 다듬어진 `App.tsx`를 건드리지 않아 회귀 위험 없음
- 대안(단일 진입점 분기)은 코드 결합·전체 앱 의존성 로드가 단점

## 아키텍처

### 1) 위젯 창 정의 — `src-tauri/tauri.conf.json`
`app.windows` 배열에 두 번째 창 추가:
- `label: "widget"`, `url: "widget.html"`
- `visible: false` (시작 시 숨김 — 사용자가 명시적으로 열 때만 표시)
- `decorations: false`, `transparent: true`, `alwaysOnTop: true`,
  `skipTaskbar: true`, `resizable: false`
- `width: 260`, `height: 220` (5개 막대 기준, 구현 중 미세조정)
- `shadow: false` (투명 창 잔상 방지)

macOS 투명 창을 위해 `app.macOSPrivateApi: true` 추가.
(미서명 배포이므로 App Store 제약 무관)

### 2) 위젯 프런트엔드 — `widget.html` + `src/widget/`
- `widget.html`: 루트 `#root` + `src/widget/widget-main.tsx` 로드,
  `<body>`/`<html>` 배경 투명
- `widget-main.tsx`: 설정 로드 → `applyTheme(s.theme)` + `i18n.changeLanguage(s.language)`
  (메인 `App` 초기화와 동일 규칙) → `WidgetApp` 렌더. `./i18n`, `./styles/theme.css` 재사용
- `WidgetApp.tsx`:
  - 상단 바: 드래그 영역(`data-tauri-drag-region`) + 새로고침 버튼 + 닫기(×) 버튼
  - 본문: Claude/Codex 두 그룹, 각 그룹 아래 `LimitBar` 막대들
  - 본문 클릭 → `invoke("show_main")` 로 메인 창 열기
    (드래그·버튼 영역과 클릭 충돌 방지: 버튼은 `stopPropagation`)
  - × → `getCurrentWindow().hide()`

### 3) 데이터 재사용 — 새 훅 `src/lib/useUsageReport.ts`
`get_usage` invoke + `usage-updated` 이벤트 구독 + 1초 카운트다운 틱 + `mergeReport`를
캡슐화한 `useUsageReport()` 훅 신설. 반환: `{ report, loadFailed, now, reload }`.
- 위젯(`WidgetApp`)이 이 훅을 사용
- `App.tsx`는 히스토리/새로고침 버튼 등 추가 관심사가 얽혀 있어 이번엔 **건드리지 않는다**
  (동일 로직 소량 중복은 감수 — 회귀 위험 최소화 우선)
- `get_usage`(백엔드 `usage::collect().await`)는 호출마다 신선한 값을 반환하므로
  새로고침 버튼은 `reload()`로 충분

### 4) UI 재사용
- 기존 `LimitBar` 컴포넌트 그대로 사용
- provider accent 색은 기존 `provider-claude` / `provider-codex` 클래스로 스코프
- 위젯 컴팩트 레이아웃용 CSS만 `src/widget/widget.css`에 신설
  (투명 배경, 반투명 카드, 축소된 여백/폰트)

### 5) 열기/닫기 배선

**백엔드 — `src-tauri/src/`**
- `commands.rs`에 커맨드 추가:
  - `toggle_widget(app)`: `widget` 창 `is_visible`에 따라 show+set_focus / hide.
    표시 시 저장된 위치 복원, 숨김 시 현재 위치 저장(store)
  - `show_main(app)`: `main` 창 show + set_focus
- `lib.rs`:
  - `invoke_handler`에 `toggle_widget`, `show_main` 등록
  - 트레이에 우클릭 메뉴 추가: `메인 창`, `위젯 표시/숨기기`, `종료`.
    기존 좌클릭=메인 토글 동작은 `show_menu_on_left_click(false)`로 유지

**프런트 — `src/components/Header.tsx`**
- 위젯 토글 버튼 추가 → `invoke("toggle_widget")`
- 새 i18n 키(`app.widget` 등) ko/en 추가

### 6) 권한 — `src-tauri/capabilities/`
`widget` 창을 위한 권한 추가(기존 `default.json`에 창 추가 또는 별도 capability):
- `core:window` — `allow-hide`, `allow-show`, `allow-set-focus`,
  `allow-start-dragging`, `allow-set-always-on-top`
- `core:event:allow-listen` (usage-updated 구독)
- `core:webview` 기본 및 `get_usage`/`get_settings` invoke 허용
- `store:default` (위치 저장), `default.json`의 `windows`에 `"widget"` 포함

### 7) 위치 기억 — `tauri-plugin-store` (기존 의존성)
위젯 창 x/y를 `toggle_widget` 숨김 시 store에 저장, 표시 시 복원.
저장값이 없으면 기본 위치(우하단 근처)로 표시.

## 데이터 흐름
```
poller (백엔드) ──usage-updated 이벤트──▶ 메인 창 + 위젯 창 (동시 수신)
                                              │
get_usage invoke ◀── useUsageReport() ────────┘ (초기 로드 / 새로고침)
```
위젯은 메인과 같은 백엔드를 공유하므로 별도 폴링 없이 이벤트를 그대로 수신한다.

## 에러 처리
- provider 실패 시 기존 `LimitBar` / `mergeReport` 동작 그대로
  (일시적 실패는 마지막 스냅샷 유지)
- 위젯 초기 로드 실패 시 컴팩트한 에러 라인 표시
- 커맨드(`toggle_widget` 등)는 창이 없거나 실패해도 패닉 없이 `Result`/무시 처리

## 테스트
- `useUsageReport` 훅 단위 테스트 (vitest + testing-library `renderHook`):
  초기 로드, 이벤트 수신 시 갱신, reload 동작. `@tauri-apps/api` invoke/listen 모킹
- `WidgetApp` 렌더 테스트: 5개 막대 렌더, 새로고침/닫기 버튼 존재,
  본문 클릭 시 `show_main` invoke 호출 (기존 `App.test.tsx` 모킹 패턴 참고)
- Rust 커맨드는 기존 테스트 구조에 맞춰 가능한 범위에서 (창 조작은 통합성이라 스텁/생략)
- 육안 검증: `__TAURI_INTERNALS__` 스텁 필요 (메모리: 브라우저 육안 검증 참고)

## 완료 기준
1. 트레이 우클릭 메뉴 또는 메인 헤더 버튼으로 위젯을 표시/숨김할 수 있다
2. 위젯이 5개 막대와 리셋 카운트다운을 메인과 동일한 값으로 보여준다
3. 위젯이 항상 위에 뜨고, 드래그로 이동되며, 위치가 기억된다
4. 새로고침 버튼이 값을 갱신하고, × 로 닫히며, 본문 클릭 시 메인이 열린다
5. 위젯이 메인의 테마·언어 설정을 따른다
6. `npm test` 통과, `npm run build` + `cargo build` 성공
```
