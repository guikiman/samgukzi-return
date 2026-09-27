# Onboarding 4-PR 파일 소유권 계약

병렬성이 실제로 성립하려면 **수정 파일이 겹치지 않아야 한다.**
AGENTS.md 규칙: "브랜치 구조보다 수정 파일의 중복 금지가 병렬성의 전제입니다."

## 배분표 (각 행은 한 명만 소유)

| PR | 브랜치 | worktree | **소유 파일 (신규 생성만)** |
|---|---|---|---|
| 1 | `guikiman/onboarding-state` | `onboarding-state` | `src/core/onboarding_state.ts` |
| 2 | `guikiman/onboarding-ui` | `onboarding-ui` | `src/ui/onboarding_panel.ts` |
| 3 | `guikiman/onboarding-copy` | `onboarding-copy` | `src/data/onboarding_copy.json` |
| 4 | `guikiman/onboarding-tests` | `onboarding-tests` | `tests/onboarding_state.test.ts`, `tests/onboarding_panel.test.ts`, `tests/onboarding_copy.test.ts` |

## 금지 — 어느 PR도 이것을 건드리지 않는다

```
src/main.ts          (3,700줄 배선 지점)
index.html
style.css
src/core/tutorial_system.ts
src/core/accessibility_system.ts
src/core/officer_dossier.ts
src/data/officers_full.json
```

이유:
- 위 파일들은 **이미 구현돼 있다** (`tutorial_system.ts` 7단계 온보딩, `accessibility_system.ts` 설정 패널, `index.html:25` 설정 버튼, `main.ts:3122+` a11y 배선)
- 4명이 동시에 건드리면 충돌이 확정이다
- 배선은 **코디네이터(제가) 통합 시 단독 수행**한다

## 각 PR이 지켜야 할 것

1. **신규 파일만 만든다.** 위 금지 목록은 읽기만 가능, 쓰기 금지
2. **자기 영역 테스트를 같이 만든다.** 구현과 테스트는 같은 브랜치 (AGENTS.md 규칙)
3. **테스트가 구현 전 실패하고 구현 후 통과**함을 커밋 메시지에 기록
4. **타입 안전**: `npx tsc --noEmit` 0 에러, `Math.random()` 금지 (결정론)
5. **push 금지.** 브랜치에 커밋만 남기고 코디네이터가 병합
6. `npm run build` 산출물(`dist/`, `sw-precache.json`) 커밋 금지 — 지금은 gitignore 됨

## 검증 방법 (코디네이터)

```
각 worktree에서: npx tsc --noEmit  → 0
                 npx vitest run    → 1514+ (기존 1471 + 신규)
파일 겹침 검사:  git diff --name-only <branch> 를 교차 비교 → 겹침 0 이어야 함
```

## baseline (2026-09-27 실측)

4개 worktree 모두 `d4bcbb2` 에서 출발, `npm ci` 후
`tsc 0 errors` / `vitest 151 files 1471 tests passed`.
