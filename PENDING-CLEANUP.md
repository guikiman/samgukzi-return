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
- [ ] `guikiman/*` 브랜치 16개 — 전부 `master` 에 병합 완료. 정리 여부는 미결

### `guikiman/*` 를 지울 때 (아직 안 함)

16개 모두 `master` 에 완전히 병합되어 있어 지워도 커밋 손실이 없다.
worktree 에 붙어 있는 것(`auth-backend`, `fix-boot` 2개)이 있어 순서가 필요하다.

```
git worktree remove <경로>        # 붙어 있는 것부터
git branch -D <브랜치>            # 그 다음 브랜치
git worktree prune
```

### 남은 stash

`stash@{0}: On master: pre-hippocamp-merge master worktree changes` — 200개 파일.
저작권 blob 은 들어 있지 않다. 필요 없으면 `git stash drop` 으로 지울 수 있다.
