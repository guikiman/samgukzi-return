/**
 * [_ip] 자산 출처 대장 — 배포되는 바이너리 자산마다 근거가 있는지 지킨다.
 *
 * [왜 이게 필요한가]
 * scripts/check_ip_assets.mjs 의 denylist 는 자산 1건과 그 blob id 하나만 막는다.
 * "이미 들어간 것"만 보기 때문에 새 파생작이 다른 이름으로 커밋되면 그대로 통과한다.
 * 실제로 그랬다 — china-national-map.png 를 제거한 뒤 AI 원화 이미지가
 * 출처 기록 없이 커밋되었고, 게이트는 침묵했다.
 *
 * 이 테스트는 대장의 규칙을 **독립적으로 다시 계산**해서 비교한다. 게이트 스크립트가
 * 같은 버그를 공유하면 안 되므로, 검증 로직을 여기서 따로 만든다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
const PROVENANCE = JSON.parse(readFileSync(join(REPO_ROOT, 'assets/PROVENANCE.json'), 'utf8')) as {
    version: number;
    assets: Array<{ path: string; sha256: string; bytes?: number; license?: string; source?: string; note?: string }>;
};

const MANAGED_PREFIXES = ['assets/', 'src-tauri/icons/'];
const BINARY_EXT = /\.(png|jpe?g|webp|gif|svg|ttf|otf|woff2?|eot|mp3|wav|ogg|mp4|webm|avi|mov|pdf|xlsx|docx|pptx|psd|blend)$/i;

/**
 * 출처가 아직 미확인인 자산 — CI 가 현재 red 인 이유이자 미해결 항목이다.
 * 여기 적히지 않은 자산이 UNVERIFIED 가 되면 이 테스트가 red 가 되므로
 * "모르는 채로 넘어갔다"는 상태가 구조적으로 불가능해진다.
 */
const KNOWN_UNRESOLVED = new Set<string>([
    'assets/map-china-ai-4096.webp',
]);

/** 게이트와 동일한 규칙으로, 이 테스트가 직접 managed 바이너리를 계산한다. */
function managedBinaries(): string[] {
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
    return tracked.filter(p => MANAGED_PREFIXES.some(prefix => p.startsWith(prefix)) && BINARY_EXT.test(p));
}

describe('자산 출처 대장', () => {
    it('관리 대상 바이너리 자산이 실제로 존재한다 — 규칙이 빈 껍데기가 아니다', () => {
        // MANAGED_PREFIXES 를 잘못 쓰면 통과가 아무것도 안 하는 검사가 된다.
        expect(managedBinaries().length).toBeGreaterThanOrEqual(5);
    });

    it('모든 바이너리 자산이 대장에 등록되어 있다', () => {
        const registered = new Set(PROVENANCE.assets.map(a => a.path));
        const missing = managedBinaries().filter(p => !registered.has(p));
        expect(missing, `대장에 없는 자산: ${missing.join(', ')}`).toEqual([]);
    });

    it('대장의 sha256 이 실제 파일 내용과 일치한다', () => {
        const mismatched: string[] = [];
        for (const asset of PROVENANCE.assets) {
            const full = join(REPO_ROOT, asset.path);
            if (!existsSync(full)) { mismatched.push(`${asset.path} (파일 없음)`); continue; }
            const actual = createHash('sha256').update(readFileSync(full)).digest('hex');
            if (actual !== asset.sha256) mismatched.push(`${asset.path} (대장 ${asset.sha256} ≠ 실제 ${actual})`);
        }
        expect(mismatched, mismatched.join(' / ')).toEqual([]);
    });

    it('근거 미확인 자산은 추적 가능한 목록에만 존재한다', () => {
        const unresolved = PROVENANCE.assets
            .filter(a => !a.license || a.license.toUpperCase().includes('UNVERIFIED'))
            .map(a => a.path);
        // 미확인 자산이 늘면 그만큼 CI 가 red 다 — 숨길 수 없다.
        expect(unresolved.filter(p => !KNOWN_UNRESOLVED.has(p)), '추적 목록에 없는 미확인 자산이 생겼다').toEqual([]);
    });

    it('미확인 자산은 대장에 왜 미확인인지 사유를 남기고 있다', () => {
        for (const asset of PROVENANCE.assets) {
            if (!asset.license || asset.license.toUpperCase().includes('UNVERIFIED')) {
                expect((asset.note ?? '').trim().length, `${asset.path} 에 사유가 없다`).toBeGreaterThan(10);
                expect((asset.source ?? '').trim().length, `${asset.path} 에 source 가 없다`).toBeGreaterThan(0);
            }
        }
    });

    it('대장에 없는 파일은 실제 디스크에도 없다 — 항목이 썩지 않게 한다', () => {
        const orphans = PROVENANCE.assets.filter(a => !existsSync(join(REPO_ROOT, a.path)));
        expect(orphans.map(a => a.path), '대장에만 있는 항목은 지워야 한다').toEqual([]);
    });
});

describe('게이트 배선', () => {
    it('pre-push 훅이 자산 대장 검사까지 돌린다', () => {
        const hook = readFileSync(join(REPO_ROOT, '.githooks/pre-push'), 'utf8');
        expect(hook).toContain('--provenance');
    });

    it('CI 가 자산 대장 검사를 돌린다', () => {
        const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
        expect(ci).toContain('--provenance');
    });

    it('배포는 저작권 게이트를 기다린다', () => {
        // [결함] 예전 deploy 는 test 만 기다렸다. 게이트가 실패해도 배포가 돌아갔다.
        const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
        const deployBlock = ci.slice(ci.indexOf('\n  deploy:'));
        expect(deployBlock).toMatch(/needs:\s*\[.*ip-gate.*\]/);
    });

    it('CI 가 서비스 워커 오프라인 검사까지 돌린다', () => {
        const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
        expect(ci).toContain('tests/e2e/sw_offline.mjs');
    });
});
