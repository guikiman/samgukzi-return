# 온보딩 4-PR 병렬 작업 — 통합 기록

완료된 작업의 이력과, **다음 병렬 작업에서 반드시 지켜야 할 규칙**을 함께 남긴다.
이 문서는 세션이 바뀌어도 남는다. 다음 에이전트가 이 파일을 읽으면 같은 실수를 반복하지 않아야 한다.

상태: **완료** (2026-09-27) · 병합 `efe0830` `813b401` `6f2e574` `c6ddbb7` · 배선 `8f14ee5`

---

## 1. 결과

| PR | 산출물 | 커밋 | 소유 파일 |
|---|---|---|---|
| 1 state | 온보딩 상태 모델 | `efabce5` | `src/core/onboarding_state.ts` |
| 2 ui | 순수 HTML 패널 렌더러 | `f52aa6c` | `src/ui/onboarding_panel.ts` |
| 3 copy | 한국어 카피 12항목 | `310890f` | `src/data/onboarding_copy.json` |
| 4 tests | 테스트 3종 (54 케이스) | `4484423` | `tests/onboarding_{state,panel,copy}.test.ts` |
| 배선 | 통합 지점 | `8f14ee5` | `src/main.ts` |

검증: `tsc 0` · `vitest 1525 passed` (1471 + 54) · **브라우저 E2E 19/19** · 콘솔/페이지 에러 0건.
파일 소유 위반 0건 — 커밋 단위 감사 기준(규칙 3).

---

## 2. 규칙 — 다음 병렬 작업에도 그대로 적용한다

### 규칙 1. 계약은 worktree를 만들기 **전에** 커밋한다

이번에 순서를 잘못 잡았다. worktree 4개를 먼저 만들고 그 뒤에 계약 파일을 커밋해서,
워커들이 `ONBOARDING-WORKTREES.md` 를 볼 수 없었다. PR2가 "파일이 없다"고 보고해 멈췄고,
PR4도 같은 문제를 독립적으로 지적했지만 둘 다 정확했다.

```
git add <계약 문서> && git commit        # 1. 먼저
orca worktree create ...                # 2. 그 다음에 분기
```

### 규칙 2. 파일 소유권을 실제로 강제한다

AGENTS.md의 "브랜치 구조보다 수정 파일의 중복 금지가 병렬성의 전제"를 실제로 적용했다.
`main.ts` `index.html` `style.css` `tutorial_system.ts` `accessibility_system.ts`는
**읽기 전용**이었다. 배선은 코디네이터만 단독 수행한다.

근거: 이 파일들은 이미 구현돼 있었다. 4명이 동시에 건드리면 충돌이 확정이다.
PR2의 렌더러는 `index.html`에 이미 존재하는
`#tutorial-panel` `#tut-step-content` `#tut-prev/next/skip/finish` `#tut-spotlight-note`
7개 id를 정확히 가정했다. **금지 목록에 실제 id를 적어 주었기 때문에** 설계가 맞물렸고
`index.html`은 끝까지 수정하지 않았다.

### 규칙 3. 겹침 검사는 **브랜치가 아니라 커밋 단위**로 한다

`git diff --name-only master..<branch>`로 검사하면 **거짓 양성**이 나온다.
분기점이 다르면 다른 워커의 파일이 "삭제"로 보이는 base artifact 때문이다.
PR3이 `src/core/onboarding_state.ts`를 "소유 위반"으로 잘못 보고할 뻔했다.

```powershell
foreach ($c in $commitShas) {
    git show --name-only --format='' $c | Where-Object { $_ -notmatch 'ONBOARDING' }
}
```

### 규칙 4. 테스트는 통합 후에 green이 되어야 한다 (red → green 증명)

PR4는 다른 모듈이 없는 상태에서 테스트를 먼저 썼다. 그 시점에 3개 파일이 전부
module-not-found로 실패했고 기존 151 파일은 계속 통과했다. PR1·2·3을 병합한 뒤
**테스트를 한 줄도 고치지 않고** 154 파일 / 1525 테스트가 green이 되었다.

이것이 이 작업에서 얻은 가장 강한 증거다. 스텁에 맞춰 쓴 테스트는 이런 결과를
만들 수 없다 — 스텁이 있었으면 처음부터 통과했을 테니.

### 규칙 5. 워커 상태를 능동적으로 확인한다

터미널을 만들고 dispatch한 뒤 결과를 기다리기만 하면 안 된다.
PR2는 질문에 멈춰 있었고 스크린샷을 보기 전까지는 발견할 수 없었다.

```powershell
$j = & orca terminal list --json | ConvertFrom-Json
$j.result.terminals | Where-Object { $_.preview -match 'asking a question' }
```

### 규칙 6. 워커 보고를 믿지 않는다 — 직접 실행해서 확인한다

PR2가 DOM 접근을 안 한다고 했다. 직접 grep해 검증했다 — 실행 코드에는 0건이고
헤더 주석에만 있었다. 확인하지 않았다면 믿었을 것이다.
같은 이유로 병합 전마다 `tsc`와 `vitest`를 그 worktree에서 직접 돌렸다.

---

## 3. Orca 코디네이터 운용 노트 (AGENTS.md 규칙 1 보완)

- `dispatch --inject`는 Cline에서 `no_agent_detected`를 반환한다(예고된 동작).
  대안: `terminal create --command "cline"` → tui-idle 확인 → dispatch.
- **`dispatch --return-preamble`는 태스크를 등록만 하고 프롬프트를 전달하지 않는다.**
  `dispatch-show`에 preamble이 없고 dispatch 객체만 반환된다.
  → **`terminal send`로 스펙을 직접 전달해야 한다.** 이건 문서에 없던 갭이다.
- 태스크가 `dispatched` 상태라는 것만으로 프롬프트가 도착했다고 가정하면 안 된다.
  터미널 preview로 실제 도착을 확인한다.

---

## 4. 배선에서 발견한 함정

유닛 테스트는 **배선을 검증하지 않는다.** 이번에 1525 테스트가 전부 통과한 상태에서
`openGuidedPanel()`이 **호출되지 않는 죽은 코드**였다. 함수를 정의하고 끝냈기 때문이다.

- 호출 경로가 존재하는지 `Select-String`로 확인한다.
- `main.ts`는 함수 선언이 hoisting되므로 위쪽에서 호출해도 tsc는 통과한다.
  컴파일러가 죽은 코드를 잡지 못한다.

스포트라이트 폴백도 처음에 `note.textContent = el ? '' : ''`라 써서 조건이
무엇이든 빈 문자열이 되었다. 기존 튜토리얼의 계약을 그대로 따라야 한다.