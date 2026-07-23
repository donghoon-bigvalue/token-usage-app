# 업데이트 서명 키 · 릴리스 셋업 (유지관리자용)

자동 업데이트는 minisign 서명으로 검증됩니다. 릴리스 CI가 설치 파일에 서명하고
`latest.json`을 만들려면 아래 셋업이 되어 있어야 합니다.

## 최초 1회 셋업

1. 서명 키페어 생성

   ```bash
   npm run tauri signer generate -- -w ~/.tauri/token-usage-app.key
   ```

2. 출력된 **Public key**를 `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에 반영합니다.
   이 값이 어긋나면 기존 사용자의 앱이 서명 검증에 실패합니다.

3. GitHub Actions 시크릿 등록

   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/token-usage-app.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # 키 생성 시 비밀번호를 안 걸었으면 빈 값
   ```

## 릴리스 전 체크리스트

태그를 push하고 나면 되돌리기 번거로우니 아래를 먼저 맞춥니다.

1. **버전을 네 곳에서 같이 올립니다.** 전용 릴리스 스크립트는 없고 수동 bump입니다.

   - `package.json` — `"version": "X.Y.Z"`
   - `src-tauri/tauri.conf.json` — `"version": "X.Y.Z"`
   - `src-tauri/Cargo.toml` — `[package]` 섹션의 `version = "X.Y.Z"`
   - `package-lock.json` — `npm install --package-lock-only`로 갱신 (2군데)

   `create-release` 잡은 태그를 `tauri.conf.json`·`package.json` 두 곳하고만 대조합니다.
   `Cargo.toml`이나 lock 파일이 어긋나도 워크플로는 초록불로 지나갑니다.

2. **테스트를 로컬에서 돌립니다.** CI에는 테스트 잡이 없고 빌드 실패 자체가 게이트입니다.

   ```bash
   npm test
   cd src-tauri && cargo test   # WSL에서는 시스템 라이브러리 필요
   ```

3. **`CHANGELOG.md`에 `## [X.Y.Z]` 섹션**과 하단 링크 참조(`[X.Y.Z]: .../compare/...`)를 추가합니다.
   `create-release` 잡이 그 헤딩 아래를 릴리스 본문으로 뽑습니다. 섹션이 없어도 실패하지는 않고
   "CHANGELOG.md를 참고하세요" 한 줄로 대체되므로, 맹탕 릴리스 노트가 조용히 나갑니다.

4. **`gh secret list`로 서명 시크릿 두 개가 있는지 확인합니다.** 없으면 세 플랫폼 잡이
   빌드를 다 돌린 뒤에야 터집니다(아래 "흔한 실패" 참고).

## 릴리스 흐름

`v*` 태그를 push하면 `.github/workflows/release.yml`이 잡 3개를 순서대로 돌립니다.

1. `create-release` — 태그와 앱 버전이 같은지 확인하고 **Draft** 릴리스를 하나 만듭니다.
2. `build` — Windows·Linux·macOS를 빌드해 **그 릴리스에만** 서명된 설치 파일과
   `latest.json`을 올립니다.
3. `verify` — 자산 14개와 `latest.json`의 플랫폼 키 11개가 모두 있는지 확인합니다.

세 잡이 모두 초록불이면 내용을 확인한 뒤 릴리스를 **Publish**해야 사용자에게 업데이트가
배포됩니다. 게시 전에 직접 확인하려면:

```bash
scripts/verify-release-assets.sh v1.0.7
```

앱이 조회하는 엔드포인트는 다음 한 곳입니다.

```
https://github.com/donghoon-bigvalue/token-usage-app/releases/latest/download/latest.json
```

## 흔한 실패

- **시크릿 미설정 / 비밀번호 불일치** — 3개 플랫폼 잡이 모두 다음 오류로 실패합니다.

  ```
  failed to decode secret key: incorrect updater private key password: Missing comment in secret key
  ```

  Rust 빌드를 6~7분 다 돌린 뒤 번들 단계에서 터지므로 늦게 발견됩니다.
  복구는 위 `gh secret set`을 다시 실행한 뒤 `gh run rerun <run-id> --failed`.

- **자산이 여러 Draft로 갈림** — v1.0.6까지는 빌드 잡이 각자 릴리스를 만들 수 있어
  자산이 두 Draft로 나뉘었습니다([#54](https://github.com/donghoon-bigvalue/token-usage-app/issues/54)).
  잡은 모두 success라 눈에 띄지 않고, `latest.json`에 빠진 플랫폼은 자동 업데이트가
  조용히 멈춥니다. 지금은 `create-release` 잡이 릴리스를 하나만 만들고 `verify` 잡이
  자산 구성을 확인하므로, 같은 일이 생기면 워크플로가 빨간불로 알려 줍니다.
  이미 갈린 뒤라면 한쪽으로 자산을 모으고 `latest.json`의 `platforms` 맵을 합친 뒤
  나머지 Draft를 지우세요.

- **개인키 분실** — 기존 사용자에게 업데이트를 내보낼 수 없습니다. pubkey를 바꾼 새 빌드는
  구버전이 서명 검증에 실패하므로 수동 재설치를 안내해야 합니다. 키 파일을 백업해 두세요.

## 알려진 한계

- **Linux**: AppImage만 자동 업데이트를 지원합니다. `.deb`/`.rpm` 사용자는 릴리스 페이지에서
  수동으로 새 버전을 내려받아야 합니다.
- **OS 코드서명 미적용**: 설치·실행 시 Windows SmartScreen 또는 macOS Gatekeeper 경고가
  나타날 수 있습니다. 업데이트 서명(minisign)과는 별개이며 자동 업데이트 동작에는 영향을
  주지 않습니다.
