# Changelog

이 프로젝트의 주요 변경 사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전 체계는 [유의적 버전(SemVer)](https://semver.org/lang/ko/)을 준수합니다.

## [Unreleased]

## [1.0.1] - 2026-07-16

로딩 화면을 다듬고, 로딩이 끝나지 않을 때 앱이 침묵하던 문제를 고쳤습니다.

### Changed
- **로딩 표시를 스켈레톤·스피너로 교체** — `…` 글자나 빈 화면 대신, 실제 카드·표와 같은 모양의 자리표시자가 부드럽게 반짝입니다
  - 콜드 로드 → 스켈레톤 / 새로고침 → 기존 내용을 유지한 채 버튼 아이콘 회전
  - 데이터가 도착해도 화면이 튀지 않도록 자리표시자가 실제 크기를 미리 확보합니다
  - 라이트·다크 테마 자동 대응, 시스템의 "동작 줄이기" 설정 존중
- 헤더의 갱신 시각이 불러오는 중일 때만 반짝이고, 시각이 없는 경우엔 그대로 `—`로 표시됩니다
- Excel 다운로드 버튼에 진행 표시가 생겼습니다

### Fixed
- **한도를 불러오지 못하면 아무 안내 없이 빈 화면이던 문제** — 실패 사유를 표시합니다
- 리셋 시각이 없는 한도 항목(예: Codex Spark)에서 카드 높이가 어긋나던 문제
- 사용 이력 탭에서 새로고침 도중 탭을 옮기면 진행 표시가 잘못 남던 문제

### Internal
- 릴리스 워크플로에 태그별 concurrency 그룹 추가 — 같은 태그로 워크플로가 중복 실행되어 자산 업로드가 충돌하는 것을 방지 (#21)
- GitHub에 남아 있던 `.omc` 툴링 상태 파일 추적 해제 (#22)

## [1.0.0] - 2026-07-16

월별 토큰 사용량·비용 추정 기능을 더한 첫 정식 릴리스입니다.

### Added
- **월별 사용 이력 탭** — Claude·Codex의 월별 토큰 사용량과 API 요금 기준 추정 비용을 표로 표시
- **이번 달 요약 카드** — 서비스별 이번 달 토큰·비용을 한눈에 확인
- **Excel(.xlsx) 다운로드** — 모델별 상세 내역을 워크북으로 내보내기
  - `Usage`(영문)·`사용량`(한국어) 2개 시트, 수치는 동일
  - 검은 배경 헤더, (월 × 서비스) 그룹별 회색 합계행
- 로컬 로그(`~/.claude`, `~/.codex`) 스캔 기반 사용량 집계 — 네트워크 호출 없음
- 모델별 공개 API 단가 테이블과 캐시 토큰을 반영한 비용 계산

### Changed
- 새로고침 버튼을 헤더 하나로 일원화 — 열린 탭에 따라 한도/이력 갱신
- 헤더의 "갱신" 시각을 탭별로 분리 (한도=스냅샷 시각, 이력=스캔 시각)
- 헤더 레이아웃을 제목+탭 / 액션 두 그룹으로 정리하고 콘텐츠 폭 확대

### Fixed
- 내보내기·스캔 실패가 아무 표시 없이 사라지던 문제 — 사유와 함께 표시
- 토큰·비용에 천단위 구분자가 적용되지 않던 문제
- 사용 이력을 불러오지 못했을 때 "사용 기록이 없어요"로 잘못 표시되던 문제

### Notes
- 비용은 공개 API 요금 기준 **추정치**로, 구독제 실제 청구액과 무관합니다.
- Fable 단가는 공식 요금 공개 전까지 추정값을 사용합니다.

## [0.1.2] - 2026-07-14

Codex 사용량 조회 개선 릴리스입니다.

### Added
- Codex app-server를 통한 실시간 주간·Spark 주간 한도 조회
- app-server를 사용할 수 없는 환경을 위한 rollout 데이터 fallback

### Changed
- Codex 카드에서 제공되지 않는 5시간 한도 표시 제거
- Codex CLI 응답의 계정별 quota window 구조를 기준으로 한도 매핑

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

[Unreleased]: https://github.com/donghoon-bigvalue/token-usage-app/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/donghoon-bigvalue/token-usage-app/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/donghoon-bigvalue/token-usage-app/compare/v0.1.2...v1.0.0
[0.1.2]: https://github.com/donghoon-bigvalue/token-usage-app/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/donghoon-bigvalue/token-usage-app/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/donghoon-bigvalue/token-usage-app/releases/tag/v0.1.0
