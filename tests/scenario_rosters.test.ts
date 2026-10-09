import { describe, it, expect } from 'vitest';
import { buildWorld, getKnownOfficerName, parseStartDate, CITY_MAP_COORDS, getScenarioRelationships, resolveProtagonistId } from '../src/core/scenario_system';
import scenarioIndex from '../src/data/scenarios/index.json';
import type { ScenarioData } from '../src/core/scenario_system';

function makeScenario(id: string, factions: Array<{ name: string; capital: string; leader_id: string }>): ScenarioData {
    return {
        id,
        title_kr: '테스트',
        title_en: 'test',
        start_date: '200-01',
        description: '',
        difficulty: 1,
        factions: factions.map(f => ({ ...f, color: '#123456' })),
        special_conditions: { victory: '', historical_mode: true },
        status: 'active',
    };
}

describe('SCENARIO_ROSTERS 기반 월드 빌드', () => {
    it('관도대전(04) 조조 세력: 역사적 참모진이 수도에 배치된다', () => {
        const s = makeScenario('04', [
            { name: '조조', capital: '허창', leader_id: 'cao_cao' },
            { name: '원소', capital: '업', leader_id: 'yuan_shao' },
        ]);
        const world = buildWorld(s, 0);

        const names = world.officers.map(o => o.name);
        expect(names).toContain('조조');
        expect(names).toContain('장료');
        expect(names).toContain('순유');
        expect(names).toContain('곽가');
        // 원소 진영
        expect(names).toContain('안량');
        expect(names).toContain('문추');
        expect(names).toContain('전풍');
        // 제네릭 무장이 남아있으면 안 됨
        expect(names.filter(n => n.includes('_gen'))).toHaveLength(0);
    });

    it('군주는 LORD, 부장은 OFFICER 상태를 갖는다', () => {
        // 실제 05 시나리오 순서(조조/손권/유비)를 그대로 사용해야 05:2 로스터가 매칭된다
        const s = makeScenario('05', [
            { name: '조조', capital: '허창', leader_id: 'cao_cao' },
            { name: '손권', capital: '건업', leader_id: 'sun_quan' },
            { name: '유비', capital: '신야', leader_id: 'liu_bei' },
        ]);
        const world = buildWorld(s, 2);
        const liuBei = world.officers.find(o => o.id === 'liu_bei')!;
        const guanYu = world.officers.find(o => o.id === 'guan_yu')!;
        expect(liuBei.status).toBe('LORD');
        expect(guanYu.status).toBe('OFFICER');
    });

    it('모든 무장이 한글 이름을 가진다 (id 그대로 노출 금지)', () => {
        const s = makeScenario('02', [
            { name: '동탁', capital: '낙양', leader_id: 'dong_zhuo' },
            { name: '원소', capital: '업', leader_id: 'yuan_shao' },
            { name: '조조', capital: '진류', leader_id: 'cao_cao' },
            { name: '손견', capital: '장사', leader_id: 'sun_jian' },
        ]);
        const world = buildWorld(s, 0);
        for (const o of world.officers) {
            // 아이디 그대로인 경우: 영문 id 형태 (_ 포함 영문) — 없어야 함
            expect(/^[a-z_]+$/.test(o.name)).toBe(false);
        }
    });

    it('중복 시나리오에서 같은 무장이 두 세력에 배정되지 않는다', () => {
        const s = makeScenario('03', [
            { name: '조조', capital: '연주', leader_id: 'cao_cao' },
            { name: '유비', capital: '서주', leader_id: 'liu_bei' },
            { name: '여포', capital: '하비', leader_id: 'lv_bu' },
        ]);
        const world = buildWorld(s, 0);
        const ids = world.officers.map(o => o.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('parseStartDate가 연/월을 분리한다', () => {
        expect(parseStartDate('184-01')).toEqual({ year: 184, month: 1 });
        expect(parseStartDate('234-12')).toEqual({ year: 234, month: 12 });
    });

    it('getKnownOfficerName이 보조 무장 이름표도 처리한다', () => {
        expect(getKnownOfficerName('li_jue_esc')).toBe('이각');
        expect(getKnownOfficerName('guo_si_esc')).toBe('곽사');
    });

    it('05 삼분천하는 확충된 명단(34명)·45도시·4세력과 초기 인맥 8건을 제공한다', () => {
        const scenario = (scenarioIndex as ScenarioData[]).find(s => s.id === '05')!;
        const world = buildWorld(scenario, 0);
        // 로스터 27명(10+9+5+3) + 재야 7명, 수도 4 + 2차도시 41
        expect(world.officers).toHaveLength(34);
        expect(world.cities).toHaveLength(45);
        expect(world.factions).toHaveLength(4);
        const ids = world.officers.map(o => o.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ['xun_yu', 'xiahou_yuan', 'zhang_he', 'gan_ning', 'pang_tong', 'ma_chao', 'liu_biao', 'liu_zhang', 'fa_zheng', 'zhang_song']) {
            expect(ids).toContain(id);
        }
        const names = world.officers.map(o => o.name);
        for (const o of world.officers) {
            expect(/^[a-z_]+$/.test(o.name)).toBe(false);
        }
        expect(names).toContain('순욱');
        expect(names).toContain('감녕');
        expect(names).toContain('방통');
        expect(names).toContain('유장');
        expect(world.factions.map(f => f.name)).toEqual(['조조', '손권', '유비', '유장']);
        const validIds = new Set(ids);
        expect(getScenarioRelationships('05', validIds)).toHaveLength(8);
    });

    it('전 시나리오는 최대 도시 배치·고유 무장·한글 이름을 만족한다', () => {
        const expected: Record<string, { cities: number; factions: number }> = {
            '01': { cities: 46, factions: 2 },
            '02': { cities: 47, factions: 4 },
            '03': { cities: 46, factions: 5 },
            '04': { cities: 45, factions: 4 },
            '05': { cities: 45, factions: 4 },
            '06': { cities: 46, factions: 3 },
            // [08] 전장태세 — 지도 57개 도시 전부(9 수도 + 48 이차), 세력 9개.
            '08': { cities: 57, factions: 9 },
        };
        for (const scenario of scenarioIndex as ScenarioData[]) {
            if (scenario.id === '07') continue;
            const world = buildWorld(scenario, 0);
            const ids = world.officers.map(o => o.id);
            expect(new Set(ids).size, `${scenario.id} 중복`).toBe(ids.length);
            for (const o of world.officers) {
                expect(/^[a-z_]+$/.test(o.name), `${scenario.id}:${o.id}`).toBe(false);
            }
            const exp = expected[scenario.id];
            expect(world.cities.length, `${scenario.id} 도시`).toBe(exp.cities);
            expect(world.factions.length, `${scenario.id} 세력`).toBe(exp.factions);
            for (const f of world.factions) {
                expect(f.cities.length, `${scenario.id}:${f.id} 도시`).toBeGreaterThan(0);
                expect(f.officers.length, `${scenario.id}:${f.id} 무장`).toBeGreaterThan(0);
            }
        }
    });

    it('주인공 무장 확정은 세력 소속이면 그대로, 아니면 군주로 폴백한다', () => {
        const scenario = (scenarioIndex as ScenarioData[]).find(s => s.id === '05')!;
        const world = buildWorld(scenario, 2);
        expect(resolveProtagonistId(world, 'guan_yu')).toBe('guan_yu');
        expect(resolveProtagonistId(world, 'cao_cao')).toBe('liu_bei');
        expect(resolveProtagonistId(world, null)).toBe('liu_bei');
        expect(resolveProtagonistId(world, 'no_such_officer')).toBe('liu_bei');
    });

    it('전 시나리오의 도시는 서로 다른 위치에 놓인다 — 같은 자리에 겹치면 클릭이 뒤바뀐다', () => {
        // [결함] 07 시나리오가 청두와 성도(=成都, 같은 도시)를 2차도시로 함께 두어
        // 두 도시가 같은 앵커(0.4512, 0.5407 / 0.4512, 0.5411)에 그려졌다.
        // 좌표가 0.6px 차이라 지도 클릭이 항상 배열 선두(청두)로 해석됐다.
        for (const scenario of scenarioIndex as ScenarioData[]) {
            const world = buildWorld(scenario, 0);
            const keys = world.cities.map(c => `${(c.mapImageX ?? c.mapX).toFixed(3)},${(c.mapImageY ?? c.mapY).toFixed(3)}`);
            const dupAnchor = keys.filter((key, i) => keys.indexOf(key) !== i);
            expect(dupAnchor, `${scenario.id} 앵커 중복: ${dupAnchor.join(' / ')}`).toHaveLength(0);
            const names = world.cities.map(c => c.name);
            const dupName = names.filter((name, i) => names.indexOf(name) !== i);
            expect(dupName, `${scenario.id} 도시 이름 중복: ${dupName.join(' / ')}`).toHaveLength(0);
        }
    });

    it('07 삼국鼎峙 시나리오는 새 도시·무장·초기 인맥을 제공한다', () => {
        const scenario = (scenarioIndex as ScenarioData[]).find(s => s.id === '07')!;
        const world = buildWorld(scenario, 1);
        // 수도 3개(洛陽/成都/建業) + 2차도시 21개
        // [결함 수정] 이전엔 세력당 2도시였고 세력 간 접경이 0쌍이라
        // AI가 24개월 내내 공격하지 못했다. 이제 위(12) 촉(7) 오(5) 다 2도시 이상.
        expect(world.cities.map(c => c.name).slice(0, 9)).toEqual([
            '낙양', '청두', '부경', '서주', '진류', '강릉', '한중', '동정', '진주',
        ]);
        expect(world.factions.map(f => f.cities.length)).toEqual([12, 7, 5]);
        expect(CITY_MAP_COORDS['청두']).toEqual({ x: 0.30, y: 0.57 });
        expect(CITY_MAP_COORDS['부경']).toEqual({ x: 0.77, y: 0.62 });
        expect(world.officers.map(o => o.name)).toEqual(expect.arrayContaining(['사오필', '유찬', '손호', '제갈격']));
        const caoPi = world.officers.find(o => o.id === 'cao_pi')!;
        expect(caoPi.stats.intelligence).toBe(76);
        expect(caoPi.personality).toBe('CALM');
        const chengdu = world.cities.find(c => c.name === '청두')!;
        expect(chengdu.population).toBe(96000);
        // 수도 프로필은 2차도시와 달리 development 만 병력 규모로 바뀌고
        // 개발 지표(farming 등)는 원래 값 68 을 유지한다.
        expect(chengdu.developmentStats.farming).toBe(68);
        expect(world.relationships).toHaveLength(8);
        expect(world.relationships.some(r => r.source === 'cao_pi' && r.target === 'liu_shan' && r.type === 'RIVAL')).toBe(true);
        const validIds = new Set(world.officers.map(o => o.id));
        expect(getScenarioRelationships('07', validIds)).toHaveLength(8);
        expect(getScenarioRelationships('07', new Set(['cao_pi']))).toHaveLength(0);
    });
});
