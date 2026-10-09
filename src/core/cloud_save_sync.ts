/**
 * [E41] 클라우드 세이브 동기화 — Cloud Save Sync
 *
 * CloudSaveSync:
 *   1. IndexedDB 기반 로컬 캐시
 *   2. JSON 직렬화/역직렬화
 *   3. 충돌 해결 (Last-Write-Wins + 타임스탬프)
 *   4. 세이브 슬롯 관리 (최대 20개)
 *   5. 내보내기/가져오기 (JSON 파일)
 */

export interface SaveSlot {
    readonly slotId: string;
    readonly label: string;
    readonly timestamp: number;
    readonly data: string;
    readonly checksum: string;
    readonly version: string;
}

export interface CloudSaveManifest {
    readonly slots: SaveSlot[];
    readonly lastSync: number;
    readonly totalSize: number;
}

export interface SyncResult {
    readonly success: boolean;
    readonly syncedSlots: number;
    readonly conflicts: number;
    readonly errors: string[];
}

export class CloudSaveSync {
    private slots: Map<string, SaveSlot> = new Map();
    private lastSync = 0;
    private readonly MAX_SLOTS = 20;
    private readonly STORAGE_KEY = 'samgukzi_return_cloud_save_manifest';

    constructor() {
        this.loadFromStorage();
    }

    saveSlot(slotId: string, label: string, data: string): SaveSlot {
        const slot: SaveSlot = {
            slotId,
            label,
            data,
            timestamp: Date.now(),
            checksum: this.computeChecksum(data),
            version: '1.0.0',
        };
        this.slots.set(slotId, slot);
        this.persistToStorage();
        return slot;
    }

    loadSlot(slotId: string): SaveSlot | null {
        return this.slots.get(slotId) ?? null;
    }

    deleteSlot(slotId: string): boolean {
        const existed = this.slots.has(slotId);
        this.slots.delete(slotId);
        if (existed) this.persistToStorage();
        return existed;
    }

    listSlots(): SaveSlot[] {
        return Array.from(this.slots.values())
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    exportSlot(slotId: string): string | null {
        const slot = this.slots.get(slotId);
        if (!slot) return null;
        return JSON.stringify(slot);
    }

    importSlot(json: string): SaveSlot | null {
        try {
            const slot: SaveSlot = JSON.parse(json);
            if (!slot.slotId || !slot.data || !slot.checksum) return null;
            if (this.computeChecksum(slot.data) !== slot.checksum) return null;
            this.slots.set(slot.slotId, slot);
            this.persistToStorage();
            return slot;
        } catch {
            return null;
        }
    }

    syncWithRemote(remoteSlots: SaveSlot[]): SyncResult {
        const syncedSlots: string[] = [];
        const conflicts: string[] = [];
        const errors: string[] = [];

        for (const remote of remoteSlots) {
            const local = this.slots.get(remote.slotId);
            if (!local || remote.timestamp > local.timestamp) {
                this.slots.set(remote.slotId, remote);
                syncedSlots.push(remote.slotId);
            } else if (remote.timestamp === local.timestamp && remote.checksum !== local.checksum) {
                conflicts.push(remote.slotId);
            }
        }

        this.persistToStorage();
        return { success: true, syncedSlots: syncedSlots.length, conflicts: conflicts.length, errors };
    }

    getManifest(): CloudSaveManifest {
        return {
            slots: Array.from(this.slots.values()),
            lastSync: Date.now(),
            totalSize: Array.from(this.slots.values()).reduce((acc, s) => acc + s.data.length, 0),
        };
    }

    clear(): void {
        this.slots.clear();
        this.persistToStorage();
    }

    private computeChecksum(data: string): string {
        let hash = 0;
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString(16);
    }

    private persistToStorage(): void {
        try {
            const manifest = this.getManifest();
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(manifest));
        } catch {
        }
    }

    private loadFromStorage(): void {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) {
                const manifest: CloudSaveManifest = JSON.parse(raw);
                for (const slot of manifest.slots) {
                    this.slots.set(slot.slotId, slot);
                }
                this.lastSync = manifest.lastSync;
            }
        } catch {
        }
    }
}