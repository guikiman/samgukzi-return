import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TESTS_DIR = join(process.cwd(), 'tests');
// 자기 자신의 정규식 리터럴이 자기 자신을 잡지 않도록 제외한다
const files = readdirSync(TESTS_DIR)
    .filter(f => f.endsWith('.test.ts') && f !== 'test_suite_health.test.ts');

// expect(X.success || !X.success) 는 항상 참이다.
// 자기 자신에 대한 부정이라 성패와 무관하게 통과하므로, 버그를 놓친다.
const TAUTOLOGY = /expect\(\s*([A-Za-z0-9_$.[\]]+)\s*\|\|\s*!\s*\1\s*\)/;

describe('테스트suite 자가 점검', () => {
    it('항상 참인 단언이 남아있지 않다', () => {
        const offenders: Array<{ file: string; line: number; text: string }> = [];
        for (const f of files) {
            readFileSync(join(TESTS_DIR, f), 'utf-8')
                .split('\n')
                .forEach((text, i) => {
                    if (TAUTOLOGY.test(text)) {
                        offenders.push({ file: f, line: i + 1, text: text.trim() });
                    }
                });
        }
        expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
    });
});
