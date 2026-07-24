# 앱 아이콘 설계

- 이슈: [#59 앱의 아이콘 이미지 만들기](https://github.com/donghoon-bigvalue/token-usage-app/issues/59)
- 날짜: 2026-07-24

## 배경

`src-tauri/icons/`에 Tauri 스캐폴딩 기본 아이콘이 그대로 남아 있다. 설치 파일, 독,
작업표시줄, 시스템 트레이가 모두 이 아이콘을 쓰므로 앱을 대표하는 이미지로 교체한다.

스캐폴딩 잔재는 아이콘 외에도 남아 있다. `index.html`의 favicon은 `/vite.svg`를,
문서 제목은 `Tauri + React + Typescript`를 가리키고, `public/tauri.svg`와
`src/assets/react.svg`는 어디서도 참조되지 않는다. 아이콘을 교체하는 김에 같이 걷어낸다.

## 디자인

동심원 두 개로 이루어진 게이지. 바깥 링이 Claude, 안쪽 링이 Codex를 뜻하고 각 링의
채워진 호가 사용량을 나타낸다. 앱이 하는 일(두 서비스의 한도를 한눈에)이 형태 자체로
읽히고, 원형이라 macOS 독의 둥근 마스크와 Windows 사각 타일 양쪽에 모두 들어맞는다.

128×128 좌표계 기준:

| 요소 | 값 |
| --- | --- |
| 판 | 라운드 사각, `rx=28`, 세로 그라디언트 `#2E2E33` → `#141416` |
| 바깥 링 | 중심 (64, 64), `r=47`, 두께 14, 68% 채움, `#D97757` (Claude) |
| 안쪽 링 | 중심 (64, 64), `r=22`, 두께 14, 42% 채움, `#5162ED` (Codex) |
| 트랙 | `#3A3A3C` |
| 진행 방향 | 12시에서 시계 방향, 끝은 둥근 캡 |

채움 비율(68% / 42%)은 실제 사용량이 아니라 **두 링이 시각적으로 균형 잡히는 고정값**이다.
링 굵기를 키우고 두 링 사이 간격을 11px(128 기준)로 벌린 것은 16px로 줄었을 때 바깥
고리와 안쪽 심이 한 덩어리로 뭉치지 않게 하기 위한 조정이다.

검토 과정에서 두 줄 막대 게이지, 반원 계기판, 배터리 안(案)을 함께 비교했다. 막대는
앱 화면을 그대로 옮겨 안전하지만 평범했고, 계기판은 두 서비스를 나눠 담지 못하며 바늘이
작은 크기에서 가장 먼저 무너졌고, 배터리는 트레이에서 시스템 배터리 표시로 오해될 수
있었다. 배경은 어두운 판·투명·밝은 판을 밝고 어두운 독 위에 나란히 올려 비교한 뒤,
앱의 다크 UI와 인상이 이어지고 어느 배경에서도 실루엣이 버티는 어두운 판을 골랐다.

## 생성 파이프라인

손으로 그린 SVG가 원본이고 나머지는 전부 파생물이다. 색이나 비율을 바꿀 때 16개 파일을
손으로 맞추는 일이 없도록 재생성을 스크립트로 고정한다.

```
src-tauri/icons/source/app-icon.svg       컬러 마스터
src-tauri/icons/source/tray-template.svg  단색 마스터 (트레이용)
        │
        ▼  scripts/icons/render.ts  (Playwright Chromium)
   1024×1024 PNG
        │
        ▼  tauri icon
src-tauri/icons/*.png .ico .icns          번들 아이콘 세트
```

- `scripts/icons/render.ts` — SVG를 정해진 크기의 PNG로 렌더한다. 렌더러는 이미
  devDependency인 Playwright의 Chromium이므로 새 의존성이 없고, `scripts/screenshots/`와
  같은 패턴을 따른다.
- `npm run icons` — 렌더 후 `tauri icon`을 돌려 `src-tauri/icons/` 전체(각 크기 PNG,
  `icon.ico`, `icon.icns`, Windows Store 타일)를 재생성한다.
- 생성물은 빌드에 필요하므로 저장소에 커밋한다.

생성이 결정적이어야 한다. 같은 SVG로 `npm run icons`를 두 번 돌리면 산출물이 바이트
단위로 같아야 하고, 이는 검증 항목이다.

## 트레이 아이콘

지금은 `src-tauri/src/lib.rs`에서 `app.default_window_icon()`을 트레이에 그대로 쓴다.
Windows·Linux는 컬러 아이콘이 자연스럽지만, macOS 메뉴바는 단색 템플릿 아이콘이 관례라
컬러 아이콘은 주변과 어긋난다.

단색 마스터(`tray-template.svg`)를 따로 두고 트레이 아이콘 설정을 플랫폼별로 나눈다.

- macOS: 템플릿 아이콘을 쓰고 `icon_as_template(true)`로 표시한다. 템플릿 아이콘은
  색을 버리고 알파만 사용하므로, 트랙은 낮은 알파, 채워진 호는 불투명으로 두어 농담만으로
  두 값이 구분되게 그린다.
- 그 외 플랫폼: 지금처럼 창 아이콘을 재사용한다.

템플릿 아이콘은 `tauri icon`의 산출물이 아니므로 `render.ts`가 직접 만든다. macOS
메뉴바 기준 크기에 맞춰 `src-tauri/icons/tray/tray-template.png`(22×22)와
`tray-template@2x.png`(44×44) 두 장을 낸다.

아이콘이 없을 때 시작이 죽지 않도록 하는 기존의 방어(`if let Some(icon)`)는 유지한다.

**검증 공백**: 개발 환경이 WSL이라 macOS 메뉴바의 실제 모양은 확인할 수 없다. 컴파일과
코드 경로까지만 검증하고, 실물 확인이 남아 있다는 사실을 PR에 남긴다.

## 스캐폴딩 잔재 정리

| 파일 | 조치 |
| --- | --- |
| `index.html` | favicon을 `/app-icon.svg`로, 제목을 `Token Usage`로 변경 |
| `public/app-icon.svg` | 새로 추가 (favicon용, 컬러 마스터와 동일한 그림) |
| `public/vite.svg` | 삭제 |
| `public/tauri.svg` | 삭제 (참조 없음) |
| `src/assets/react.svg` | 삭제 (참조 없음). 디렉터리가 비면 함께 삭제 |
| `widget.html` | 손대지 않음 — 데코레이션 없는 창이라 favicon이 보일 자리가 없다 |

README 최상단 제목 줄에 아이콘을 함께 보인다. `render.ts`가 `docs/images/app-icon.png`
(128×128)를 함께 내고, README 제목을 그 이미지와 나란히 놓는다.

## 검증

아이콘은 시각물이라 단위 테스트의 대상이 아니다. 대신 다음을 확인한다.

- `npm run icons`를 두 번 돌려 산출물이 동일한지 (결정적 생성)
- 렌더된 16·32·128px PNG를 직접 열어 육안 확인 — 특히 16px에서 두 링이 분리되어 보이는지
- `npm test` 통과 (기존 테스트 회귀 없음)
- `cargo check` 통과 (트레이 코드 변경)
- `src-tauri/icons/`의 파일 목록이 교체 전과 같은지 — 누락된 크기가 있으면 특정 플랫폼
  빌드가 조용히 깨진다

## 범위 밖

- 앱 내부 UI에 아이콘을 쓰는 일 (헤더 로고 등)
- 스플래시 화면, 알림 아이콘
- 아이콘의 라이트/다크 변형 — 어두운 판 하나로 양쪽 배경을 감당한다
