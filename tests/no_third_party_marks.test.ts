/**
 * [_brand] 제3자 상표·제품명이 코드에 다시 들어오지 않게 막는다.
 *
 * [왜 필요한가]
 * 2026-09-30 감사에서 상표가 세 곳에서 발견됐다 — 데이터 ID 접두사, UI 관련 주석,
 * 패키지/저장소 이름. 한 번 정리해 두고 아무도 막지 않으면 그대로 돌아온다 — 다음 기여자가
 * the next contributor copies an old comment, or a file gets restored from history.
 * 그래서 지운 것만으로는 부족하고 **돌아오는 것을 막는 검사**가 필요하다.
 *
 * [정책]
 * - 이 검사는 코드·문서 전체를 대상으로 한다.
 * - 단, 저작권 게이트가 차단한 자산을 설명하는 기록과 IP 근거 캡처는 예외다.
 *   근거가 사라지면 차단 이유를 알 수 없어 게이트가 무의미해진다.
 * - 대화 중에는 의사소통용으로 쓸 수 있으나 코드에는 남기지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');

/** 코드에 있어서는 안 되는 표기. 대소문자 무시. */
const FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /koei/i, label: 'Koei' },
    { pattern: /\bsan\s?8\b/i, label: 'San8 계열 표기' },
    { pattern: /\bsan\s?14\b/i, label: 'San14 계열 표기' },
    { pattern: /\brtk\s?8\b/i, label: 'rtk8 파생 축약형' },
    { pattern: /\brtk\s?14\b/i, label: 'rtk14 파생 축약형' },
    { pattern: /삼국지\s*조?\s*8/, label: '구 제품명' },
    { pattern: /리메이크/, label: '구 제품명(리메이크)' },
    { pattern: /samgukzi8/i, label: '구 저장소 슬러그' },
    { pattern: /total war/i, label: '제3자 제품명' },
    { pattern: /creative assembly/i, label: '제3자 회사명' },
    { pattern: /intellitouch/i, label: '제3자 제품명' },
    { pattern: /光荣|光栄/, label: '제3자 회사명(중국어)' },
];

/**
 * 예외 경로 — 여기엔 상표가 있어도 된다.
 *  - copyrights/ip-evidence: 출처 근거 캡처(증거이므로 원형 보존)
 *  - 차단을 설명하는 문서: 무엇을 왜 막는지 기록이 있어야 게이트가 의미가 있다
 */
const EXEMPT = [
    'docs/ip-evidence/',
    'scripts/check_ip_assets.mjs',   // 차단 대상을 식별해야 게이트가 동작한다
    // 이 파일 자신. 검사 대상 문자열이 정의문으로 들어 있어 스스로를 잡는다.
    // 자기 자신을 검사하는 순간 항상 red 가 되므로 구조적으로 제외가 불가피하다.
    'tests/no_third_party_marks.test.ts',
];

function scanTargets(): Array<{ file: string; hits: string[] }> {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .filter(f => !EXEMPT.some(prefix => f === prefix || f.startsWith(prefix)))
        .filter(f => !/\.(png|jpe?g|webp|gif|ico|mp3|wav|exe|dmg|AppImage)$/i.test(f));

    const offenders: Array<{ file: string; hits: string[] }> = [];
    for (const file of files) {
        let text: string;
        try {
            // 워킹트리를 읽는다. CI 는 checkout 상태이므로 곧 HEAD 와 같고,
            // 로컬에서는 커밋 전에 바로 잡아준다. (git show 를 파일마다 부르면 느리다)
            text = readFileSync(resolve(REPO_ROOT, file), 'utf8');
        } catch {
            continue; // 추적은 되었으나 디스크에 없는 파일
        }
        const hits = FORBIDDEN.filter(f => f.pattern.test(text)).map(f => f.label);
        if (hits.length > 0) offenders.push({ file, hits });
    }
    return offenders;
}

describe('제3자 상표 배제', () => {
    it('검사 대상 파일이 실제로 존재한다 — 빈 검사는 통과로 오인된다', () => {
        const count = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
            .split('\n').filter(Boolean).length;
        expect(count).toBeGreaterThan(100);
    });

    it('커밋된 코드·문서에 제3자 상표가 없다', () => {
        const offenders = scanTargets();
        const report = offenders.map(o => `${o.file}: ${o.hits.join(', ')}`);
        expect(report, `상표 표기가 다시 들어왔다:\n  ${report.join('\n  ')}`).toEqual([]);
    });

    it('근거 캡처와 차단 대상 식별 코드는 예외로 남아 있다', () => {
        // 예외가 사라지면 '왜 막는지'를 설명할 근거가 사라진다.
        const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
        expect(tracked).toContain('docs/ip-evidence/');
        expect(tracked).toContain('scripts/check_ip_assets.mjs');
    });

    it('예외 목록이 늘어나지 않는다 — 조용히 면제해 숨기지 못하게', () => {
        // 예외는 늘리기만 하면 되므로 방치하면 검사 자체가 무의미해진다.
        // 새로 넣을 필요가 생기면 여기서 의도를 드러내야 한다.
        expect([...EXEMPT].sort(), '예외가 추가됐다 — 근거를 PR 본문에 적고 검사를 갱신할 것').toEqual([
            'docs/ip-evidence/',
            'scripts/check_ip_assets.mjs',
            'tests/no_third_party_marks.test.ts',
        ]);
    });
});
