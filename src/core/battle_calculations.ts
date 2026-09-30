/**
 * 삼국지리턴 — 헥사곤 전술 전투 물리 계산기 및 대미지 밸런싱 시스템
 * 파일: src/core/battle_calculations.ts
 *
 * 핵수 수학 공식:
 * 1. ZOC (Zone of Control) 이동 불가 판정
 * 2. 기본 전투 및 전법 대미지 공식:
 *    D = (BaseAttack × Might_Attacker / Defense_Defender) × TerrainPenalty × WeatherFactor + ChainBonus
 * 3. 인접 상생/의형제/배우자 연격 체인:
 *    ChainBonus = Σ (BaseAttack × 0.4 × RelationshipMultiplier)
 *    (의형제: 1.5, 배우자: 1.3, 상생: 1.1)
 */

import {
    HexCoord, Weather, RelationType, OfficerID,
    Officer, RelationshipEdge,
} from './types.js';

// ============================================================
// 전투 도메인 타입 정의
// ============================================================

export type UnitType = 'INFANTRY' | 'CAVALRY' | 'ARCHER' | 'SIEGE';
export type TerrainType = 'PLAINS' | 'FOREST' | 'MOUNTAIN' | 'RIVER' | 'MARSH' | 'DESERT' | 'WATER';

export interface BattleTile {
    q: number;
    r: number;
    terrain: TerrainType;
    elevation: number;
    defense: number;
    hasForestCover: boolean;
    isRiverCrossing: boolean;
}

export interface BattleUnit {
    unitId: string;
    officerId: OfficerID;
    unitType: UnitType;
    soldiers: number;
    morale: number;
    training: number;
    position: HexCoord;
    facing: number;
    isSupplied: boolean;
    baseAttack: number;
    baseDefense: number;
    movementPoints: number;
    maxMovementPoints: number;
    hasEvasionSkill: boolean;
    evasionProbability: number;
}

export interface AttackerInfo {
    unit: BattleUnit;
    officer: Officer;
    tile: BattleTile;
}

export interface DefenderInfo {
    unit: BattleUnit;
    officer: Officer;
    tile: BattleTile;
}

export interface DamageResult {
    baseDamage: number;
    terrainPenalty: number;
    weatherFactor: number;
    typeMatchupMultiplier: number;
    elevationBonus: number;
    chainBonus: number;
    totalDamage: number;
    isCritical: boolean;
    details: string[];
}

export interface ChainParticipant {
    unit: BattleUnit;
    officer: Officer;
    relationType: RelationType;
    relationshipMultiplier: number;
    contribution: number;
}

export interface ZOCResult {
    isCut: boolean;
    zocSources: HexCoord[];
    evaded: boolean;
    reason: string;
}

export const HEX_DIRECTIONS: readonly HexCoord[] = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

// ============================================================
// BattleCalculationsEngine — 전투 물리 계산 엔진
// ============================================================

export class BattleCalculationsEngine {
    private tiles: Map<string, BattleTile>;
    private relationships: Map<OfficerID, Map<OfficerID, RelationshipEdge>>;
    private weather: Weather;

    constructor(tiles: BattleTile[], relationships: RelationshipEdge[], weather: Weather) {
        this.tiles = new Map();
        for (const tile of tiles) {
            this.tiles.set(this.tileKey(tile.q, tile.r), tile);
        }
        this.relationships = new Map();
        for (const edge of relationships) {
            if (!this.relationships.has(edge.source)) {
                this.relationships.set(edge.source, new Map());
            }
            this.relationships.get(edge.source)!.set(edge.target, edge);
        }
        this.weather = weather;
    }

    private tileKey(q: number, r: number): string {
        return `${q},${r}`;
    }

    // ============================================================
    // 헥사곤 거리 계산 (calculateHexDistance)
    // ============================================================
    /**
     * Axial 좌표계 기반 두 헥스 타일 간의 거리 계산
     * Hex distance = (|dq| + |dr| + |dq + dr|) / 2
     * s = -q - r 이므로 |ds| = |dq + dr|
     */
    calculateHexDistance(a: HexCoord, b: HexCoord): number {
        const dq = Math.abs(a.q - b.q);
        const dr = Math.abs(a.r - b.r);
        const ds = Math.abs(a.q + a.r - b.q - b.r);
        return Math.floor((dq + dr + ds) / 2);
    }

