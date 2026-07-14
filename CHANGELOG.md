# Changelog

이 프로젝트의 주요 변경 사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전 체계는 [유의적 버전(SemVer)](https://semver.org/lang/ko/)을 준수합니다.

## [Unreleased]

## [0.1.1] - 2026-07-14

배포·문서 개선 릴리스입니다.

### Added
- README에 다운로드 링크와 플랫폼별 설치 방법 안내 추가
- `CHANGELOG.md` 도입 (Keep a Changelog 형식)
- 릴리스 노트에 `CHANGELOG.md`의 해당 버전 섹션을 자동 반영하는 워크플로 연결

### Fixed
- 릴리스 워크플로의 Linux 빌드 의존성 apt 충돌 해결 및 Node 22로 상향

## [0.1.0] - 2026-07-14

Claude·Codex 구독 사용량을 데스크톱에서 한눈에 보여주는 첫 MVP 릴리스입니다.

### Added
- **Claude 사용량** — 현재 세션 / 주간(all models · Fable) 한도와 리셋 시각을 막대 바로 표시
- **Codex 사용량** — 주간 한도, GPT-5.3-Codex-Spark 주간 한도, 5시간 윈도우 표시
- **한도 임박 알림** — 임계치 교차를 감지해 시스템 알림 전송
- **자동·수동 새로고침** — 폴러 기반 자동 갱신 + 창 포커스 시 새로고침
- **시스템 트레이** — 트레이 아이콘으로 창 토글
- **다국어·테마** — 영어/한국어 전환, 다크/라이트 모드
- **리셋 카운트다운** — 24시간 초과 시 '일' 단위로 표시
- **GitHub Releases 자동화** — `v*` 태그 push 시 Windows·Linux 설치 파일을 빌드해 릴리스에 업로드하는 워크플로

### Changed
- 설정 패널 컨트롤 높이 정렬 및 닫기 버튼 정사각형화
- 다크 모드에서 언어·테마 드롭다운 가독성 개선

### Fixed
- Claude 사용량 조회 견고화 — 토큰 갱신, 일시적 오류 유지, 중복 호출 제거, 429 백오프
- provider 실패 격리 — 한쪽 조회 실패가 전체 화면을 막지 않음

### Security
- 보안 하드닝 — CSP 설정, 에러 메시지 일반화, 패닉 제거, 심링크 스킵

[Unreleased]: https://github.com/donghoon-bigvalue/token-usage-app/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/donghoon-bigvalue/token-usage-app/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/donghoon-bigvalue/token-usage-app/releases/tag/v0.1.0
