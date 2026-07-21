# README UI 스크린샷 · 투어 GIF 설계

- 이슈: [#40 README에 UI 샘플 보여주기](https://github.com/donghoon-bigvalue/token-usage-app/issues/40)
- 날짜: 2026-07-21
- 상태: 승인됨 (구현 대기)

## 배경 / 목표

이슈 #40은 "README에 제품 화면 스크린샷이나 짧은 사용 영상이 들어가면 좋겠다"는 요청이다.
현재 README는 텍스트만으로 기능을 설명하고 있어, 저장소 방문자가 앱이 실제로 어떻게 생겼는지
알 수 없다. 릴리스 파일을 내려받기 전에 화면을 먼저 보여주는 것이 목표다.

부차 목표: 버전이 올라가 UI가 바뀌면 **명령 한 번으로 이미지를 다시 만들 수 있어야** 한다.
수작업 캡처는 시간이 지나면 실제 화면과 어긋나고, 어긋난 스크린샷은 없느니만 못하다.

## 범위

**포함**
- 재현 가능한 캡처 하네스 (`scripts/screenshots/`) + `npm run screenshots`
- PNG 4장: 메인 창(다크), 미니 위젯, 월별 사용 기록, 설정 패널
- 투어 GIF 1개 (약 10초): 메인 → 사용 기록 → 설정(영어 전환) → 위젯
- README 상단 `## 화면` 섹션 신설

**제외 (YAGNI)**
- 실제 OS 창에서의 네이티브 캡처 (WSL 환경 렌더링 제약, 그리고 자동 재생성 불가)
- 라이트 모드 정지 스크린샷 (투어 GIF의 테마 전환으로 대체)
- CI에서의 스크린샷 자동 갱신·회귀 비교 (시각 회귀 테스트는 별도 관심사)
- README 영문판

## 접근법 결정

캡처 소스로 **브라우저 픽스처 자동 캡처**를 택한다.

프런트엔드는 `@tauri-apps/api`의 `invoke`/`listen`을 통해서만 백엔드와 통신하고, 이 둘은
전부 `window.__TAURI_INTERNALS__` 위에 얹혀 있다. 따라서 그 객체 하나만 스텁하면 Rust 백엔드도,
실제 Claude/Codex 계정도 없이 `npm run dev`가 띄운 페이지를 그대로 촬영할 수 있다.

- 장점: 고정 픽스처 → 매번 같은 그림, 계정 정보 유출 없음, 명령 한 번으로 재생성
- 단점: OS 창 테두리가 없다 → 캡처 셸 CSS로 둥근 모서리·그림자·여백을 입혀 보완
- 대안(사용자 수동 캡처)은 진짜 창 모습이라는 이점이 있으나 재생성이 사람 손에 묶인다.
  나중에 실제 캡처 파일이 생기면 **같은 경로로 교체**하면 되므로 이 선택은 되돌릴 수 있다.

## 아키텍처

### 캡처 하네스

```
scripts/screenshots/
  fixtures.ts     데모용 UsageReport / Settings / UsageHistory 고정 데이터
  tauri-stub.ts   window.__TAURI_INTERNALS__ 목 구현 (문자열로 주입됨)
  shell.css       창처럼 보이게 하는 둥근 모서리·그림자·배경 여백
  capture.ts      Playwright로 PNG 4장 + 투어 webm 촬영 → ffmpeg으로 GIF 변환
```

`src/` 프로덕션 코드는 수정하지 않는다. 스텁은 Playwright의 `addInitScript`로 페이지 스크립트보다
먼저 주입되므로, 앱 부트스트랩 시점에는 이미 `__TAURI_INTERNALS__`가 준비돼 있다.

### 스텁이 처리해야 하는 커맨드

| 커맨드 | 응답 |
| --- | --- |
| `get_usage` | 픽스처 `UsageReport` |
| `get_settings` / `set_settings` | 픽스처 `Settings` (set은 인자를 반영해 반환) |
| `get_usage_history` | 픽스처 `UsageHistory` |
| `plugin:event\|listen`, `plugin:event\|unlisten` | no-op (구독만 성립시키면 됨) |
| `plugin:window\|*` (위젯의 `setSize`, `hide`) | no-op |
| `toggle_widget`, `show_main` | no-op |

미처리 커맨드는 조용히 `undefined`를 반환하지 않고 **콘솔에 경고를 남긴다.** 스텁 누락으로
빈 화면이 찍히는 사고를 캡처 단계에서 잡기 위해서다.

### 픽스처 데이터 원칙

- 실제 계정·토큰·경로가 드러나지 않는 가공값만 사용한다.
- 막대가 전부 0%거나 전부 100%면 UI가 못생기므로, 한도별로 서로 다른 중간값을 준다.
- `resets_at`은 **캡처 시각 기준 상대 오프셋**으로 계산해 카운트다운이 항상 그럴듯하게 보이도록 한다.
- 두 provider 모두 `error: null`, `source: "live"` — README용 그림에는 정상 상태만 담는다.

### 투어 GIF

위젯은 별도 페이지(`widget.html`)라 메인과 한 화면에 동시에 담기지 않는다. 투어에서는 캡처
하네스가 메인 페이지 위에 `widget.html`을 iframe으로 띄워 실제 사용 모습처럼 합성한다.

Playwright는 webm으로 녹화하고, ffmpeg의 `palettegen`/`paletteuse` 2-pass로 GIF를 만든다.
목표 용량 3MB 이하 — 초과하면 프레임레이트(기본 12fps)나 폭(기본 720px)을 낮춘다.

## 산출물 및 README 배치

`docs/images/` 아래에 둔다.

| 파일 | 내용 |
| --- | --- |
| `main-dark.png` | 메인 창 · 다크 · 한국어 (히어로) |
| `tour.gif` | 10초 투어 |
| `widget.png` | 미니 위젯 창 |
| `history.png` | 월별 사용량·비용 뷰 |
| `settings.png` | 설정 패널 열린 상태 |

README는 소개 문단과 다운로드 섹션 사이에 `## 화면` 섹션을 새로 넣는다. 히어로 PNG와 GIF를
먼저 보이고, 나머지 3장은 `<details>`로 접어 README 길이를 유지한다. 이미지는 저장소 상대 경로로
참조한다 (릴리스 페이지·포크에서도 깨지지 않는다).

## 오류 처리

- `npm run dev` 서버가 이미 떠 있으면 재사용하고, 없으면 캡처 스크립트가 직접 띄웠다가 정리한다.
- ffmpeg이 없으면 GIF 단계에서 명확한 안내 메시지와 함께 실패한다 (PNG는 이미 저장된 뒤).
- 페이지 콘솔 오류나 미처리 커맨드 경고가 있으면 캡처를 실패로 처리한다 — 조용히 깨진 그림을
  커밋하는 것이 최악의 결과다.

## 테스트 전략

이 작업의 산출물은 이미지라, 단위 테스트의 대상이 아니다. 검증은 다음으로 한다.

1. `npm test`가 여전히 통과한다 (프로덕션 코드 무수정이므로 회귀 없음).
2. `npm run screenshots`가 오류 없이 끝나고 5개 파일이 모두 생성된다.
3. 생성된 PNG를 직접 열어 **육안으로** 확인한다 — 스켈레톤·에러 화면·빈 화면이 찍히지
   않았는지, 한국어로 렌더됐는지, 다크 모드인지.
4. GIF 용량이 3MB 이하인지 확인한다.

## 리스크

- **Playwright devDependency 추가** — 브라우저 바이너리는 로컬 캐시에 이미 있고, 릴리스
  워크플로(`.github/workflows/release.yml`)는 `npm ci` 후 `tauri build`만 하므로 빌드·릴리스
  경로에는 영향이 없다.
- **UI 변경 시 스텁이 낡을 위험** — 새 커맨드가 추가되면 캡처가 경고와 함께 실패하므로,
  조용히 틀린 그림이 나오는 대신 눈에 띄게 깨진다.
