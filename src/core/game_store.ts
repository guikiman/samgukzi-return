/**
 * 삼국지리턴 — 싱글톤 중앙 상태 저장소
 * 파일: src/core/game_store.ts
 *
 * 정규화 상태 트리 (Normalized State Tree)
 * 모든 엔티티를 1차원 테이블로 정규화하여 O(1) 조회 보장
 * Redux 스타일 구독 + 디스패치
 */

import {
    IGameStore, NormalizedState, GlobalState,
    Officer, Faction, City, Army, RelationshipEdge,
    OfficerID, FactionID, CityID, ArmyID,
    ICommand, CommandContext, GamePhase, GameTime, monthToSeason, Weather, Season,
} from './types.js';
// 고성능 관계망 그래프 DB — 파생 O(1) 인덱스 (graph_db.py TS 포팅)
import { TriStateGraphDatabase } from './relationship_graph_db.js';

type StoreListener = (state: NormalizedState, globalState: GlobalState) => void;

class GameStore implements IGameStore {
    private state: NormalizedState;
    private globalState: GlobalState;
    private listeners: Set<StoreListener>;
    private static instance: GameStore | null = null;
    /** 파생 관계망 그래프 인덱스 — O(1) 이웃/적대 조회 (relationship_graph_db.ts) */
    private readonly graphIndex: TriStateGraphDatabase = new TriStateGraphDatabase();

    private constructor() {
        this.state = {
            officers: {},
            factions: {},
            cities: {},
            armies: {},
            relationships: {},
            byFaction: { officers: {}, cities: {}, armies: {} },
            byCity: { officers: {} },
            byOfficer: { relationships: {} },
        };
        this.globalState = {
            phase: GamePhase.TITLE,
            time: { year: 192, month: 1 },
            season: 'WINTER',
            weather: 'SUNNY',
            turnCount: 0,
            selectedOfficerId: null,
            playerFactionId: null,
        };
        this.listeners = new Set();
    }

    static getInstance(): GameStore {
        if (!GameStore.instance) GameStore.instance = new GameStore();
        return GameStore.instance;
    }

    getState(): NormalizedState { return this.state; }
    getGlobalState(): GlobalState { return this.globalState; }

    // ============================================================
    // 엔티티 조회 — O(1)
    // ============================================================
    getOfficer(id: OfficerID): Officer | null { return this.state.officers[id] ?? null; }
    getFaction(id: FactionID): Faction | null { return this.state.factions[id] ?? null; }
    getCity(id: CityID): City | null { return this.state.cities[id] ?? null; }
    getArmy(id: ArmyID): Army | null { return this.state.armies[id] ?? null; }

    getRelationships(officerId: OfficerID): RelationshipEdge[] {
        return this.state.byOfficer.relationships[officerId] ?? [];
    }

    // ============================================================
    // 엔티티 업데이트 — O(1) + 인덱스 동기화
    // ============================================================
    updateOfficer(id: OfficerID, updates: Partial<Officer>): void {
        const existing = this.state.officers[id];
        if (!existing) return;
        const oldFaction = existing.factionId;
        const oldCity = existing.cityId;

        this.state.officers[id] = { ...existing, ...updates, id };

        const newOfficer = this.state.officers[id];
        const newFaction = newOfficer.factionId;
        const newCity = newOfficer.cityId;

        if (oldFaction !== newFaction) {
            removeFromIndex(this.state.byFaction.officers, oldFaction, id);
            addToIndex(this.state.byFaction.officers, newFaction, id);
        }
        if (oldCity !== newCity) {
            removeFromIndex(this.state.byCity.officers, oldCity, id);
            addToIndex(this.state.byCity.officers, newCity, id);
            if (oldFaction) {
                const fac = this.state.factions[oldFaction];
                if (fac) {
                    const newCityList = fac.cities.filter(c => c !== oldCity);
                    this.state.factions[oldFaction] = { ...fac, cities: newCityList };
                }
            }
            if (newFaction && newCity) {
                const fac = this.state.factions[newFaction];
                if (fac && !fac.cities.includes(newCity)) {
                    this.state.factions[newFaction] = { ...fac, cities: [...fac.cities, newCity] };
                }
            }
        }

        this.notify();
    }

