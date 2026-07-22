# 강제 업데이트 (Forced Update) Design

**Issue:** [#49 강제 업데이트 기능](https://github.com/donghoon-bigvalue/token-usage-app/issues/49)

## 문제

치명적 버그·호환성 깨짐 등으로 구버전을 더 이상 쓰게 두면 안 되는 상황이 생길 수 있다.
현재 업데이트 팝업은 "다음에 하기"로 닫을 수 있고, 닫으면 그 버전은
`updater.dismissedVersion`에 기록돼 다시 뜨지 않는다. 즉 사용자가 구버전에
무기한 머무를 수 있다.

## 요구사항 (이슈 원문)

- 강제 업데이트가 필요한 경우 **닫을 수 없는 팝업**을 띄운다.
- 팝업에서 [릴리스 페이지](https://github.com/donghoon-bigvalue/token-usage-app/releases)로
  이동하는 버튼을 제공해 최신 버전을 직접 받도록 유도한다.

## 설계

### 1. 강제 여부 신호 — 별도 config 저장소의 raw JSON

정책은 **앱 릴리스와 분리된 공개 저장소**의 JSON 파일 하나로 관리한다.

```
https://raw.githubusercontent.com/donghoon-bigvalue/token-usage-app-config/main/force-update.json
```

```json
{
  "minimumVersion": "1.0.5",
  "message": {
    "ko": "더 안정적인 서비스 제공을 위해 최신 버전으로의 업데이트가 필요합니다. 업데이트 후 이용해 주세요.",
    "en": "Please update to the latest version for a more reliable experience. Update to continue using the app."
  }
}
```

- **핵심 가치는 사후 킬 스위치**다. 이미 배포된 버전을 나중에 막을 수 있어야 하며,
  그러려면 신호가 릴리스 산출물 바깥에 있어야 한다. 파일 한 줄을 고쳐 push하면
  새 릴리스 없이 정책이 바뀐다.
- `minimumVersion` 미만이면 강제. `message`는 선택 — 없으면 앱 내장 문구를 쓴다.
  상황별 안내를 즉석에서 바꿀 수 있도록 열어 뒀다.
- 모르는 필드는 무시한다 — 정책 파일이 앞서 나가도 구버전 앱이 깨지지 않는다.
- 평시에도 파일은 존재하게 두고 `minimumVersion`을 `0.0.0`으로 유지한다.
  404 분기에 의존하는 것보다 실수가 적다.

**대안 검토 (기각)**: 릴리스 노트에 `<!-- force-update -->` 마커를 넣는 방식. 추가 인프라가
없다는 장점이 있지만 **이미 나간 버전을 사후에 막을 수 없다**(latest.json 자산을 손으로
다시 올려야 함). 킬 스위치가 목적이므로 기각.

**비용**: 프론트에서 raw를 부르려면 CSP `connect-src`에
`https://raw.githubusercontent.com`을 추가해야 한다. Rust 커맨드 + HTTP 클라이언트
의존성보다 이쪽이 훨씬 적은 변경이다.

### 2. fail-open

오프라인·404·JSON 파싱 실패·5초 타임아웃 — **어떤 실패든 "강제 없음"으로 간주**한다.
버전 문자열이 해석되지 않을 때도 마찬가지. 네트워크 사고로 앱을 못 쓰게 만드는 쪽이
구버전을 잠시 더 쓰게 두는 것보다 나쁘다.

### 3. 확인 시점 — 정책은 매 시작, 업데이트 확인은 하루 1회

- `fetchForcePolicy()`는 **스로틀 없이 매 시작** 호출한다. 하루 1회 스로틀에 태우면
  킬 스위치가 최대 24시간 늦게 도달해 존재 의미가 없다. 수백 바이트 요청 하나다.
- 강제가 걸리면 `check()`도 **스로틀을 무시하고** 이어서 실행한다. 그래야 인앱 설치
  버튼을 줄 수 있다.
- 강제가 아니면 기존대로 하루 1회 확인.
- raw CDN은 `cache-control: max-age=300`이라 최대 5분 지연이 있다(허용). 브라우저
  캐시까지 얹히지 않도록 `cache: "no-store"`로 요청한다.

### 4. 상태 흐름

```
enforce()
  ├─ 정책 없음/미달 ─────────────────→ false (기존 스로틀 경로로)
  └─ minimumVersion 미달 → check()
       ├─ 업데이트 있음 → available + force
       ├─ 업데이트 없음 → blocked          ← 인앱으로 받을 게 없음
       └─ 확인 실패     → blocked
```

- `force` 필드의 **존재 자체가 "닫을 수 없음"** 을 뜻한다. 켜지면 세션 내내 유지되어
  이후 전이(`downloading`, `error`)에도 실린다.
- **`blocked`** 는 강제인데 인앱 설치 경로가 없는 상태다. `minimumVersion`을 아직
  퍼블리시되지 않은 버전으로 올리는 실수, 또는 업데이트 확인 실패에서 발생한다.
  이 경우 다운로드 페이지만 안내한다.
- `useUpdater.dismiss()`는 강제일 때 **no-op**. UI가 버튼을 감추는 것과 별개로 훅
  레벨에서도 막아, 다른 진입점이 실수로 dismiss하지 못하게 한다.
- `shouldPrompt(version, dismissedVersion, forced)`는 `forced`면 dismissed 기록을
  무시하고 항상 true.

### 5. 다이얼로그

| | 일반 | 강제(`available`) | 강제(`blocked`) |
| --- | --- | --- | --- |
| 제목 | 업데이트 가능 | 업데이트가 필요해요 | 업데이트가 필요해요 |
| 본문 | 새 버전 v… | 정책 문구 + 새 버전 v… | 정책 문구 |
| 버튼 | `[자동 업데이트]` `[다음에 하기]` | **`[다운로드 페이지 열기]`** `[자동 업데이트]` | **`[다운로드 페이지 열기]`** |

다운로드 페이지를 primary로 둔다 — 인앱 업데이터 자체가 문제여서 강제를 거는 상황도
있어, 항상 동작하는 경로를 먼저 제시한다. 백드롭 클릭·Esc로 닫히는 경로는 원래 없다.

## 범위 밖

- 오프라인 사용자 차단. 정책은 온라인에서만 읽히므로 강제 팝업도 온라인에서만 뜬다.
  구버전 실행 자체를 막는 기능이 아니다.
- 정책 서명. `latest.json`의 `notes`와 마찬가지로 TLS 신뢰에만 의존한다. 업데이트
  아티팩트의 minisign 서명 검증은 그대로 유지된다.

## 운영 규칙

1. **`minimumVersion`은 이미 퍼블리시된 릴리스 이하로만 올린다.** 더 높이면 사용자는
   받을 것이 없는 `blocked` 팝업에 갇힌다.
2. config 저장소는 **public 유지**. private으로 바꾸면 raw가 인증을 요구해 정책이 즉시
   무력화된다(fail-open이라 앱은 정상 동작).
3. 저장소·경로 이름은 앱 바이너리에 박히므로 바꾸지 않는다.