    // ============================================================
    // 헥스 인접 6방향 좌표 반환
    // ============================================================
    getHexNeighbors(coord: HexCoord): HexCoord[] {
        return HEX_DIRECTIONS.map(dir => ({
            q: coord.q + dir.q,
            r: coord.r + dir.r,
        }));
    }

    getTile(q: number, r: number): BattleTile | null {
        return this.tiles.get(this.tileKey(q, r)) ?? null;
    }

    // ============================================================
    // [1] ZOC (Zone of Control) 이동 불가 물리 연산
    // ============================================================
    /**
     * 적 부대가 위치한 헥스의 인접 6개 타일 벡터 영역을 탐색하여,
     * 아군 유닛이 이 영역에 진입하는 순간 남은 이동력(AP)에 관계없이
     * 기동을 강제 정지시키고, 회피 특기가 있을 때만 일정 확률로 무시.
     *
     * ZOC 판정 로직:
     * 1. 목적지 헥스의 6방향 인접 타일에 적 유닛이 있는지 탐색
     * 2. 적 유닛이 인접하면 ZOC 발동 → 이동 강제 정지
     * 3. 회피 특기(hasEvasionSkill)가 있으면 evasionProbability 확률로 ZOC 무시
     *
     * @param targetHex - 이동하려는 목적지 헥스
     * @param enemyPositions - 적 유닛들의 위치 배열
     * @param movingUnit - 이동 중인 아군 유닛
     */
    isZOCCut(
        targetHex: HexCoord,
        enemyPositions: HexCoord[],
        movingUnit: BattleUnit,
    ): ZOCResult {
        const zocSources: HexCoord[] = [];
        const neighbors = this.getHexNeighbors(targetHex);

        for (const enemyPos of enemyPositions) {
            for (const neighbor of neighbors) {
                if (enemyPos.q === neighbor.q && enemyPos.r === neighbor.r) {
                    zocSources.push(enemyPos);
                }
            }
        }

        if (zocSources.length === 0) {
            return {
                isCut: false,
                zocSources: [],
                evaded: false,
                reason: 'ZOC 미발동 — 인접 적 유닛 없음',
            };
        }

        if (movingUnit.hasEvasionSkill && movingUnit.evasionProbability > 0) {
            const evasionRoll = Math.random();
            if (evasionRoll < movingUnit.evasionProbability) {
                return {
                    isCut: false,
                    zocSources,
                    evaded: true,
                    reason: `ZOC 회피 성공 (확률: ${(movingUnit.evasionProbability * 100).toFixed(1)}%, 주사위: ${(evasionRoll * 100).toFixed(1)}%)`,
                };
            }
            return {
                isCut: true,
                zocSources,
                evaded: false,
                reason: `ZOC 회피 실패 (확률: ${(movingUnit.evasionProbability * 100).toFixed(1)}%, 주사위: ${(evasionRoll * 100).toFixed(1)}%)`,
            };
        }

        return {
            isCut: true,
            zocSources,
            evaded: false,
            reason: `ZOC 발동 — 적 ${zocSources.length}개 부대가 인접 (이동력과 무관하게 강제 정지)`,
        };
    }

