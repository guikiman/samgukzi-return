# ✅ 정리 완료 — 2026-09-27

이 파일은 **메모리 대역**이다. 에이전트는 세션이 끝나면 기억을 잃으므로,
아래 항목은 리포지토리에 기록해 두고 사람이(또는 다음 세션의 에이전트가) 확인한다.

## 삭제된 임시 파일 (모두 완료)

| 경로 | 크기 | 삭제일 | 상태 |
|---|---|---|---|
| `D:\samgukzi8-pre-rewrite.bundle` | 85.8 MB | 2026-09-27 | ✅ 삭제 |
| `D:\samgukzi-re_DATA\삼국지 전국 지도.png` | 4.0 MB | 2026-09-27 | ✅ 삭제 |
| `D:\Downloads\삼국지 화면\삼국지 전국 지도 A.png` | 4.0 MB | 2026-09-27 | ✅ 삭제 |

### 번들을 지워도 된 이유 (삭제 전에 검증함)

`filter-repo` 가 되돌릴 유일한 수단이라 신중을 해야 했고, 지우기 전에
"번들에 리포지토리에 없는 내용이 있는가" 를 확인했다.

| 검사 | 결과 |
|---|---|
| 재작성 전/후 트리 파일 수 | 2878 = 2878 |
| 파일명 집합 비교 | 완전 동일 |
| **blob 해시 전수 비교** | **전부 동일** — 파일 1개도 안 바뀜 |
| 번들에만 있던 커밋 메시지 3건 | auth 머지 커밋, 내용은 전부 보존 |

SHA 만 바뀌고 실체는 같았다. 번들은 독립적인 가치가 없었고, 지워도
작업 손실이 없다.

### Total War 파생 지도 원본

