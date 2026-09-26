import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OFFICER_PROFILES } from '../src/core/officer_profile_schema';

/**
 * [부팅 회귀 방지] 브라우저 모듈 그래프 규약
 *
 * 브라우저는 확장자 자동 해석을 하지 않는다. tsc 는 스펙리파터를 재작성하지 않으므로
 * 상대 경로에 '.js' 가 없으면 dist 에도 그대로 남아 404 가 나고, 그 404 는
 * 임포트 체인 전체를 실패시켜 `window.__game` 이 생성되지 않는다(부팅 실패).
 *
 * Node/vitest 과 tsc 는 둘 다 이걸 놓친다 — 단위 테스트는 항상 통과하고
 * 브라우저 E2E 만 404 로 죽는다. 그래서 여기서 소스 수준에서 막는다.
 */

const ROOT = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** 값으로 실제로 남는 정적 import 문(타입 전용 import 는 컴파일 시 사라진다) */
const RUNTIME_IMPORT = /^\s*import\s+(?!type\s)(?:[\s\S]*?)\sfrom\s+'(\.[^']*)'\s*;?\s*$/gm;

function extensionlessRelativeImports(source: string): string[] {
    const out: string[] = [];
    for (const m of source.matchAll(RUNTIME_IMPORT)) {
        const spec = m[1];
        if (spec.endsWith('.js') || spec.endsWith('.json')) continue;
        out.push(spec);
    }
    return out;
}

/** `typeof import('...')` 같은 타입 전용 참조는 컴파일 시 사라진다 — 검사에서 제외한다. */
function stripTypeOnlyImports(source: string): string {
    return source.replace(/typeof\s+import\('[^']*'\)/g, "'<type-only>'");
}

describe('[부팅] 브라우저 노출 모듈의 상대 import 는 .js 를 명시한다', () => {
    it('officer_biography_bridge.ts 에 확장자 없는 런타임 상대 import 가 없다', () => {
        // 이 모듈은 main.ts 를 통해 브라우저 그래프에 들어온다 (Unit B).
        // './officer_dossier' 처럼 쓰면 404 → main.ts 평가 중단 → 부팅 실패.
        const bad = extensionlessRelativeImports(read('src/core/officer_biography_bridge.ts'));
        expect(bad).toEqual([]);
    });

    it('오피서 데이터 레이어 4개 파일에도 확장자 없는 상대 import 가 없다', () => {
        // Unit B 가 새로 브라우저 그래프에 끌어온 계층. tsc 는 스펙리파터를 재작성하지
        // 않으므로 여기서라도 빠지면 dist 에 그대로 남아 404 가 된다.
        for (const rel of [
            'src/core/officer_dossier.ts',
            'src/core/officer_profile_schema.ts',
            'src/core/officer_differentiation.ts',
            'src/core/tactic_effects.ts',
        ]) {
            expect(extensionlessRelativeImports(read(rel)), rel).toEqual([]);
        }
    });
});

describe('[부팅] Unit B 배선은 정적 import 로 유지된다', () => {
    it('main.ts 는 브리지와 프로필 레지스트리를 정적으로 불러온다', () => {
        // 지연 로드(deferral) 로 바꾸면 404 가 잠재화될 뿐 아니라 실제 기능(도장 문단·
        // 성향 줄)이 게임 안에서 동작하지 않는다. 정적 배선을 유지한다.
        const main = read('src/main.ts');
        expect(main).toContain("from './core/officer_biography_bridge.js'");
        expect(main).toContain("from './core/officer_profile_schema.js'");
        expect(main).toContain("from './core/conversation_system.js'");
    });

    it('main.ts 는 무장 클릭 시 성향 줄을 요청한다', () => {
        expect(read('src/main.ts')).toContain('includeTraitLine: true');
    });

    it('지연 로드 기계(폴백·캐시·peek)를 새로 들여오지 않았다', () => {
        // 404 근본은 6글자짜리 스펙리파터 고정이었지 지연 로드가 아니었다.
        // deferral 을 되살리면 404 가 잠재화되고 실제 기능이 게임에서 죽는다.
        const main = read('src/main.ts');
        for (const symbol of [
            'linkStaticOfficerFallback',
            'loadOfficerBridge',
            'getConversationSystem',
            'peekConversationSystem',
            'preloadOfficerModules',
        ]) {
            expect(main, symbol).not.toContain(symbol);
        }
    });
});

describe('[부팅] 지연 로드 폴백이 Unit B 기능을 보존한다', () => {
    it('폴백 판정은 브리지와 같은 결과를 낸다 (동명이인은 고르지 않는다)', () => {
        // linkStaticOfficerFallback 은 OFFICER_PROFILES 로 브리지와 동일한 판정을 한다.
        // 여기서는 그 규칙 자체를 데이터로 검증한다.
        const ambiguous = OFFICER_PROFILES.ambiguousNames;
        const sample = Object.keys(ambiguous)[0];
        expect(OFFICER_PROFILES.isAmbiguousName(sample)).toBe(true);
        expect(OFFICER_PROFILES.findByName(sample).length).toBeGreaterThan(1);
    });

    it('유일한 이름은 정적 레지스트리만으로 id 까지 resolve 된다 (브리지 없이도)', () => {
        const hits = OFFICER_PROFILES.findByName('관우');
        expect(hits).toHaveLength(1);
        expect(hits[0].id).toMatch(/^off_\d{4}$/);
        expect(Array.isArray(hits[0].traits)).toBe(true);
    });

    it('알 수 없는 이름은 빈 결과라 unlinked 로 내려간다 (throw 하지 않는다)', () => {
        expect(OFFICER_PROFILES.findByName('존재하지않는무장')).toEqual([]);
        expect(OFFICER_PROFILES.isAmbiguousName('존재하지않는무장')).toBe(false);
    });
});
