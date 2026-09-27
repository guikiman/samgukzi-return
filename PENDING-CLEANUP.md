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

### 보존한 미커밋 작업

worktree 를 지우기 전에 실제 작업 8개 파일을 복사해 두었다
(`D:\samkukzi-re_DATA\preserved-2026-09-27\`). `master` 에 없던 파일이다.

| 출처 | 파일 |
|---|---|
| auth-contract | `src/core/china_map_renderer.ts`, `tests/e2e/browser_smoke.mjs` |
| auth-ui | `index.html`, `src/main.ts`, `style.css`, `scripts/measure_compendium_render.mjs`, `src/ui/officer_compendium.ts`, `tests/officer_compendium.test.ts` |

`officer-dossier` 의 미커밋 1071개는 전부 `dist/` 산출물과 `sw-precache.json`
이라 보존하지 않았다.

### 남은 stash

`stash@{0}: On master: pre-hippocamp-merge master worktree changes` — 200개 파일.
저작권 blob 은 들어 있지 않다. 필요 없으면 `git stash drop`.

### 참조 문서

- ONBOARDING-4PR-POSTMORTEM.md — 병렬 작업 4건의 통합 기록과 규칙.
  다음에 병렬 작업을 시작하면 **반드시 먼저 읽을 것.**
  특히 규칙 1(계약을 worktree 생성 전에 커밋)을 지키지 않으면 워커가 멈춘다.

### ⚠️ stash 복구 사고 (2026-09-27)

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
