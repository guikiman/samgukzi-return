/**
 * [_deploy] 자동 배포 통로가 다시 열리지 않게 한다.
 *
 * [왜 필요한가]
 * 예전 워크플로는 `push to master` 가 곧 배포였다. 테스트를 통과하면 아무도 묻지
 * 않고 GitHub Pages 에 올라갔다. 완성도 20% 미만인 게임을 개발할 때마다 배포가
 * 반복돼 시간이 낭비됐고, 검증되지 않은 상태가 공개됐다. 2026-09-30 에 사용자가
 * 배포를 전면 금지했고, 그 통로를 제거했다.
 *
 * 이 검사는 그 제거가 **되돌아가지 않게** 한다. 규칙은 문서(AGENTS.md)에만 적으면
 *기계도 사람이든 시간이 지나면 무시하게 되므로, 실행 가능한 계약으로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
const CI = readFileSync(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
const AGENTS = readFileSync(resolve(REPO_ROOT, 'AGENTS.md'), 'utf8');

/** deploy 잡 본문만 뽑는다. */
function deployJob(): string {
    const start = CI.indexOf('\n  deploy:');
    expect(start, 'deploy 잡을 찾지 못했다').toBeGreaterThan(-1);
    return CI.slice(start);
}

describe('배포 금지 계약', () => {
    it('배포 잡이 수동 실행에서만 돌아간다', () => {
        const job = deployJob();
        expect(job, 'deploy 의 if 가 수동 실행 조건이 아니다').toContain('workflow_dispatch');
        // push 로는 배포되지 않는다 — 과거 사고의 직접 원인.
        expect(job, 'deploy 가 push 로도 발동한다').not.toMatch(/github\.event_name\s*==\s*'push'/);
    });

    it('배포는 저작권 게이트와 테스트를 모두 기다린다', () => {
        expect(deployJob()).toMatch(/needs:\s*\[.*ip-gate.*test.*\]/);
    });

    it('AGENTS.md 에 배포 금지가 맨 앞에 남아 있다', () => {
        // 세션이 바뀌면 기억이 끊긴다. 규칙은 문서로만 남으므로 그 존재를 확인한다.
        expect(AGENTS).toContain('배포하지 않는다');
        const banAt = AGENTS.indexOf('배포하지 않는다');
        const archAt = AGENTS.indexOf('프로젝트 아키텍처 원칙');
        expect(banAt).toBeGreaterThan(-1);
        expect(banAt, '배포 금지가 아키텍처 절보다 뒤에 있다').toBeLessThan(archAt);
    });

    it('master 푸시 금지 규칙이 문서에 남아 있다', () => {
        expect(AGENTS).toContain('master');
        expect(AGENTS).toMatch(/push 하지 않는다|배포하지 않는다/);
    });
});
