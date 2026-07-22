# 자동 업데이트 + 설정 내 업데이트 — 설계 문서

- **이슈**: [#47 업데이트 기능](https://github.com/donghoon-bigvalue/token-usage-app/issues/47)
- **날짜**: 2026-07-22
- **상태**: 승인됨 (구현 대기)

## 목표

이슈 #47의 두 가지 요구를 충족한다.

1. **자동 업데이트**: 현재 버전보다 최신 버전이 나오면 팝업을 띄워 "새 버전이 나왔습니다"를 안내하고, `[자동 업데이트]` / `[다음에 하기]` 버튼을 제공한다. (Orca 유사 UX)
2. **설정 내 업데이트 버튼**: 현재 버전을 표시하고, "업데이트 확인" 버튼을 제공한다. 최신이면 "최신 버전을 사용 중입니다.", 아니면 업데이트를 진행할지 묻는 UX.

## 실현 가능성

가능하다. Tauri 2 공식 `tauri-plugin-updater`를 사용한다. 현재 배포 구조(GitHub Releases + `tauri-action`, `v*` 태그)와 호환된다.

## 결정 사항 (사용자 확정)

| 항목 | 결정 |
|------|------|
| 업데이트 엔드포인트 | **GitHub Releases 공개 + `latest.json`** (`releases/latest/download/latest.json`) |
| 자동 확인 시점 | **하루 1회** (앱 시작 시, 직전 확인이 24h 이내면 스킵) |
| "다음에 하기" 동작 | **이 버전은 다시 안 물음** (dismissedVersion 기억, 더 새 버전 나오면 재팝업) |
| OS 코드서명 | 이번 범위 **제외** (설치 경고 감수, 추후 별도 이슈) |
| Linux deb/rpm | 자동업데이트 미지원 → **문서화만** |

## 아키텍처

프론트에서 하나의 업데이트 상태머신을 관리하고, 두 진입점(시작 팝업 / 설정 버튼)이 이를 공유한다.

```
idle → checking → (up-to-date | available) → downloading(진행률) → ready → relaunch
                                            ↘ error
```

Tauri updater의 서명(minisign)은 OS 코드서명과 별개다. 서명 검증은 updater가 담당하고, 서명이 유효하지 않은 아티팩트는 설치를 거부한다.

## 구성 요소

### 백엔드 (`src-tauri`)

- **의존성 추가**: `tauri-plugin-updater`, `tauri-plugin-process`(재실행용). `Cargo.toml` + `lib.rs`에 플러그인 등록.
- **`tauri.conf.json`**:
  - `bundle.createUpdaterArtifacts: true` — 빌드 시 `.sig` 및 `latest.json` 생성.
  - `plugins.updater`:
    - `endpoints`: `["https://github.com/donghoon-bigvalue/token-usage-app/releases/latest/download/latest.json"]`
    - `pubkey`: 서명 공개키 (`tauri signer generate`로 생성).
- **`capabilities/default.json`**: `updater:default`, `process:allow-restart` 권한 추가.
- 커스텀 Rust 커맨드 불필요 — JS 플러그인 API로 check/download/install 수행.

### 프론트엔드 (`src`)

- **`src/lib/updater.ts`** — 순수 로직 계층. UI와 플러그인 사이를 매개한다.
  - `checkForUpdate()`: 플러그인 `check()` 래핑, 결과를 `{ available, version, notes, update }` 형태로 정규화.
  - `downloadAndInstall(update, onProgress)`: 진행률 콜백과 함께 다운로드·설치.
  - `relaunchApp()`: `@tauri-apps/plugin-process`의 `relaunch()`.
  - **스로틀**: `lastCheckAt`(store)로 24h 게이팅 — `shouldAutoCheck(now, lastCheckAt)`.
  - **dismiss 게이팅**: `dismissedVersion`(store) — `shouldPrompt(version, dismissedVersion)`.
  - 영속화는 기존에 쓰는 `@tauri-apps/plugin-store` 재사용.
  - 순수 함수(`shouldAutoCheck`, `shouldPrompt`)는 플러그인 의존 없이 단위 테스트 가능하게 분리.
- **`src/components/UpdateDialog.tsx`** — 모달 컴포넌트.
  - 표시: "새 버전 vX.Y.Z이 있습니다" + 릴리스 노트(있으면).
  - 버튼: `[자동 업데이트]`(다운로드·설치·재실행), `[다음에 하기]`(dismiss).
  - 다운로드 중: 진행률 바 + 취소 불가 상태 표시. 완료 시 재실행 안내.
  - 에러 시: 에러 문구 + 재시도 / GitHub 릴리스 페이지 열기.
- **`SettingsPanel.tsx`에 업데이트 섹션 추가**.
  - 현재 버전 표시 (`@tauri-apps/api/app`의 `getVersion()`).
  - "업데이트 확인" 버튼 → 수동 체크(스로틀·dismiss 무시).
  - 상태 문구: 확인 중 / "최신 버전을 사용 중입니다." / "업데이트가 있습니다 (vX.Y.Z)" + 설치 버튼.
- **`App.tsx`** — 마운트 시 `shouldAutoCheck` 통과하면 백그라운드 체크. `available && shouldPrompt`이면 `UpdateDialog` 오픈. 결과와 무관하게 `lastCheckAt` 갱신.

## 동작 규칙

| 진입점 | 24h 스로틀 | dismissed 버전 무시 |
|--------|:---:|:---:|
| 시작 시 자동 | 적용 | 적용 (다시 안 물음) |
| 설정 버튼 수동 | 무시 (항상 확인) | 무시 (항상 표시) |

"다음에 하기" → 해당 버전을 `dismissedVersion`에 저장. 더 새 버전이 나오면 값이 달라지므로 다시 팝업. 설정 버튼으로는 언제든 수동 설치 가능.

## CI / 인프라 (`release.yml`)

1. **키페어 생성** (로컬 1회): `npm run tauri signer generate -- -w ~/.tauri/token-usage-app.key`
   - 출력 공개키 → `tauri.conf.json`의 `plugins.updater.pubkey`에 커밋.
   - 개인키/비밀번호 → **GitHub Secrets에 사용자가 직접 등록**:
     - `TAURI_SIGNING_PRIVATE_KEY`
     - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
2. **`release.yml` 수정**: `tauri-action` 스텝에 서명 env 주입 + `includeUpdaterJson: true` 추가 → `latest.json`이 릴리스 자산으로 업로드.
3. **배포 흐름 유지**: 릴리스는 Draft로 생성되고, 유지관리자가 **publish하는 순간** `releases/latest`가 이를 가리켜 사용자에게 배포된다.

## 테스트

- **단위**: `updater.ts`의 순수 함수 — `shouldAutoCheck`(경계 24h), `shouldPrompt`(dismissed 일치/불일치/null), 버전 비교.
- **컴포넌트**: `UpdateDialog` 상태별 렌더(available/downloading/error), 버튼 콜백. 설정 섹션의 3상태(확인중/최신/있음). 플러그인은 목으로 대체.
- **i18n**: `ko.json`/`en.json`에 문구 키 추가, 기존 i18n 테스트 패턴 준수.

## 알려진 한계 (README/설정에 문서화)

- **Linux**: AppImage만 자동 업데이트. deb/rpm 사용자는 릴리스 페이지에서 수동 설치 안내.
- **OS 코드서명 미적용**: 설치 시 Windows SmartScreen / macOS Gatekeeper 경고 가능. updater 서명과는 별개이며 자동 업데이트 동작 자체엔 영향 없음. 추후 별도 이슈로 분리 권장.
- **개인키 Secret 등록**은 사용자(유지관리자) 몫. 명령어는 위 CI 섹션 참고.

## 범위 밖 (YAGNI)

- OS 코드서명/공증(notarization).
- deb/rpm 자동 업데이트.
- 델타(증분) 업데이트.
- 다중 릴리스 채널(stable/beta).
