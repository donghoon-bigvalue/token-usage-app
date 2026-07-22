# 강제 업데이트 (Forced Update) Design

**Issue:** [#49 강제 업데이트 기능](https://github.com/donghoon-bigvalue/token-usage-app/issues/49)

## 문제

치명적 버그·호환성 깨짐 등으로 구버전을 더 이상 쓰게 두면 안 되는 릴리스가 나올 수 있다.
현재 업데이트 팝업은 "다음에 하기"로 닫을 수 있고, 닫으면 그 버전은
`updater.dismissedVersion`에 기록돼 다시 뜨지 않는다. 즉 사용자가 구버전에
무기한 머무를 수 있다.

## 요구사항 (이슈 원문)

- 강제 업데이트가 필요한 경우 **닫을 수 없는 팝업**을 띄운다.
- 팝업에서 [릴리스 페이지](https://github.com/donghoon-bigvalue/token-usage-app/releases)로
  이동하는 버튼을 제공해 최신 버전을 직접 받도록 유도한다.

## 설계

### 1. 강제 여부 신호 — 릴리스 노트 마커

새 서버/인프라 없이, **릴리스 노트 본문의 마커**로 강제 여부를 전달한다.

- `latest.json`의 `notes`는 릴리스 워크플로가 `CHANGELOG.md`의 해당 버전 섹션에서
  그대로 뽑아 넣는다(`.github/workflows/release.yml`의 `Extract release notes` 스텝).
  즉 CHANGELOG에 마커 한 줄을 넣는 것만으로 배포 파이프라인 변경 없이 전달된다.
- 플러그인 `check()`가 돌려주는 `update.body`에 마커가 있으면 강제 업데이트로 본다.

인식하는 마커 (대소문자 무시, `force-update`/`force_update`/`force update` 허용):

| 형태 | 용도 |
| --- | --- |
| `<!-- force-update -->` | 권장. GitHub 릴리스 페이지에서 보이지 않음 |
| `[force-update]` | 릴리스 노트에 명시적으로 드러내고 싶을 때 |

`isForcedUpdate(notes)`는 `updater.ts`의 순수 함수로 두어 단위 테스트한다.
결과는 `UpdateInfo.forced: boolean`으로 정규화되어 UI까지 흐른다.

**대안 검토**: 별도 `minimum-version.json` 호스팅 — 새 엔드포인트·릴리스 절차·오프라인
실패 경로가 늘어난다. 마커 방식은 기존 latest.json 페이로드에 얹히므로 추가 실패 지점이 없다.

### 2. 상태 흐름

- `UpdateInfo`에 `forced` 추가 → `available`/`downloading` 상태에서 그대로 읽을 수 있다.
- `error` 상태는 `info`를 담지 않으므로 `forced: boolean`을 별도 필드로 실어,
  설치 실패 후에도 "나중에"가 살아나지 않게 한다.
- `useUpdater.dismiss()`는 강제 업데이트일 때 **no-op**. UI가 버튼을 감추는 것과
  별개로 훅 레벨에서도 막아, 다른 진입점이 실수로 dismiss하지 못하게 한다.
- `shouldPrompt(version, dismissedVersion, forced)`는 `forced`면 dismissed 기록을
  무시하고 항상 true. 강제 릴리스 이전에 같은 버전을 dismiss한 적이 있어도 다시 뜬다.

### 3. 다이얼로그

강제 모드(`forced === true`)일 때:

- 제목: "업데이트가 필요해요" / "Update required"
- 본문: 이 버전은 더 이상 쓸 수 없고 v{version}으로 올려야 한다는 안내
- 버튼: **다운로드 페이지 열기**(primary, `openUrl(RELEASES_URL)`) + **자동 업데이트**
  - 다운로드 페이지를 primary로 둔다. 인앱 업데이터 자체가 문제여서 강제 릴리스를
    내는 상황도 있어, 항상 동작하는 경로를 먼저 제시한다.
- "다음에 하기" 버튼 없음 (`available`, `error` 양쪽). 백드롭 클릭·Esc로 닫히는
  경로는 원래부터 없다.
- 설치 실패(`error`) 시에도 "다시 시도" + "다운로드 페이지 열기"만 제공.

일반 모드 UI는 그대로다.

### 4. 범위 밖

- 하루 1회 자동 확인 스로틀(`shouldAutoCheck`)은 그대로 둔다. 강제 릴리스도 다음 확인
  시점에 발견된다 — 최대 24시간 지연. 스로틀을 없애면 매 실행마다 네트워크를 타므로
  현 시점에는 트레이드오프를 유지한다.
- 구버전 실행 차단(오프라인에서도 막기)은 하지 않는다. 마커는 업데이트 확인에
  성공해야 읽히므로, 강제 팝업은 온라인 상태에서만 뜬다.

## 운영 방법

강제 릴리스를 낼 때 `CHANGELOG.md`의 해당 버전 섹션 아무 곳에나 한 줄 넣는다:

```markdown
## [1.2.0] - 2026-08-01

<!-- force-update -->

### Fixed
- ...
```