    // ============================================================
    // [2] 기본 전투 및 전법 대미지 공식 (calculateDamage)
    // ============================================================
    /**
     * 대미지 공식:
     * D = (BaseAttack × Might_Attacker / Defense_Defender) × TerrainPenalty × WeatherFactor + ChainBonus
     *
     * 추가 가중치:
     * - 병과 상성: 보병 → 기병 → 궁병 → 보병 (가위바위보)
     * - 고지대 버프: 공격자 타일 높이 > 방어자 타일 높이일 때
     *   고도 1m당 사거리 +1, 대미지 +15%
     *
     * 부동 소수점 오차 및 0으로 나누기 방지:
     * - Defense가 0일 때 최소값 1로 clamping
     * - 모든 곱셈 후 반올림하여 정수화
     */
    calculateDamage(
        attacker: AttackerInfo,
        defender: DefenderInfo,
        chainBonus: number,
    ): DamageResult {
        const details: string[] = [];
        const safeDefense = Math.max(1, defender.unit.baseDefense);

        const baseTerm = (attacker.unit.baseAttack * attacker.officer.stats.might) / safeDefense;
        details.push(`기본: (${attacker.unit.baseAttack} × ${attacker.officer.stats.might}) / ${safeDefense} = ${baseTerm.toFixed(2)}`);

        const terrainPenalty = this.calculateTerrainPenalty(attacker.tile, defender.tile, attacker.unit.unitType);
        details.push(`지형 패널티: ${terrainPenalty.toFixed(3)}`);

        const weatherFactor = this.calculateWeatherFactor(this.weather, attacker.unit.unitType);
        details.push(`기상 계수: ${weatherFactor.toFixed(3)}`);

        const typeMatchup = this.calculateTypeMatchup(attacker.unit.unitType, defender.unit.unitType);
        details.push(`병과 상성: ${typeMatchup.toFixed(3)}`);

        const elevationBonus = this.calculateElevationBonus(attacker.tile, defender.tile);
        details.push(`고지대 버프: ×${elevationBonus.toFixed(3)}`);

        const coreDamage = baseTerm * terrainPenalty * weatherFactor * typeMatchup * elevationBonus;
        details.push(`핵심 대미지: ${coreDamage.toFixed(2)}`);

        const totalDamage = Math.max(1, Math.round(coreDamage + chainBonus));
        details.push(`최종: ${coreDamage.toFixed(2)} + ${chainBonus.toFixed(2)} (체인) = ${totalDamage}`);

        const isCritical = this.checkCritical(attacker.unit, defender.unit);

        return {
            baseDamage: Math.round(baseTerm),
            terrainPenalty,
            weatherFactor,
            typeMatchupMultiplier: typeMatchup,
            elevationBonus,
            chainBonus,
            totalDamage,
            isCritical,
            details,
        };
    }

    // ============================================================
    // 지형 패널티 계산
    // ============================================================
    /**
     * 지형별 방어 가중치:
     * - PLAINS: 1.0 (기본)
     * - FOREST: 0.8 (보병 공격 시 0.7, 숲 엄폐)
     * - MOUNTAIN: 0.6 (산악 방어 우세)
     * - RIVER: 0.9 (강 도하 중)
     * - MARSH: 0.7 (습지)
     * - DESERT: 1.0
     * - WATER: 0.5 (수상)
     *
     * 방어자 타일의 defense 수치도 추가 반영
     */
    private calculateTerrainPenalty(
        attackerTile: BattleTile,
        defenderTile: BattleTile,
        attackerUnitType: UnitType,
    ): number {
        const terrainMultiplier: Record<TerrainType, number> = {
            PLAINS: 1.0,
            FOREST: attackerUnitType === 'INFANTRY' ? 0.7 : 0.8,
            MOUNTAIN: 0.6,
            RIVER: 0.9,
            MARSH: 0.7,
            DESERT: 1.0,
            WATER: 0.5,
        };

        let penalty = terrainMultiplier[defenderTile.terrain] ?? 1.0;

        if (defenderTile.hasForestCover) {
            penalty *= 0.85;
        }

        if (defenderTile.isRiverCrossing && attackerUnitType === 'CAVALRY') {
            penalty *= 0.7;
        }

        const defenseReduction = Math.max(0, defenderTile.defense) / 100;
        penalty *= (1 - defenseReduction * 0.3);

        return Math.max(0.1, penalty);
    }

    // ============================================================
    // 기상 계수 계산
    // ============================================================
    /**
     * 날씨별 전투 효율 계수:
     * - SUNNY: 1.0 (기본)
     * - CLOUDY: 0.98
     * - RAIN: 궁병 0.7, 기병 0.85, 보병 0.95
     * - SNOW: 궁병 0.5, 기병 0.6, 보병 0.8
     * - STORM: 모든 병과 0.5
     * - FOG: 궁병 0.4, 기병 0.9, 보병 0.9
     */
    private calculateWeatherFactor(weather: Weather, unitType: UnitType): number {
        const weatherTable: Record<Weather, Record<UnitType, number>> = {
            SUNNY: { INFANTRY: 1.0, CAVALRY: 1.0, ARCHER: 1.0, SIEGE: 1.0 },
            CLOUDY: { INFANTRY: 0.98, CAVALRY: 0.98, ARCHER: 0.98, SIEGE: 0.98 },
            RAIN: { INFANTRY: 0.95, CAVALRY: 0.85, ARCHER: 0.7, SIEGE: 0.8 },
            SNOW: { INFANTRY: 0.8, CAVALRY: 0.6, ARCHER: 0.5, SIEGE: 0.6 },
            STORM: { INFANTRY: 0.5, CAVALRY: 0.5, ARCHER: 0.5, SIEGE: 0.4 },
            FOG: { INFANTRY: 0.9, CAVALRY: 0.9, ARCHER: 0.4, SIEGE: 0.7 },
        };

        const factor = weatherTable[weather]?.[unitType] ?? 1.0;
        return Math.max(0.1, factor);
    }

