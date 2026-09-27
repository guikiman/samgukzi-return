# 🧹 임시 정리 대상 — 2026-10-11 에 삭제

이 파일은 **메모리 대역**이다. 에이전트는 세션이 끝나면 기억을 잃으므로,
아래 항목은 리포지토리에 기록해 두고 사람이(또는 다음 세션의 에이전트가) 확인한다.

## 삭제 대기 중인 임시 파일

| 경로 | 크기 | 생성일 | 삭제 예정일 | 상태 |
|---|---|---|---|---|
| `D:\samgukzi8-pre-rewrite.bundle` | 85.8 MB | 2026-09-27 | **2026-10-11** | 대기 중 |

### 이것이 무엇인가

2026-09-27 에 `git filter-repo` 로 히스토리를 재작성하기 **직전**의 상태를
저장한 git 번들이다. `filter-repo` 는 136개 커밋의 SHA 를 전부 바꿔 버렸고,
되돌릴 수 있는 유일한 수단이었다.

재작성 전 tip: `e9bc4a8` (현재 `master` 의 조상)

### 왜 아직 살아있어야 하는가

히스토리 재작성은 되돌릴 수 없다. 리모트에는 재작성 후 상태만 있으므로,
문제가 발견되면 이 번들이 유일한 복구 지점이다. **2주가 지난 뒤에도 문제 없음을
확인하면 그때 지운다.**

### 어떻게 되돌리는가

`filter-repo` 는 이 번들을 직접 열 수 없다. 클론으로 복구한다.

```
git clone D:\samgukzi8-pre-rewrite.bundle recovery
cd recovery
git remote add origin https://github.com/guikiman/samgukzi8-re.git
git push --force origin master
```

주의: 복구하면 **저작권 blob 이 히스토리에 되살아난다.** push 전에 반드시
`node scripts/check_ip_assets.mjs --all` 로 상태를 확인할 것.

### 삭제 확인 방법

```
Remove-Item D:\samgukzi8-pre-rewrite.bundle -Force
Test-Path D:\samgukzi8-pre-rewrite.bundle   # False 여야 정상
```

## 함께 확인해 둘 것

- [ ] `hippocamp` 브랜치와 worktree 정리 완료 (2026-09-27) — 리모트 `master` 로 통합
- [ ]著作权 게이트 `scripts/check_ip_assets.mjs` 가 커밋·push 를 막는지 확인 완료
- [ ] `guikiman/*` 브랜치 18개는 모두 `master` 에 병합 완료. 정리 여부는 미결 — 필요 없어도 되나?
- [ ] `backup-before-rewrite` 로컬 브랜치 정리 여부 미결
