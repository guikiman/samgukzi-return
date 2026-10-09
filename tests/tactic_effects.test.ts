import { describe, expect, it } from 'vitest';
import {
    TACTIC_CATEGORIES,
    allResolvedTactics,
    getTacticModifiers,
    isTacticDefined,
    listTacticsByCategory,
    resolveTactic,
    tacticsAvailableTo,
    tradeHoldersByTactic,
    unparsedEffectStrings,
    type TacticCategory,
    type TacticEffectKind,
    type TacticModifier,
    type TacticStat,
} from '../src/core/tactic_effects';
import { TACTICS, UNDEFINED_TACTICS } from '../src/core/tactic_reference_data';
import { OFFICER_PROFILES } from '../src/core/officer_profile_schema';

const ALL = allResolvedTactics();

function mods(name: string): TacticModifier[] {
    return getTacticModifiers(name);
}

describe('전법 해석 레이어 — 데이터 규모', () => {
    it('기준 데이터의 174개 전법을 모두 해석한다', () => {
        expect(ALL).toHaveLength(174);
        expect(TACTICS.size).toBe(174);
        // 공용 26 + 고유 148 = 174
        expect(ALL.filter((t) => t.sheet === '공용전법')).toHaveLength(26);
        expect(ALL.filter((t) => t.sheet === '고유전법')).toHaveLength(148);
    });

    it('모든 전법은 2개의 효과 슬롯을 가진다', () => {
        for (const t of ALL) {
            expect(t.effects).toHaveLength(2);
        }
    });

    it('전법 이름은 유일하다', () => {
        expect(new Set(ALL.map((t) => t.name)).size).toBe(ALL.length);
    });
});
describe('효과 문자열 파싱', () => {
    it('아군 사기 상승 → 아군 사기 버프', () => {
        const m = mods('격려').find((x) => x.kind === 'BUFF');
        expect(m).toBeDefined();
        expect(m!.target).toBe('ALLY');
        expect(m!.stat).toBe('MORALE');
        expect(m!.amount).toBeGreaterThan(0);
    });

    it('적 사기 저하 → 적 사기 디버프', () => {
        const found = ALL.flatMap((x) => mods(x.name)).find((x) => x.stat === 'MORALE' && x.kind === 'DEBUFF');
        expect(found).toBeDefined();
        expect(found!.target).toBe('ENEMY');
    });

    it('공백 유무와 무관하게 같은 효과로 파싱된다 (아군 사기 상승 === 아군사기상승)', () => {
        const spaced = ALL.flatMap((t) => t.effects).find((s) => s.raw === '아군 사기 상승');
        const tight = ALL.flatMap((t) => t.effects).find((s) => s.raw === '아군사기상승');
        expect(spaced).toBeDefined();
        expect(tight).toBeDefined();
        expect(spaced!.modifiers[0].stat).toBe('MORALE');
        expect(tight!.modifiers[0].stat).toBe('MORALE');
    });

    it('power 값이 amount 로 그대로 반영된다', () => {
        const 분전 = resolveTactic('분전');
        expect(분전.effects[0].power).toBe(10);
        expect(분전.effects[0].modifiers[0].amount).toBe(10);
    });

    it('범위/지속은 원본 값 그대로 보존된다', () => {
        const 아수라진 = resolveTactic('아수라진');
        // effect2 = 적 방어저하, range2=null, duration2=10
        expect(아수라진.effects[1].duration).toBe(10);
        expect(아수라진.effects[1].range).toBeNull();
        expect(아수라진.effects[1].modifiers[0].stat).toBe('DEFENSE');
        expect(아수라진.effects[1].modifiers[0].amount).toBe(28);
    });

    it('지표 미특정 효과(피해)는 requiresStat 로 근거 능력을 유도한다', () => {
        const mightDamage = ALL
            .flatMap((t) => t.effects.map((s) => ({ t, s })))
            .filter(({ s }) => s.raw === '피해' && s.modifiers.length > 0);
        expect(mightDamage.length).toBeGreaterThan(0);
        for (const { t, s } of mightDamage) {
            expect(s.modifiers[0].kind).toBe('DAMAGE');
            expect(s.modifiers[0].target).toBe('ENEMY');
            expect(s.modifiers[0].stat).toBe(t.requiresStat === '무력' ? 'MIGHT' : 'INTELLIGENCE');
        }
    });

    it('상태이상 부여 계열은 STATUS_APPLY 로 분류된다', () => {
        for (const raw of ['혼란 부여', '도발 부여', '발화', '전상태이상부여']) {
            const slot = ALL.flatMap((t) => t.effects).find((s) => s.raw === raw);
            expect(slot, `효과 문자열 ${raw} 가 존재해야 한다`).toBeDefined();
            expect(slot!.modifiers[0].kind).toBe('STATUS_APPLY');
            expect(slot!.modifiers[0].target).toBe('ENEMY');
        }
    });

    it('회복/해제 계열은 아군 대상 HEAL/CLEANSE 다', () => {
        const heal = ALL.flatMap((t) => t.effects).find((s) => s.raw === '부상병 회복')!;
        expect(heal.modifiers[0].kind).toBe('HEAL');
        expect(heal.modifiers[0].target).toBe('ALLY');
        expect(heal.modifiers[0].stat).toBe('WOUNDS');

        const cleanse = ALL.flatMap((t) => t.effects).find((s) => s.raw === '상태이상 해소')!;
        expect(cleanse.modifiers[0].kind).toBe('CLEANSE');
        expect(cleanse.modifiers[0].target).toBe('ALLY');
    });

    it('위력이 없는 효과(상태이상 해소)는 amount 0 으로 남기고 원문을 보존한다', () => {
        const 진정 = resolveTactic('진정');
        const slot = 진정.effects[0];
        expect(slot.raw).toBe('상태이상 해소');
        expect(slot.power).toBeNull();
        expect(slot.modifiers).toHaveLength(1);
        expect(slot.modifiers[0].amount).toBe(0);
        expect(slot.modifiers[0].kind).toBe('CLEANSE');
    });

    it('effect2 는 effect1 과 독립적으로 해석된다', () => {
        const 구갑대열 = resolveTactic('구갑대열');
        expect(구갑대열.effects[0].modifiers[0].stat).toBe('DEFENSE');
        expect(구갑대열.effects[1].modifiers[0].kind).toBe('HEAL');
        expect(구갑대열.modifiers).toHaveLength(2);
    });

    it('변경자는 전부 음수가 아닌 amount 를 가진다', () => {
        for (const t of ALL) {
            for (const m of t.modifiers) {
                expect(m.amount).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('effect2 슬롯이 없는 전법은 두 번째 슬롯이 완전히 비어 있다', () => {
        const 분전 = resolveTactic('분전');
        expect(분전.effects[1].raw).toBeNull();
        expect(분전.effects[1].modifiers).toEqual([]);
    });
});

describe('재사용 대기일(cooldown) 파싱', () => {
    it('"18일" → 18 로 숫자 파싱된다', () => {
        expect(resolveTactic('구갑대열').cooldownDays).toBe(18);
        expect(resolveTactic('분전').cooldownDays).toBe(12);
    });

    it('미기재 cooldown 은 null 이다', () => {
        expect(resolveTactic('아수라진').cooldownDays).toBeNull();
    });

    it('전체 데이터의 cooldownDays 는 모두 숫자 또는 null 이다', () => {
        for (const t of ALL) {
            if (t.cooldownDays !== null) {
                expect(Number.isInteger(t.cooldownDays)).toBe(true);
                expect(t.cooldownDays).toBeGreaterThan(0);
            }
        }
    });
});

describe('계통(category) 정규화', () => {
    it('미기재 계통은 미지정 으로 정규화된다', () => {
        const 미기재 = ALL.filter((t) => t.raw?.category === null);
        expect(미기재.length).toBe(42);
        for (const t of 미기재) expect(t.category).toBe('미지정');
    });

    it('listTacticsByCategory 는 계통별 전법을 빠짐없이 반환한다', () => {
        let total = 0;
        for (const c of TACTIC_CATEGORIES) {
            const names = listTacticsByCategory(c);
            total += names.length;
            for (const n of names) {
                expect(resolveTactic(n).category).toBe(c);
            }
        }
        expect(total).toBe(174);
    });

    it('계통 목록은 이름순으로 결정론적이다', () => {
        const first = listTacticsByCategory('공격');
        const second = listTacticsByCategory('공격');
        expect(first).toEqual(second);
        expect([...first].sort()).toEqual(first);
    });

    it('존재하지 않는 계통 문자열에 대해서는 빈 배열을 반환한다', () => {
        expect(listTacticsByCategory('없음' as TacticCategory)).toEqual([]);
    });
});

describe('교역전법(trade) — 공용전법과의 구별 보존', () => {
    const TRADE_NAMES = ['구갑대열', '안식사법', '아수라진', '전상돌격'];

    it('중립 세력 보유 교역전법은 정확히 4종이다', () => {
        expect([...tradeHoldersByTactic().keys()].sort()).toEqual([...TRADE_NAMES].sort());
    });

    it('교역전법은 공용 전법 시트와 이름이 겹치는 기록을 보존한다', () => {
        for (const n of TRADE_NAMES) {
            const t = resolveTactic(n);
            expect(t.nameCollisions.length).toBeGreaterThan(0);
            expect(t.nameCollisions).toContain('고유전법');
            expect(t.nameCollisions).toContain('PK교역전법');
        }
    });

    it('교역전법 보유 세력(중립 세력)이 tradeHolders 에 남는다', () => {
        expect(resolveTactic('구갑대열').tradeHolders).toEqual(['로마-대진국(낙양)']);
        expect(resolveTactic('안식사법').tradeHolders).toEqual(['파르티아-안식국(장안, 완, 상용)']);
        expect(resolveTactic('아수라진').tradeHolders).toEqual(['쿠샤나-귀상국(촉)']);
        expect(resolveTactic('전상돌격').tradeHolders).toEqual(['인도-천축국(남해, 교지)']);
    });

    it('교역 보유 세력은 기존 holders(원전파 세력)와 별개로 보존된다', () => {
        const 구갑대열 = resolveTactic('구갑대열');
        expect(구갑대열.raw?.holders).toBe('로마(대진국)평판');
        expect(구갑대열.tradeHolders).not.toEqual([]);
    });

    it('공용 전법 항목도 tradeHolders 보존으로 중립 보유를 잃지 않는다', () => {
        for (const n of TRADE_NAMES) {
            const t = resolveTactic(n);
            expect(isTacticDefined(n)).toBe(true);
            expect(t.defined).toBe(true);
            expect(t.tradeHolders.length).toBe(1);
        }
    });
});

describe('정의되지 않은 전법 — known-but-undefined 표현', () => {
    it('장수가 참조하지만 정의가 없는 2종이 데이터에 기록되어 있다', () => {
        expect([...UNDEFINED_TACTICS].sort()).toEqual(['오와지변', '충요의열'].sort());
    });

    it('미정의 전법은 조용히 버려지지 않고 UNDEFINED_REFERENCED 로 표현된다', () => {
        for (const n of UNDEFINED_TACTICS) {
            const t = resolveTactic(n);
            expect(t.name).toBe(n);
            expect(t.defined).toBe(false);
            expect(t.status).toBe('UNDEFINED_REFERENCED');
            expect(t.raw).toBeNull();
            expect(t.modifiers).toEqual([]);
            expect(t.cooldownDays).toBeNull();
        }
    });

    it('isTacticDefined 는 참조만 되고 정의 없는 전법을 false 로 본다', () => {
        for (const n of UNDEFINED_TACTICS) {
            expect(isTacticDefined(n)).toBe(false);
        }
    });

    it('미정의 전법 조회는 예외를 던지지 않는다', () => {
        expect(() => resolveTactic('오와지변')).not.toThrow();
        expect(getTacticModifiers('충요의열')).toEqual([]);
        expect(listTacticsByCategory('미지정')).not.toContain('오와지변');
    });

    it('완전히 미지의 이름은 UNKNOWN 으로 구분된다', () => {
        const t = resolveTactic('존재하지않는전법');
        expect(t.status).toBe('UNKNOWN');
        expect(t.defined).toBe(false);
    });
});

describe('장수 보유 전법 조회 (tacticsAvailableTo)', () => {
    it('OFFICER_PROFILES 의 전법 참조와 조회 결과가 일치한다', () => {
        const withTactics = OFFICER_PROFILES.all().filter((p) => p.tactics.length > 0);
        expect(withTactics.length).toBeGreaterThan(0);
        for (const p of withTactics) {
            const resolved = tacticsAvailableTo(p.id);
            expect(resolved.map((r) => r.name)).toEqual(p.tactics);
        }
    });

    it('조회 결과는 전부 defined 여부가 명시되어 있다', () => {
        for (const p of OFFICER_PROFILES.all()) {
            for (const t of tacticsAvailableTo(p.id)) {
                expect(typeof t.defined).toBe('boolean');
                expect(t.status).not.toBe('UNKNOWN');
            }
        }
    });

    it('존재하지 않는 장수 ID 는 빈 배열을 반환한다', () => {
        expect(tacticsAvailableTo('off_999999')).toEqual([]);
    });

    it('전법을 가진 장수가 존재한다 (조회가 의미 있는지 확인)', () => {
        const holders = OFFICER_PROFILES.all().filter((p) => p.tactics.length > 0);
        const sample = holders[0];
        expect(tacticsAvailableTo(sample.id).length).toBeGreaterThan(0);
    });
});

describe('파싱되지 않은 효과 문자열 갭 노출', () => {
    it('갭 목록이 노출되고 정렬되어 있다', () => {
        const gaps = unparsedEffectStrings();
        expect(Array.isArray(gaps)).toBe(true);
        expect([...gaps].sort()).toEqual(gaps);
        expect(new Set(gaps).size).toBe(gaps.length);
    });

    it('파싱 불가 문자열은 원문을 그대로 보존하고 변경자를 내지 않는다', () => {
        // '아군' 단독 표기는 지표를 특정할 수 없어 해석하지 않는다.
        const 명찰추호 = resolveTactic('명찰추호');
        expect(명찰추호.unparsedEffects).toContain('아군');
        expect(명찰추호.effects[0].raw).toBe('아군');
        expect(명찰추호.effects[0].modifiers).toEqual([]);
    });

    it('파싱 불가 문자열은 unparsedEffectStrings 에도 나타난다', () => {
        expect(unparsedEffectStrings()).toContain('아군');
    });

    it('파싱 실패 전법도 나머지 슬롯은 정상 해석된다', () => {
        const 명찰추호 = resolveTactic('명찰추호');
        // effect2 = 상태이상해소 는 정상 파싱된다
        expect(명찰추호.effects[1].modifiers[0].kind).toBe('CLEANSE');
    });

    it('효과 문구가 아예 없는 전법은 unparsedEffects 가 비어 있다', () => {
        const 기계구조 = resolveTactic('기계구조');
        expect(기계구조.effects[0].raw).toBeNull();
        expect(기계구조.effects[1].raw).toBeNull();
        expect(기계구조.modifiers).toEqual([]);
        expect(기계구조.unparsedEffects).toEqual([]);
    });
});

describe('파싱 커버리지 통계 (리포트 근거)', () => {
    it('변경자를 1개 이상 얻는 전법과 갭 전법을 구분해 집계할 수 있다', () => {
        const withModifier = ALL.filter((t) => t.modifiers.length > 0);
        const noModifier = ALL.filter((t) => t.modifiers.length === 0);
        expect(withModifier.length + noModifier.length).toBe(174);
        // 정답이 아니라 "현재 커버리지"를 고정하는 회귀 방지용 단언
        expect(withModifier.length).toBe(132);
        expect(noModifier.length).toBe(42);
    });

    it('효과 문구가 아예 없는 전법 42종은 변경자도 없다', () => {
        const noText = ALL.filter((t) => t.effects.every((s) => s.raw === null));
        expect(noText).toHaveLength(42);
        for (const t of noText) expect(t.modifiers).toEqual([]);
    });

    it('효과 문구가 있는데도 파싱 실패한 전법은 1종뿐이다 (아군 단독 표기)', () => {
        const unparsed = ALL.filter((t) => t.unparsedEffects.length > 0);
        expect(unparsed.map((t) => t.name)).toEqual(['명찰추호']);
        expect(unparsedEffectStrings()).toEqual(['아군']);
    });

    it('파싱된 효과 문자열 종류는 23종이다 (공백 표기 정규화 후)', () => {
        const parsed = new Set<string>();
        for (const t of ALL) {
            for (const s of t.effects) {
                if (s.raw !== null && s.modifiers.length > 0) parsed.add(s.raw.replace(/\s+/g, ''));
            }
        }
        expect(parsed.size).toBe(23);
    });
});

describe('결정론성 / 데이터 무결성', () => {
    it('동일 조회를 반복해도 결과가 동일하다 (캐시 안전)', () => {
        expect(resolveTactic('분전')).toBe(resolveTactic('분전'));
        expect(allResolvedTactics().map((t) => t.name)).toEqual(allResolvedTactics().map((t) => t.name));
    });

    it('getTacticModifiers 는 내부 배열을 노출하지 않는다 (방사본 반환)', () => {
        const a = getTacticModifiers('분전');
        a.push({ target: 'ALLY', stat: 'MORALE', amount: 999, kind: 'BUFF' });
        expect(getTacticModifiers('분전')).toHaveLength(1);
        expect(getTacticModifiers('분전')[0].amount).toBe(10);
    });

    it('변경자 stat/kind 는 선언된 유니온 안에만 있다', () => {
        const STATS: readonly TacticStat[] = ['MORALE', 'DEFENSE', 'SIEGE', 'MOBILITY', 'CHARGE',
            'ALL_STATS', 'ENDURANCE', 'WOUNDS', 'STATUS', 'MIGHT', 'INTELLIGENCE', 'NONE'];
        const KINDS: readonly TacticEffectKind[] = ['DAMAGE', 'BUFF', 'DEBUFF', 'STATUS_APPLY', 'HEAL', 'CLEANSE'];
        for (const t of ALL) {
            for (const m of t.modifiers) {
                expect(STATS).toContain(m.stat);
                expect(KINDS).toContain(m.kind);
                expect(['ALLY', 'ENEMY', 'SELF', 'NONE']).toContain(m.target);
            }
        }
    });

    it('원본 레코드는 수정되지 않는다 (읽기 전용 보존)', () => {
        const 분전 = resolveTactic('분전');
        expect(분전.raw?.name).toBe('분전');
        expect(분전.raw?.effect1).toBe('피해');
        expect(분전.raw?.power1).toBe(10);
    });

    it('effects[0] 와 effects[1] 가 서로 다른 객체를 갖는다', () => {
        const t = resolveTactic('구갑대열');
        expect(t.effects[0]).not.toBe(t.effects[1]);
    });

    it('변경자 총 수가 슬롯별 변경자 수의 합과 같다', () => {
        for (const t of ALL) {
            const sum = t.effects[0].modifiers.length + t.effects[1].modifiers.length;
            expect(t.modifiers).toHaveLength(sum);
        }
    });
});