    // ============================================================
    // 병과 상성 계산 (가위바위보)
    // ============================================================
    /**
     * 병과 상성:
     * - 보병(INFANTRY) → 기병(CAVALRY): 1.5배 (창병이 기병에 강함)
     * - 기병(CAVALRY) → 궁병(ARCHER): 1.5배 (기병이 궁병에 강함)
     * - 궁병(ARCHER) → 보병(INFANTRY): 1.5배 (궁병이 보병에 강함)
     * - 같은 병과: 1.0배
     * - 공성병(SIEGE): 모든 보병/기병에 0.8배, 궁병에 1.2배
     */
    private calculateTypeMatchup(attackerType: UnitType, defenderType: UnitType): number {
        if (attackerType === defenderType) return 1.0;

        const matchupTable: Record<UnitType, Record<UnitType, number>> = {
            INFANTRY: { CAVALRY: 1.5, ARCHER: 0.75, INFANTRY: 1.0, SIEGE: 0.8 },
            CAVALRY: { ARCHER: 1.5, INFANTRY: 0.75, CAVALRY: 1.0, SIEGE: 0.8 },
            ARCHER: { INFANTRY: 1.5, CAVALRY: 0.75, ARCHER: 1.0, SIEGE: 1.2 },
            SIEGE: { INFANTRY: 0.8, CAVALRY: 0.8, ARCHER: 0.8, SIEGE: 1.0 },
        };

        return matchupTable[attackerType]?.[defenderType] ?? 1.0;
    }

    // ============================================================
    // 고지대 버프 계산
    // ============================================================
    /**
     * 공격자 타일 높이 > 방어자 타일 높이일 때:
     * - 고도 1m당 사거리 +1 (별도 처리)
     * - 대미지 +15% per 1m 고도차
     *
     * elevationBonus = 1 + (attackerElev - defenderElev) × 0.15
     * 단, attackerElev > defenderElev일 때만 적용
     */
    private calculateElevationBonus(attackerTile: BattleTile, defenderTile: BattleTile): number {
        const elevationDiff = attackerTile.elevation - defenderTile.elevation;
        if (elevationDiff <= 0) return 1.0;

        const bonusPerMeter = 0.15;
        const maxBonus = 3.0;
        const bonus = 1 + elevationDiff * bonusPerMeter;
        return Math.min(maxBonus, bonus);
    }

    /**
     * 고도차에 따른 사거리 보너스 (1m당 +1 사거리)
     */
    calculateRangeBonus(attackerTile: BattleTile, defenderTile: BattleTile): number {
        const elevationDiff = attackerTile.elevation - defenderTile.elevation;
        return Math.max(0, elevationDiff);
    }

    // ============================================================
    // 크리티컬 판정
    // ============================================================
    private checkCritical(attacker: BattleUnit, defender: BattleUnit): boolean {
        const moraleDiff = attacker.morale - defender.morale;
        const trainingBonus = attacker.training / 200;
        const baseCritRate = 0.05 + Math.max(0, moraleDiff / 100) * 0.1 + trainingBonus;
        const critRate = Math.min(0.35, baseCritRate);
        return Math.random() < critRate;
    }