`assets/china-national-map.png` 의 원본(sha256 `02686e0a…`, 4,054,452 bytes)은
프로젝트 밖에도 사본이 더 있었다. `D:\` 와 `C:\Users\YG_PC` 전수 재스캔 결과
**현재 이 파일은 이 컴퓨터 어디에도 존재하지 않는다.**

주의: `D:\samgukzi-re_DATA` 는 빌드 산출물이 아니라 **작업 디렉터리**다
(보고서·스크립트·원본 xlsx 등 76개 파일). 폴더째 지우지 말고 지도 파일만
지웠다. `삼국지14PK 정리표.xlsx` 와 `IP_POLICY.md` 는 그대로 있다.

## 함께 확인해 둘 것

- [x] `hippocamp` 브랜치와 worktree 정리 완료 (2026-09-27) — 리모트 `master` 로 통합
- [x] 저작권 게이트 `scripts/check_ip_assets.mjs` 가 커밋·push 를 막는지 확인 완료
- [x] 히스토리 재작성 — `filter-repo` 로 136커밋에서 blob 제거, 리모트 반영 완료
- [x] `backup-before-rewrite` 삭제 (2026-09-27) — 34커밋 전부 `master` 안에 있음을 확인 후 삭제
- [x] `guikiman/*` 16개 + worktree 8개 정리 (2026-09-27) — 커밋 119개 그대로
- [x] 2026-09-28 세션 종료 시점 재확인 — 아래 「2026-09-28 점검」 참조
- [x] **AI 원화 지도 출처 확인 (2026-09-30 완료)**
      `assets/map-china-ai-4096.webp` (1,994,482 bytes, 커밋 `73ff928`).
      생성 스크립트가 커밋에 없고 WebP 인코딩 시 메타데이터가 제거되어
      파일만으로는 출처를 확정할 수 없어 allowlist 게이트에 걸렸다.
      → **작성자 확인: ChatGPT txt2img 로 텍스트 프롬프트에서 신규 생성.**
      저작권된 원본 입력이 없으므로 파생작이 아니며, 대장에 근거를 기록했다.
      대장의 `source` 는 작성자 진술이며 스크립트가 독립 검증한 결과는 아니다.

- [x] src/data 가드 테스트의 커밋 타이밍 의존성 — `620e14e` 에서 globalSetup 방식으로 해결

- [ ] **src/data 가드 테스트가 transient하게 red 가 된다 (2026-09-30 기록, 이번엔 미해결)**
      `tests/officer_ui_wiring.test.ts` 의
      `reports no modification to any file under src/data/` 는
      `git status --porcelain -- src/data/` 결과를 그대로 검사한다.
      즉 **소스가 아니라 워킹트리 상태**를 검사하므로, 정당한 데이터 수정
      내역이 커밋되기 전까지는 이 테스트 하나만 red 가 되고 나머지는 green 이다.
      이번에는 07 시나리오 중복 앵커 수정이라 `29d52ab` 에 커밋해 해결했다.
      근본 원인은 "테스트 실행이 데이터를 변조하지 않는다" 는 불변식을
      실행 전후 diff 비교로 표현하지 않은 데 있다. 고치려면 커밋 타이밍에
      의존하지 않는 형태로 바꿔야 하며, 미해결로 남긴다.

## 2026-09-28 점검 (새 세션 시작 시 읽을 것)

이전 항목들이 아직 유효한지 실측으로 다시 확인했다. **새로 남은 정리 항목은 없다.**

## 2026-09-28 오후 — wip2 · wip3 stash 처리 (정리 완료)

`development = 병력` 결함의 잔여분이 `wip2` / `wip3` stash 에 커밋되지 않은
상태로 남아 있었는데, `767a19f` 에 흡수했다. stash 는 아직 목록에 남아
있지만 **내용물은 전부 커밋에 반영**됐으므로 삭제해도 된다.

| stash | 파일 | 상태 |
|---|---|---|
| `wip3` (`stash@{0}`) | `faction_ai_monthly.ts` `mod_schema_validator.ts` `main.ts` | → `767a19f` 에 반영 ✅ |
| `wip2` (`stash@{1}`) | `ai_stream_manager.ts` `ai_worker_simulator.ts` | → `767a19f` 에 반영 ✅ |

> 두 stash 모두 `44343f9` 를 기준으로 만들어졌고 `git stash apply` 로
> 충돌 없이 적용됐다. **apply 후 `git stash drop` 은 하지 않았다** —
> 두 stash 는 같은 세션에서 만든 것이라 `verify-red` 용 임시 stash 와
> 번호가 뒤섞인다. 실수로 옛 것을 drop 하지 않았는지
> `git stash list` 로 이름(wip2/wip3)을 확인한 뒤 지운다.

### 남겨둔 참조 태그

`wip-recover-20260928` → `44343f9`. absorb 전에 찍은 안전 지점.
확인 후 `git tag -d wip-recover-20260928` 로 지워도 된다.

### 이 세션에서 남긴 교훈 (다음 세션이 읽을 것)

스텁 값은 규모 결함을 가린다. `development: 100` 같은 하드코딩은
0~100 개발도 시절엔 정상이었지만, 병력(명) 스케일에서는 "이미 상한" 이라
커맨드가 조용히 죽은 상태를 테스트가 통과로 가렸다. **값을 낮춰 잡으면
"일어나는가" 만 검사되고 "말이 되는 규모인가" 는 검사되지 않는다.**

그래서 `tests/troops_scale_contracts.test.ts` 를 만들어 값의 규모 자체를
계약으로 고정했다. 앞으로 시뮬레이션 값을 다룰 때 참고할 것.

| 검사 | 결과 |
|---|---|
| `D:\samkukzi8-pre-rewrite.bundle` | 존재하지 않음 (Test-Path → False) ✅ |
| `D:\samkukzi-re_DATA` 작업 디렉터리 | 76개 파일 그대로 — **지우면 안 된다** (xlsx·IP_POLICY 등) |
| `git stash list` | 빈 목록 |
| `refs/stash` | 존재하지 않음 (fatal: unknown revision) ✅ |
| worktree | `D:/samkukzi-re` 1개뿐 ✅ |
| 저작권 게이트 | push 시 143커밋 스캔 · 위반 0건 통과 |

### 이번 세션에서 정리한 임시 파일

| 경로 | 용도 | 처리 |
|---|---|---|
| `scripts/dev_serve.mjs` | 개발용 정적 서버 | ❌ 임시 아님 — `8690d62` 로 커밋, 정식 유지 |
| `scripts/_repro_flow.mjs` | 결함 재현용 CDP 스크립트 | ✅ 삭제 (커밋하지 않음) |
| `scripts/_verify.mjs` | 10항목 브라우저 검증 스크립트 | ✅ 삭제 (커밋하지 않음) |
| `.git/COMMIT_EDITMSG_TMP.txt` · `.git/CM3.txt` | 커밋 메시지 임시 파일 | ✅ 삭제 |

> 재현/검증 스크립트를 다시 만들 필요가 있으면 `tests/e2e/browser_smoke.mjs` 의
> CDP 클라이언트 클래스를 그대로 재사용하면 된다. 커밋하지 말고 세션 안에서만 쓴다.

### 작업 트리 상태

`git status --porcelain` 결과가 비어 있어야 한다. 임시 파일이 남아 있으면
worktree 정리 시 함께 사라지므로, 세션이 끝나기 전에 확인한다.

### ⚠️ `filter-repo` 후에도 blob 이 살아있던 이유 (중요)

worktree **인덱스**가 blob 을 참조하고 있어서 `git gc --prune=now` 후에도
객체가 패킹된 채 남았다. 파일시스템 스캔으로는 보이지 않는다 —
`.git/objects/pack/*.pack` 안쪽에 있기 때문이다.

```powershell
# 인덱스에서 제거
git -C <worktree> rm --cached -- assets/china-national-map.png
# 객체까지 실제로 없애려면 (reflog 도 만료시켜야 한다)
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

확인 방법: `git cat-file -e <blob-sha>` 가 0 을 반환하면 아직 있다.
파일시스템 재스캔만으로는 판단할 수 없다.

### ~~### 보존한 미커밋 작업~~ — 이미 흡수 후 디렉터리 삭제 완료

worktree 를 지우기 전에 복사해 둔 6개 파일은 `master` 에 cherry-pick 되었고,
보존 디렉터리 자체는 삭제되었다. 복원 절차가 필요한 경우는 없다.

### ~~### 남은 stash~~ — 정리 완료 (2026-09-27)

사용자가 명시적으로 폐기했다. 아래 경고를 읽지 말고 넘어가도 된다.

- `stash@{0}` (200개 파일) 삭제 완료.
- `refs/stash` **존재하지 않는다** (`git rev-parse refs/stash` → fatal: unknown revision).
- stash 본체 SHA `89eee9ee…` 도 **Git 객체 저장소에서 제거되었다**
  (`git cat-file -e` → exit 1).
- `salvage-stash-2026-09-27` 태그 없음. 보존용 worktree 없음.

> ⚠️ 아래 "stash 복구 사고" 절은 **과거 기록**이다. 더 이상 유효하지 않으며,
> `git stash drop 하지 말 것` 경고도 더 이상 적용되지 않는다.
> 이미 GC 로 회수 불가능한 상태임을 위 명령으로 확인했다.

### 보존 디렉터리

`D:\samkukzi-re_DATA\preserved-2026-09-27\` 은 worktree 정리와 함께
**함께 삭제되었다** (경로 존재 확인: False). 위 6개 파일은 이미 `master` 에
cherry-pick 되어 있으므로 복원본이 필요 없다.

### worktree / terminal

- 남은 worktree: `D:/samkukzi-re` (master) **1개뿐**.
- `hippocamp` 로컬·리모트 브랜치와 worktree 모두 삭제됨.

### 참조 문서

- ONBOARDING-4PR-POSTMORTEM.md — 병렬 작업 4건의 통합 기록과 규칙.
  다음에 병렬 작업을 시작하면 **반드시 먼저 읽을 것.**
  특히 규칙 1(계약을 worktree 생성 전에 커밋)을 지키지 않으면 워커가 멈춘다.

### ⚠️ stash 복구 사고 (2026-09-27) — **해결됨 · 아래는 과거 기록**

> 🚫 **이 절의 지시는 더 이상 실행하지 말 것.**
> `git stash drop 하지 말 것` 경고는 이미 깨진 상태다. 사용자가 stash 를
> 명시적으로 폐기했고 GC 까지 끝났다. 위 절에서 확인한 대로
> `refs/stash` 와 본체 SHA 양쪽 다 존재하지 않는다.

다음은 당시 상황의 기록이다 (무엇이 왜 막혔는지를 남기기 위함).

git stash list 가 빈 목록을 반환하지만 **efs/stash 는 살아 있다**.
git stash list 는 reflog 을 읽는데 그 reflog 파일이 0바이트다.

`powershell
git rev-parse refs/stash                       # 살아 있음
git stash list                                  # 빈 목록 — reflog 이 비어서
git tag salvage-stash-2026-09-27 refs/stash    # GC 방지 (필수, 먼저 할 것)
`

stash SHA: 89eee9eeec7a0fd0293dc08a194dfaca4d9dcb49 (5,382 파일)
**git stash drop 하지 말 것.** absorption 시도는 아래 이유로 불가능했다.

#### absorption 이 불가한 이유 (실측)

stash 의 소스 34개 파일은 **과거 스키마**에 맞춰져 있다. master 에 그대로 올리면
	sc 43 에러:

- Officer.relations / Officer.affinity — 이 필드는 master 의 	ypes.ts 에 없다.
  관계 데이터는 officer_profile_schema.ts 로 옮겨졌다 (정적 프로필 계층).
- ./geo_data.js , ./officer_graph_helper.js — **master 와 stash 양쪽 다 없다.**
  stash 생성 시점에 이미 존재하지 않았던 모듈을 import 한다.

즉 이 stash 는 **버전 간 어긋난 백업**이지 미흡수 작업이 아니다.
34개에 구현이 더 많더라도(예: title_merit_manager 180줄 vs 10줄) 지금 흡수하면
프로젝트를 컴파일 불가능하게 만든다. 되돌릴 때는 stash 를 건드리지 말고
master 위에서 cherry-pick 하는 것이 맞다.