    updateFaction(id: FactionID, updates: Partial<Faction>): void {
        const existing = this.state.factions[id];
        if (!existing) return;
        this.state.factions[id] = { ...existing, ...updates, id };
        this.notify();
    }

    updateCity(id: CityID, updates: Partial<City>): void {
        const existing = this.state.cities[id];
        if (!existing) return;
        const oldOwner = existing.ownerId;
        this.state.cities[id] = { ...existing, ...updates, id };
        const newOwner = this.state.cities[id].ownerId;

        if (oldOwner !== newOwner) {
            if (oldOwner) {
                const fac = this.state.factions[oldOwner];
                if (fac) {
                    this.state.factions[oldOwner] = { ...fac, cities: fac.cities.filter(c => c !== id) };
                }
                // byFaction 도시 인덱스 동기화 — getCitiesByFaction 정확성 [결함 수정]
                const idx = this.state.byFaction.cities[oldOwner];
                if (idx) {
                    this.state.byFaction.cities[oldOwner] = idx.filter(c => c !== id);
                }
            }
            if (newOwner) {
                const fac = this.state.factions[newOwner];
                if (fac && !fac.cities.includes(id)) {
                    this.state.factions[newOwner] = { ...fac, cities: [...fac.cities, id] };
                }
                const idx = this.state.byFaction.cities[newOwner];
                if (idx && !idx.includes(id)) {
                    this.state.byFaction.cities[newOwner] = [...idx, id];
                }
            }
        }
        this.notify();
    }

    updateArmy(id: ArmyID, updates: Partial<Army>): void {
        const existing = this.state.armies[id];
        if (!existing) return;
        this.state.armies[id] = { ...existing, ...updates, id };
        this.notify();
    }

    // ============================================================
    // 엔티티 추가/삭제
    // ============================================================
    addOfficer(officer: Officer): void {
        this.state.officers[officer.id] = officer;
        addToIndex(this.state.byFaction.officers, officer.factionId, officer.id);
        addToIndex(this.state.byCity.officers, officer.cityId, officer.id);
        this.state.byOfficer.relationships[officer.id] = [];
        this.notify();
    }

    /** 세력 추가 — 모딩 핫 인젝션 [309] 및 런타임 세력 생성용. 인덱스 동기화 포함 */
    addFaction(faction: Faction): void {
        this.state.factions[faction.id] = faction;
        for (const cityId of faction.cities) {
            addToIndex(this.state.byFaction.cities, faction.id, cityId);
        }
        for (const officerId of faction.officers) {
            addToIndex(this.state.byFaction.officers, faction.id, officerId);
        }
        for (const armyId of faction.armies) {
            addToIndex(this.state.byFaction.armies, faction.id, armyId);
        }
        this.notify();
    }

    /** 도시 추가 — 모딩 핫 인젝션 [309] 및 런타임 도시 생성용. 인덱스 동기화 포함 */
    addCity(city: City): void {
        this.state.cities[city.id] = city;
        for (const officerId of city.officerIds) {
            addToIndex(this.state.byCity.officers, city.id, officerId);
        }
        if (city.ownerId) {
            addToIndex(this.state.byFaction.cities, city.ownerId, city.id);
            const fac = this.state.factions[city.ownerId];
            if (fac && !fac.cities.includes(city.id)) {
                this.state.factions[city.ownerId] = { ...fac, cities: [...fac.cities, city.id] };
            }
        }
        this.notify();
    }

