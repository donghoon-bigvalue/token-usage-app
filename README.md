# Token Usage App

Claude와 Codex를 구독제로 사용하는 사람을 위한 **Tauri 기반 데스크톱 앱**입니다.
두 서비스의 토큰/사용량 한도와 리셋 시각을 막대 바로 한눈에 보여줍니다.

- **Claude** (강조색 `#D97757`) — 현재 세션, 주간(all models / Fable) 한도와 리셋 시각
- **Codex** (강조색 `#5162ED`) — 주간 한도, GPT-5.3-Codex-Spark 주간 한도, 5시간 윈도우
- 다크/라이트 모드, 영어·한국어 전환, 한도 임박 알림, 수동·자동 새로고침, 시스템 트레이

스택: React + TypeScript + Vite (프런트엔드) / Rust + Tauri v2 (백엔드)

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

실행 파일과 설치 번들이 `src-tauri/target/release/` 아래에 생성됩니다.

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