    // ============================================================
    // [3] 인접 상생/의형제/배우자 연격 체인 (triggerCooperativeChain)
    // ============================================================
    /**
     * 공격 대상 적 유닛 주변 헥스에 아군 공격자와 '상생', '의형제', '배우자'
     * 관계를 가진 우군 부대가 존재할 경우, 각 우군의 무력/지력 및 친밀도 수준에
     * 비례하여 자동으로 협동 전법이 동시 발동되어 합산되는 체인 대미지.
     *
     * 공식:
     * ChainBonus = Σ (BaseAttack × 0.4 × RelationshipMultiplier)
     *
     * RelationshipMultiplier:
     * - 의형제(SWORN_BROTHER): 1.5
     * - 배우자(SPOUSE): 1.3
     * - 상생(FRIEND): 1.1
     * - 기타 관계: 1.0 (체인 불발동)
     *
     * 친밀도 가중치: affinity / 100 을 곱하여 반영
     *
     * @param attackerOfficerId - 공격자 무장 ID
     * @param targetHex - 공격 대상 적 유닛 위치
     * @param allyUnits - 전장의 모든 아군 부대 (officerId, unit, position)
     */
    triggerCooperativeChain(
        attackerOfficerId: OfficerID,
        attackerUnit: BattleUnit,
        targetHex: HexCoord,
        allyUnits: { officerId: OfficerID; unit: BattleUnit; position: HexCoord }[],
        officerLookup: (id: OfficerID) => Officer | null,
    ): { chainBonus: number; participants: ChainParticipant[]; details: string[] } {
        const details: string[] = [];
        const participants: ChainParticipant[] = [];

        const targetNeighbors = this.getHexNeighbors(targetHex);
        const neighborSet = new Set(targetNeighbors.map(h => this.tileKey(h.q, h.r)));

        const relationshipMultipliers: Partial<Record<RelationType, number>> = {
            SWORN_BROTHER: 1.5,
            SPOUSE: 1.3,
            FRIEND: 1.1,
        };

        for (const ally of allyUnits) {
            if (ally.officerId === attackerOfficerId) continue;

            const allyKey = this.tileKey(ally.position.q, ally.position.r);
            if (!neighborSet.has(allyKey)) continue;

            const relationEdge = this.relationships.get(attackerOfficerId)?.get(ally.officerId);
            if (!relationEdge) continue;

            const multiplier = relationshipMultipliers[relationEdge.type];
            if (!multiplier) continue;

            const allyOfficer = officerLookup(ally.officerId);
            if (!allyOfficer) continue;

            const affinityFactor = Math.max(0, Math.min(1, relationEdge.affinity / 100));

            const statContribution = (allyOfficer.stats.might + allyOfficer.stats.leadership) / 200;

            const contribution = Math.round(
                ally.unit.baseAttack * 0.4 * multiplier * affinityFactor * statContribution,
            );

            if (contribution > 0) {
                participants.push({
                    unit: ally.unit,
                    officer: allyOfficer,
                    relationType: relationEdge.type,
                    relationshipMultiplier: multiplier,
                    contribution,
                });
                details.push(
                    `${allyOfficer.name} (${relationEdge.type}, 계수 ${multiplier}, 친밀도 ${relationEdge.affinity}) → +${contribution}`,
                );
            }
        }

        const totalChainBonus = participants.reduce((sum, p) => sum + p.contribution, 0);

        if (totalChainBonus > 0) {
            details.unshift(`체인 발동: ${participants.length}명 참여, 총 +${totalChainBonus}`);
        } else {
            details.push('체인 미발동 — 인접 관계 유닛 없음');
        }

        return { chainBonus: totalChainBonus, participants, details };
    }

    // ============================================================
    // 종합 전투 해결 — 대미지 + 체인 계산 통합
    // ============================================================
    resolveAttack(
        attacker: AttackerInfo,
        defender: DefenderInfo,
        allyUnits: { officerId: OfficerID; unit: BattleUnit; position: HexCoord }[],
        officerLookup: (id: OfficerID) => Officer | null,
    ): { damage: DamageResult; chain: { chainBonus: number; participants: ChainParticipant[]; details: string[] } } {
        const chain = this.triggerCooperativeChain(
            attacker.officer.id,
            attacker.unit,
            defender.tile,
            allyUnits,
            officerLookup,
        );

        const damage = this.calculateDamage(attacker, defender, chain.chainBonus);

        if (damage.isCritical) {
            damage.totalDamage = Math.round(damage.totalDamage * 1.5);
            damage.details.push(`크리티컬! 대미지 ×1.5 → ${damage.totalDamage}`);
        }

        return { damage, chain };
    }