    removeOfficer(id: OfficerID): void {
        const officer = this.state.officers[id];
        if (!officer) {
            // 무장 엔티티가 없어도 관계 에지 참여자로서 그래프 인덱스에 남아 있을 수 있으므로 정리 시도
            if (this.graphIndex.removeWarlord(id)) this.notify();
            return;
        }
        removeFromIndex(this.state.byFaction.officers, officer.factionId, id);
        removeFromIndex(this.state.byCity.officers, officer.cityId, id);
        delete this.state.officers[id];
        delete this.state.byOfficer.relationships[id];
        // 파생 그래프 인덱스에서도 노드 제거 — 양방향 에지 정리 포함
        this.graphIndex.removeWarlord(id);
        this.notify();
    }

    /** 세력 제거 — 멸망 처리용. 소속 도시 무주화 + 무장/인덱스 정리 [213] */
    removeFaction(id: FactionID): void {
        const faction = this.state.factions[id];
        if (!faction) return;
        // 소속 도시 무주화 (updateCity 경유로 인덱스 동기화 보장)
        for (const cityId of [...faction.cities]) {
            this.updateCity(cityId, { ownerId: null });
        }
        for (const officerId of faction.officers) {
            removeFromIndex(this.state.byFaction.officers, id, officerId);
        }
        delete this.state.factions[id];
        delete this.state.byFaction.cities[id];
        delete this.state.byFaction.armies[id];
        this.notify();
    }

    addRelationship(edge: RelationshipEdge): void {
        const key = `${edge.source}_${edge.target}_${edge.type}`;
        this.state.relationships[key] = edge;
        if (!this.state.byOfficer.relationships[edge.source]) {
            this.state.byOfficer.relationships[edge.source] = [];
        }
        this.state.byOfficer.relationships[edge.source].push(edge);
        if (!this.state.byOfficer.relationships[edge.target]) {
            this.state.byOfficer.relationships[edge.target] = [];
        }
        const reverseEdge: RelationshipEdge = {
            ...edge, source: edge.target, target: edge.source,
        };
        this.state.byOfficer.relationships[edge.target].push(reverseEdge);
        // 파생 그래프 인덱스 동기화 — O(1) 우호도/이웃 조회 유지
        this.syncGraphIndex(edge);
        this.notify();
    }

    /** RelationshipEdge → 그래프 인덱스 에지 동기화 */
    private syncGraphIndex(edge: RelationshipEdge): void {
        const type = edge.type === 'NEMESIS' ? 'enemy'
            : edge.type === 'SWORN_BROTHER' ? 'sworn_brother'
                : edge.type === 'RIVAL' ? 'enemy' : 'friend';
        // affinity(-100~100)를 0~100 우호도로 정규화
        const weight = Math.max(0, Math.min(100, edge.affinity + 50));
        this.graphIndex.setRelationship(edge.source, edge.target, weight, type);
    }

    /**
     * 파생 관계망 그래프 인덱스 접근자 — 성능 민감 경로(관계망 뷰어, AI 등용 판정)용.
     * 세이브 복원 등 대량 변경 후에는 rebuildGraphIndex() 호출 필요.
     */
    getGraphIndex(): TriStateGraphDatabase {
        return this.graphIndex;
    }

    /** 전체 관계를 그래프 인덱스에 재구축 — 월드 초기화/세이브 복원 후 호출 */
    rebuildGraphIndex(): void {
        this.graphIndex.clear();
        for (const edge of Object.values(this.state.relationships)) {
            this.syncGraphIndex(edge);
        }
    }

    // ============================================================
    // 전역 상태 업데이트
    // ============================================================
    setGlobalState(updates: Partial<GlobalState>): void {
        this.globalState = { ...this.globalState, ...updates };
        if (updates.time) {
            this.globalState.season = monthToSeason(this.globalState.time.month);
        }
        this.notify();
    }

