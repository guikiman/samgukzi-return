/**
 * [3] 부대 편성 '원클릭 프리셋' 및 템플릿 세이브
 *
 * ArmyPresetSystem:
 *   - savePreset(): 현재 부대 구성을 localStorage에 저장
 *   - loadPreset(): 저장된 프리셋 복원
 *   - autoFillStrongest(): 무력 순 장수 자동 배치
 *   - recentFormations(): 최근 N개 편성 자동 보관 (LRU)
 */

import type { OfficerID, IGameStore } from './types.js';

export interface UnitSlot {
    readonly commanderId: OfficerID;
    readonly troopType: 'infantry' | 'cavalry' | 'archer' | 'siege';
    readonly subCommanders: OfficerID[];
    readonly equipment: string[];
}

export interface ArmyPreset {
    readonly id: string;
    readonly name: string;
    readonly slots: readonly UnitSlot[];
    readonly createdAt: number;
    readonly updatedAt: number;
}

const STORAGE_KEY = 'samgukzi_return_army_presets';
const MAX_PRESETS = 20;
const MAX_RECENT = 5;

export class ArmyPresetSystem {
    private readonly store: IGameStore;
    private presets: ArmyPreset[] = [];
    private recentFormations: ArmyPreset[] = [];

    constructor(store: IGameStore) {
        this.store = store;
        this.loadFromStorage();
    }

    /** 현재 편성을 프리셋으로 저장 */
    savePreset(name: string, slots: UnitSlot[]): ArmyPreset {
        const preset: ArmyPreset = {
            id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name,
            slots: [...slots],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.presets.unshift(preset);
        if (this.presets.length > MAX_PRESETS) this.presets.pop();
        this.saveToStorage();
        return preset;
    }

    /** 프리셋 불러오기 */
    loadPreset(id: string): ArmyPreset | null {
        const preset = this.presets.find(p => p.id === id) ?? null;

        if (preset) {
            // 최근 사용 목록에 추가 (LRU)
            this.recentFormations = this.recentFormations.filter(r => r.id !== id);
            this.recentFormations.unshift(preset);
            if (this.recentFormations.length > MAX_RECENT) this.recentFormations.pop();
        }

        return preset;
    }

    /** [3] 이전 편성 불러오기 (가장 최근 사용) */
    loadLatestPreset(): ArmyPreset | null {
        return this.recentFormations[0] ?? this.presets[0] ?? null;
    }

    /** [3] 원클릭 최강 군대 편성 — 무력 순 장수 자동 배치 */
    autoFillStrongest(factionId: string, count: number = 5): UnitSlot[] {
        const officers = this.store.getOfficersByFaction(factionId)
            .filter(o => o.status !== 'FREE')
            .sort((a, b) => b.stats.might - a.stats.might)  // 무력 순 정렬
            .slice(0, count);

        return officers.map((o, i) => ({
            commanderId: o.id,
            troopType: (['infantry', 'cavalry', 'archer', 'siege'] as const)[i % 4],
            subCommanders: [],
            equipment: [],
        }));
    }

    /** 모든 프리셋 목록 */
    getAllPresets(): readonly ArmyPreset[] { return this.presets; }

    /** 최근 사용 편성 */
    getRecentFormations(): readonly ArmyPreset[] { return this.recentFormations; }

    /** 프리셋 삭제 */
    deletePreset(id: string): boolean {
        const before = this.presets.length;
        this.presets = this.presets.filter(p => p.id !== id);
        this.recentFormations = this.recentFormations.filter(r => r.id !== id);
        this.saveToStorage();
        return this.presets.length < before;
    }

    private loadFromStorage(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) this.presets = JSON.parse(raw) as ArmyPreset[];
        } catch { this.presets = []; }
    }

    private saveToStorage(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.presets));
        } catch { /* storage full */ }
    }
}