    // ============================================================
    // 보급선 단절 검사 (BFS)
    // ============================================================
    /**
     * 아군 유닛에서 수도/보급거점까지의 경로가 적군에 의해 차단되지 않았는지 BFS 탐색.
     * 적 유닛이 위치한 헥스는 통과 불가.
     */
    isSupplyLineCut(
        unitPos: HexCoord,
        capitalPos: HexCoord,
        enemyPositions: HexCoord[],
    ): boolean {
        if (unitPos.q === capitalPos.q && unitPos.r === capitalPos.r) {
            return false;
        }

        const enemySet = new Set(enemyPositions.map(p => this.tileKey(p.q, p.r)));
        const visited = new Set<string>([this.tileKey(unitPos.q, unitPos.r)]);
        const queue: HexCoord[] = [unitPos];

        while (queue.length > 0) {
            const current = queue.shift()!;

            if (current.q === capitalPos.q && current.r === capitalPos.r) {
                return false;
            }

            const neighbors = this.getHexNeighbors(current);
            for (const neighbor of neighbors) {
                const key = this.tileKey(neighbor.q, neighbor.r);
                if (visited.has(key)) continue;
                if (enemySet.has(key)) continue;
                if (!this.tiles.has(key)) continue;

                const tile = this.tiles.get(key)!;
                if (tile.terrain === 'WATER') continue;

                visited.add(key);
                queue.push(neighbor);
            }
        }

        return true;
    }

    // ============================================================
    // 전장 전체 ZOC 맵 생성
    // ============================================================
    /**
     * 현재 전장의 모든 적 유닛 주변 6방향 헥스를 ZOC 영역으로 마킹.
     * 반환된 Set에 포함된 헥스로 진입 시 이동 강제 정지.
     */
    generateZOCMap(enemyPositions: HexCoord[]): Set<string> {
        const zocMap = new Set<string>();

        for (const enemyPos of enemyPositions) {
            const neighbors = this.getHexNeighbors(enemyPos);
            for (const neighbor of neighbors) {
                const key = this.tileKey(neighbor.q, neighbor.r);
                if (this.tiles.has(key)) {
                    zocMap.add(key);
                }
            }
            zocMap.add(this.tileKey(enemyPos.q, enemyPos.r));
        }

        return zocMap;
    }

    // ============================================================
    // 이동력 소모 계산 (지형 + 병종 + ZOC)
    // ============================================================
    /**
     * 각 병종별 지형 이동 비용:
     * - INFANTRY: PLAINS 1, FOREST 1.5, MOUNTAIN 2, RIVER 3
     * - CAVALRY: PLAINS 0.5, FOREST 2, MOUNTAIN 3, RIVER 4
     * - ARCHER: PLAINS 1, FOREST 1.5, MOUNTAIN 2.5, RIVER 3
     * - SIEGE: PLAINS 2, FOREST 3, MOUNTAIN 4, RIVER 5
     */
    calculateMovementCost(
        fromHex: HexCoord,
        toHex: HexCoord,
        unitType: UnitType,
        zocMap: Set<string>,
    ): number {
        const targetTile = this.getTile(toHex.q, toHex.r);
        if (!targetTile) return Infinity;
        if (targetTile.terrain === 'WATER') return Infinity;

        const terrainCosts: Record<UnitType, Record<TerrainType, number>> = {
            INFANTRY: { PLAINS: 1, FOREST: 1.5, MOUNTAIN: 2, RIVER: 3, MARSH: 2.5, DESERT: 1.5, WATER: Infinity },
            CAVALRY: { PLAINS: 0.5, FOREST: 2, MOUNTAIN: 3, RIVER: 4, MARSH: 3.5, DESERT: 1, WATER: Infinity },
            ARCHER: { PLAINS: 1, FOREST: 1.5, MOUNTAIN: 2.5, RIVER: 3, MARSH: 2.5, DESERT: 1.5, WATER: Infinity },
            SIEGE: { PLAINS: 2, FOREST: 3, MOUNTAIN: 4, RIVER: 5, MARSH: 4, DESERT: 2.5, WATER: Infinity },
        };

        let cost = terrainCosts[unitType]?.[targetTile.terrain] ?? 1;
        cost += targetTile.elevation * 0.1;

        const toKey = this.tileKey(toHex.q, toHex.r);
        if (zocMap.has(toKey)) {
            cost = Infinity;
        }

        return cost;
    }
}
