# 삼국지리턴 (웹)

삼국지리턴은 삼국지 세계관의 핵심 시스템(평정·내정·외교·전투·인간관계·인생 시뮬레이션)을 웹 기술로 구현한 프로젝트입니다. 520개 체크리스트 기반으로 구축되었으며, 1,000명 규모 무장 AI를 Web Worker로 처리합니다.

[![CI](https://github.com/guikiman/samgukzi-return/actions/workflows/ci.yml/badge.svg)](https://github.com/guikiman/samgukzi-return/actions/workflows/ci.yml)
[![Play](https://img.shields.io/badge/▶_플레이-GitHub_Pages-2ea44f)](https://guikiman.github.io/samgukzi-return/)

## 🎮 플레이

- **온라인**: GitHub Pages 배포 URL (CI가 main/hippocamp 푸시 시 자동 배포)
- **오프라인**: 첫 접속 후 ServiceWorker가 앱 셸 + dist 전체(500+ 모듈)를 프리캐시 —
  이후 네트워크 없이도 리로드/플레이 가능 [E43]
- **로컬**: `npm run build` 후 프로젝트 루트를 정적 서버로 서빙 (예: `python -m http.server 8000`) → `index.html` 접속

### 💻 데스크톱 버전 (Tauri)

[![Desktop Release](https://img.shields.io/badge/⬇_다운로드-v1.0.0-2ea44f)](https://github.com/guikiman/samgukzi-return/releases/tag/samgukzi-return-desktop-v1.0.0)

| 플랫폼 | 파일 | 비고 |
|---|---|---|
| Windows 10/11 (x64) | `samgukzi-return_1.0.0_x64-setup.exe` | 설치형 (`.msi`도 제공) |
| macOS 11+ (Apple Silicon) | `samgukzi-return_1.0.0_aarch64.dmg` | 드래그&드롭 설치 |
| Linux (x64) | `samgukzi-return_1.0.0_amd64.AppImage` | 실행권한 부여 후 바로 실행 (`.deb`/`.rpm`도 제공) |

> 새 태그(`v*`) 푸시 시 GitHub Actions가 3개 플랫폼 패키지를 자동 빌드해
> [Releases](https://github.com/guikiman/samgukzi-return/releases)에 등록합니다.
> 데스크톱 빌드도 웹과 동일한 PWA 오프라인 캐싱을 지원합니다.

## 🛠️ 개발

```bash
npm install            # 의존성 설치
npm run check          # 타입 체크 (tsc --noEmit)
npm test               # 유닛/통합 테스트 (vitest)
npm run build          # TS 빌드 (dist/) + sw-precache.json 매니페스트 생성
npm run test:e2e       # 빌드 + 브라우저 E2E 스모크 + SW 오프라인 검증 (headless Chrome)
```

### CI 파이프라인
`.github/workflows/ci.yml` — push/PR 시 **타입 체크 → 1,229개 테스트 → 빌드 → E2E** 순차 실행 후, 기본 브랜치 푸시에 한해 GitHub Pages 자동 배포.

## 🏗️ 아키텍처 요약

| 계층 | 구현 |
|---|---|
| 상태 | 정규화된 중앙 스토어 + O(1) 인덱스 (`game_store.ts`) |
| 커맨드 | 커맨드 패턴 + Undo/Redo (`command_system.ts`) |
| FSM | 8페이즈 오케스트레이터 (`game_engine.ts`) |
| AI | Web Worker 1,000명 의사결정 (`ai_worker.ts`) |
| 전투 | 헥사곤 A* + ZOC/보급/기상 (`astar_hex_pathfinder.ts`, `battle_*`) |
| 그래프 | 무장 관계망 (`relationship_graph_evaluator.ts`) |
| 포팅 | Python 30개 모듈 → TS (평정 [76-85], 기후 [321-340], 첩보 [341-360], 인생 [421-438], 메타 [213-214] 등) |
| 연의전 | 6개 시나리오 전체 이벤트 체인 (황건적→출사표) — 시작 연도 실발동 순회 테스트 보장 [300][106-114] |
| PWA | ServiceWorker 프리캐시 + 네비게이션 폴백 (`sw.js`, `sw-precache.json`) [E43] |

## 🎬 전투 리플레이 공유 [312]

전투가 끝나면 전투 패널의 **🎬 리플레이 URL** 버튼으로 전투 기록을
100kB 이하의 압축 URL(`?replay=...`)로 내보낼 수 있습니다.

- **공유**: 생성된 URL을 복사해 전달 — 접속만으로 자동 재생
- **재생 컨트롤**: `Space` 일시정지 · `1`~`4` 속도 배율 · `0.5x`는 `0`
- **가져오기**: 시나리오 선택 화면 하단의 입력창에 URL을 붙여넣고 🎬 재생

## 📦 모딩 (모드 창작 마당) [309]

게임 화면에 **JSON 모드 파일을 드래그&드롭**하면 즉시 마운트됩니다.

```json
{
  "meta": { "id": "my_mod", "name": "내 모드", "version": "1.0.0", "author": "you", "description": "...", "createdAt": "2026-09-24" },
  "officers": [{ "id": "off_mine", "name": "가상 무장", "birthYear": 170, "stats": { "leadership": 92 } }],
  "factions": [{ "id": "fac_mine", "name": "신생 세력", "color": "#ff8800" }],
  "cities": [{ "id": "city_mine", "name": "천수", "x": 0.55, "y": 0.42 }]
}
```

- 스키마 검증(`SchemaValidator` [301])을 통과한 모드만 스토어에 핫 인젝션 —
  잘못된 모드는 게임을 파괴하지 않고 오류 목록만 반환합니다
- 기존 ID와 겹치면 **업데이트**, 새 ID면 **신규 추가**

## 📜 라이선스

교육/연구 목적의 개인 프로젝트입니다.
