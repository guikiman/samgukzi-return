/**
 * 전략 요충지(MapFeature) 엔티티 — 생성·소유권 인덱스·세이브 왕복.
 *
 * [왜 이 테스트가 필요한가]
 * 요충지는 예전엔 MAP_FEATURE_ANCHORS 정적 표(좌표만)였다. 소유권이 없어 점령도
 * 보급도 불가능했다. 엔티티로 승격하면서 세 군데를 건드렸는데, 셋 중 하나라도 빠지면
 * 조용히 깨진다:
 *   - 초기 로드(buildMapFeatures 결과를 initWorld 에 넘기지 않으면 저장 파일에 없음)
 *   - byFaction 인덱스(안 맞추면 점령당한 요충지가 여전히 "우리 것")
 *   - 세이브 왕복(createSnapshot 가 일반 JSON 복제라 별도 처리가 필요 없어야 함)
 */
import { describe, it, expect } from 'vitest';
import { GameStore } from '../src/core/game_store.js';
import { buildMapFeatures, MAP_FEATURE_ANCHORS, CITY_MAX_DEFENSE } from '../src/core/scenario_system.js';
import type { MapFeature } from '../src/core/types.js';

describe('전략 요충지 엔티티', () => {
    it('정적 앵커 수만큼 생성된다', () => {
        expect(buildMapFeatures().length).toBe(Object.keys(MAP_FEATURE_ANCHORS).length);
    });

    it('전부 중립으로 시작한다 (아무 세력도 복리 없이 보유)', () => {
        for (const f of buildMapFeatures()) {
            expect(f.ownerId, `${f.name} 이 시작부터 소유되어 있다`).toBeNull();
        }
    });

    it('수비 병력이 0보다 크고 상한 안에 있다', () => {
        for (const f of buildMapFeatures()) {
            expect(f.garrison, `${f.name} 수비 병력`).toBeGreaterThan(0);
            expect(f.garrison).toBeLessThanOrEqual(f.maxGarrison);
        }
    });

    it('공급 반경이 도시 간격보다 넓다 (인접 판정이 성립해야 함)', () => {
        // 도시 필요 간격은 창 크기에 따라 0.01~0.04 로 변한다. 이보다 좁으면
        // "인접 도시의 포위 수성" 규칙이 한 번도 발동하지 않아 규칙이 죽는다.
        for (const f of buildMapFeatures()) {
            expect(f.supplyRadius, `${f.name} 반경이 도시 간격보다 좁다`).toBeGreaterThan(0.05);
        }
    });

    it('id 가 고유하다', () => {
        const ids = buildMapFeatures().map(f => f.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('좌표가 정규화 0~1 안에 있다', () => {
        for (const f of buildMapFeatures()) {
            expect(f.mapX).toBeGreaterThanOrEqual(0);
            expect(f.mapX).toBeLessThanOrEqual(1);
            expect(f.mapY).toBeGreaterThanOrEqual(0);
            expect(f.mapY).toBeLessThanOrEqual(1);
        }
    });
});

describe('요충지 소유권 인덱스', () => {
    const mk = (id: string, owner: string | null): MapFeature => ({
        id, name: id, kind: 'PASS',
        hexCoord: { q: 0, r: 0 }, mapX: 0.5, mapY: 0.5,
        ownerId: owner, garrison: 3000, maxGarrison: 3000, supplyRadius: 0.09,
    });

    it('setMapFeatures 로 넣고.byFaction 으로 조회된다', () => {
        const store = new GameStore();
        store.setMapFeatures([mk('a', 'fac_0'), mk('b', 'fac_1'), mk('c', null)]);
        expect(store.getAllMapFeatures().length).toBe(3);
        expect(store.getMapFeaturesByFaction('fac_0').map(f => f.id)).toEqual(['a']);
        expect(store.getMapFeaturesByFaction('fac_1').map(f => f.id)).toEqual(['b']);
    });

    it('소유권을 넘기면 인덱스가 따라간다', () => {
        const store = new GameStore();
        store.setMapFeatures([mk('a', 'fac_0')]);
        store.updateMapFeature('a', { ownerId: 'fac_1' });
        expect(store.getMapFeaturesByFaction('fac_0'), '이전 세력에 아직 남아 있다').toHaveLength(0);
        expect(store.getMapFeaturesByFaction('fac_1').map(f => f.id)).toEqual(['a']);
    });

    it('중립으로 돌려놓으면 어느 인덱스에도 남지 않는다', () => {
        const store = new GameStore();
        store.setMapFeatures([mk('a', 'fac_0')]);
        store.updateMapFeature('a', { ownerId: null });
        expect(store.getMapFeaturesByFaction('fac_0')).toHaveLength(0);
        expect(store.getMapFeature('a')?.ownerId).toBeNull();
    });

    it('id 로 조회되고 없는 id 는 null 이다', () => {
        const store = new GameStore();
        store.setMapFeatures([mk('a', null)]);
        expect(store.getMapFeature('a')?.id).toBe('a');
        expect(store.getMapFeature('nope')).toBeNull();
    });
});

describe('요충지 세이브 왕복', () => {
    it('소유권과 수비 병력이 저장·복구된다', () => {
        const store = new GameStore();
        store.setMapFeatures(buildMapFeatures());
        store.updateMapFeature('feature_호로관', { ownerId: 'fac_2', garrison: 1234 });

        const snap = JSON.parse(JSON.stringify(store.createSnapshot())) as ReturnType<GameStore['createSnapshot']>;
        expect(snap.mapFeatures['feature_호로관'].ownerId).toBe('fac_2');
        expect(snap.mapFeatures['feature_호로관'].garrison).toBe(1234);

        const restored = new GameStore();
        restored.restoreSnapshot(snap);
        expect(restored.getMapFeature('feature_호로관')?.ownerId).toBe('fac_2');
        expect(restored.getMapFeature('feature_호로관')?.garrison).toBe(1234);
        expect(restored.getAllMapFeatures().length).toBe(Object.keys(MAP_FEATURE_ANCHORS).length);
    });

    it('initWorld 가 요충지를 받으면 상태에 들어간다', () => {
        const store = new GameStore();
        store.initWorld([], [], [], [], buildMapFeatures());
        expect(store.getAllMapFeatures().length).toBe(Object.keys(MAP_FEATURE_ANCHORS).length);
    });
});

describe('회귀 — 도시 방어 상한', () => {
    it('CITY_MAX_DEFENSE 가 여전히 공유 상수다', () => {
        // 요충지 작업으로 types 를 건드렸으니 도시 상한 상수가 깨지지 않았는지 확인한다.
        expect(CITY_MAX_DEFENSE).toBe(100);
    });
});