    advanceTime(): void {
        let { year, month } = this.globalState.time;
        month += 1;
        if (month > 12) { month = 1; year += 1; }
        this.globalState.time = { year, month };
        this.globalState.season = monthToSeason(month);
        this.globalState.turnCount += 1;
        this.notify();
    }

    setPhase(phase: GamePhase): void {
        this.globalState.phase = phase;
        this.notify();
    }

    // ============================================================
    // 스냅샷 (세이브/로드)
    // ============================================================
    createSnapshot(): NormalizedState {
        return JSON.parse(JSON.stringify(this.state));
    }

    restoreSnapshot(snapshot: NormalizedState): void {
        this.state = JSON.parse(JSON.stringify(snapshot));
        this.notify();
    }

    // ============================================================
    // 구독 시스템
    // ============================================================
    subscribe(listener: StoreListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener(this.state, this.globalState);
        }
    }

    // ============================================================
    // 디스패치 (커맨드 실행)
    // ============================================================
    dispatch(command: ICommand): import('./types.js').CommandResult {
        const context: CommandContext = {
            store: this,
            logger: (msg: string) => console.log(msg),
        };
        return command.execute(context);
    }

    // ============================================================
    // 월드 초기화
    // ============================================================
    initWorld(officers: Officer[], factions: Faction[], cities: City[], armies: Army[]): void {
        this.state = {
            officers: {}, factions: {}, cities: {}, armies: {}, relationships: {},
            byFaction: { officers: {}, cities: {}, armies: {} },
            byCity: { officers: {} },
            byOfficer: { relationships: {} },
        };
        // 글로벌 상태 리셋 — 싱글톤 재사용 시 이전 판의 playerFactionId/턴 잔존 방지 [결함 수정]
        this.globalState.turnCount = 0;
        this.globalState.selectedOfficerId = null;
        this.globalState.playerFactionId = null;

        for (const o of officers) this.addOfficer(o);
        for (const f of factions) {
            this.state.factions[f.id] = f;
            this.state.byFaction.officers[f.id] = f.officers.slice();
            this.state.byFaction.cities[f.id] = f.cities.slice();
            this.state.byFaction.armies[f.id] = f.armies.slice();
        }
        for (const c of cities) {
            this.state.cities[c.id] = c;
            this.state.byCity.officers[c.id] = c.officerIds.slice();
        }
        for (const a of armies) this.state.armies[a.id] = a;

        this.notify();
    }

    getOfficersByFaction(factionId: FactionID): Officer[] {
        const ids = this.state.byFaction.officers[factionId] ?? [];
        return ids.map(id => this.state.officers[id]).filter((o): o is Officer => o !== undefined);
    }

    getCitiesByFaction(factionId: FactionID): City[] {
        const ids = this.state.byFaction.cities[factionId] ?? [];
        return ids.map(id => this.state.cities[id]).filter((c): c is City => c !== undefined);
    }

    getOfficersByCity(cityId: CityID): Officer[] {
        const ids = this.state.byCity.officers[cityId] ?? [];
        return ids.map(id => this.state.officers[id]).filter((o): o is Officer => o !== undefined);
    }

    getAllOfficers(): Officer[] { return Object.values(this.state.officers); }
    getAllFactions(): Faction[] { return Object.values(this.state.factions); }
    getAllCities(): City[] { return Object.values(this.state.cities); }
}

// ============================================================
// 인덱스 헬퍼 함수들
// ============================================================
function addToIndex(
    index: Record<string, string[]>,
    key: string | null,
    value: string,
): void {
    if (!key) return;
    if (!index[key]) index[key] = [];
    if (!index[key].includes(value)) index[key].push(value);
}

function removeFromIndex(
    index: Record<string, string[]>,
    key: string | null,
    value: string,
): void {
    if (!key || !index[key]) return;
    index[key] = index[key].filter(v => v !== value);
    if (index[key].length === 0) delete index[key];
}

// 싱글톤 인스턴스 내보내기
export const gameStore = GameStore.getInstance();
export { GameStore };
