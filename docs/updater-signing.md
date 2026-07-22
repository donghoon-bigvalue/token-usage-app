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

## 릴리스 흐름

`v*` 태그를 push하면 `.github/workflows/release.yml`이 Windows·Linux·macOS 빌드를 돌려
서명된 설치 파일과 `latest.json`을 **Draft** 릴리스에 올립니다. 내용을 확인한 뒤 릴리스를
**Publish**해야 사용자에게 업데이트가 배포됩니다.

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

- **릴리스 전 점검** — `gh secret list`로 두 시크릿이 모두 있는지 먼저 확인하세요.

- **개인키 분실** — 기존 사용자에게 업데이트를 내보낼 수 없습니다. pubkey를 바꾼 새 빌드는
  구버전이 서명 검증에 실패하므로 수동 재설치를 안내해야 합니다. 키 파일을 백업해 두세요.

## 알려진 한계

- **Linux**: AppImage만 자동 업데이트를 지원합니다. `.deb`/`.rpm` 사용자는 릴리스 페이지에서
  수동으로 새 버전을 내려받아야 합니다.
- **OS 코드서명 미적용**: 설치·실행 시 Windows SmartScreen 또는 macOS Gatekeeper 경고가
  나타날 수 있습니다. 업데이트 서명(minisign)과는 별개이며 자동 업데이트 동작에는 영향을
  주지 않습니다.
