# Token Usage App

Claude와 Codex를 구독제로 사용하는 사람을 위한 **Tauri 기반 데스크톱 앱**입니다.
두 서비스의 토큰/사용량 한도와 리셋 시각을 막대 바로 한눈에 보여줍니다.

- **Claude** (강조색 `#D97757`) — 현재 세션, 주간(all models / Fable) 한도와 리셋 시각
- **Codex** (강조색 `#5162ED`) — 주간 한도, GPT-5.3-Codex-Spark 주간 한도
- 다크/라이트 모드, 영어·한국어 전환, 한도 임박 알림, 수동·자동 새로고침, 시스템 트레이

스택: React + TypeScript + Vite (프런트엔드) / Rust + Tauri v2 (백엔드)

## 다운로드 및 설치

최신 설치 파일은 **[GitHub Releases](https://github.com/donghoon-bigvalue/token-usage-app/releases/latest)** 에서 내려받을 수 있습니다.

| 플랫폼 | 파일 | 설치 방법 |
| --- | --- | --- |
| **Windows** | `token-usage-app_<버전>_x64_en-US.msi` 또는 `..._x64-setup.exe` | 내려받아 실행 후 안내를 따릅니다. |
| **macOS (Intel·Apple Silicon 공용)** | `token-usage-app_<버전>_universal.dmg` | 열어서 앱을 `Applications` 폴더로 끌어다 놓습니다. (1.0.3 버전부터 제공) |
| **Linux (범용)** | `token-usage-app_<버전>_amd64.AppImage` | 실행 권한을 주고 바로 실행합니다. |
| **Linux (Debian·Ubuntu)** | `token-usage-app_<버전>_amd64.deb` | `sudo dpkg -i <파일>` 또는 `sudo apt install ./<파일>` |
| **Linux (Fedora·RHEL)** | `token-usage-app-<버전>-1.x86_64.rpm` | `sudo rpm -i <파일>` 또는 `sudo dnf install ./<파일>` |

### Linux — AppImage 실행

```bash
chmod +x token-usage-app_*_amd64.AppImage
./token-usage-app_*_amd64.AppImage
```

> **Windows 참고** — 코드 서명이 적용돼 있지 않아 첫 실행 시 SmartScreen 경고가 뜰 수 있습니다. **추가 정보 → 실행**을 눌러 진행하세요.
>
> **macOS 참고** — 코드 서명·공증(notarization)이 적용돼 있지 않아 첫 실행 시 *"확인되지 않은 개발자"* 경고가 뜹니다. 앱을 **우클릭(또는 Control-클릭) → 열기**로 실행하면 진행할 수 있습니다. 그래도 *"손상되었기 때문에 열 수 없습니다"* 라고 나오면, 터미널에서 격리 속성을 제거하세요:
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/token-usage-app.app
> ```

소스에서 직접 빌드하려면 아래 개발자 안내를 참고하세요.

## 사전 준비 (최초 1회)

### 1. Node 의존성

```bash
npm install
```

Node는 최신 LTS 이상을 권장합니다.

### 2. Rust 툴체인

[rustup](https://rustup.rs/)으로 Rust를 설치합니다. 설치 후 PATH에 `cargo`가 없다면:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

### 3. 시스템 라이브러리 (Linux / WSL2)

Ubuntu·Debian 계열에서는 Tauri 빌드에 다음 패키지가 필요합니다:

```bash
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf libxdo-dev libssl-dev
```

> **WSL2 참고**
> - Homebrew의 `pkg-config`가 시스템 것을 가려 빌드가 깨질 수 있어, `src-tauri/.cargo/config.toml`에 `PKG_CONFIG_PATH`가 커밋되어 있습니다. 이 설정이 적용되려면 **cargo/Tauri 명령을 항상 프로젝트 루트에서** 실행하세요 (`--manifest-path`로 우회하면 깨집니다).
> - WSLg에서 실행 시 `libEGL`/`MESA`/`Gtk-CRITICAL` 경고가 뜰 수 있지만 소프트웨어 렌더링에 따른 것으로 무시해도 됩니다.

macOS·Windows는 Tauri [사전 준비 문서](https://tauri.app/start/prerequisites/)를 참고하세요.

## 실행

### 개발 모드 (데스크톱 창)

```bash
npm run tauri dev
```

### 프런트엔드만 (브라우저)

```bash
npm run dev        # http://localhost:1420
```

## 빌드

```bash
npm run tauri build
```

실행 파일과 설치 번들(`.deb`/`.rpm`/AppImage)이 `src-tauri/target/release/bundle/` 아래에 생성됩니다.

> **WSL2 참고 — 번들 단계 `PKG_CONFIG_PATH`**
> Homebrew의 `pkg-config`가 시스템 것을 가리는 환경에서는, `libayatana-appindicator3-dev`가 설치돼 있어도 번들 단계에서 `Can't detect any appindicator library` 오류가 날 수 있습니다. `src-tauri/.cargo/config.toml`의 `PKG_CONFIG_PATH`는 cargo가 스폰하는 프로세스에만 적용되고 번들링을 수행하는 `tauri-cli`(npm) 프로세스에는 적용되지 않기 때문입니다. 빌드 셸에 직접 지정하세요:
>
> ```bash
> export PKG_CONFIG_PATH="/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig:/usr/lib/pkgconfig"
> npm run tauri build
> ```

## 테스트

```bash
npm test           # vitest 1회 실행
npm run test:watch # 워치 모드
```

## 문서

- 설계 문서: `docs/superpowers/specs/2026-07-14-token-usage-app-design.md`
- 구현 계획: `docs/superpowers/plans/2026-07-14-token-usage-app.md`

## 권장 IDE 설정

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
