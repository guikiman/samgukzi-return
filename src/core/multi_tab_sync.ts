/**
 * [E42] 멀티탭 동기화 — SharedWorker 기반 탭 간 상태 일관성 유지
 *
 * MultiTabSyncWorker:
 *   1. SharedWorker로 메인 세션 데이터 공유
 *   2. Lock/Unlock 메커니즘 (한 탭만 쓰기 가능)
 *   3. 변경 시 다른 탭에 브로드캐스트
 *   4. 탭 종료 시 자동 Lock 해제
 */

export interface TabSession {
    readonly tabId: string;
    readonly connectedAt: number;
    readonly lastHeartbeat: number;
}

export interface TabSyncMessage {
    readonly type: 'LOCK_ACQUIRE' | 'LOCK_RELEASE' | 'STATE_UPDATE' | 'HEARTBEAT' | 'TAB_DISCONNECTED';
    readonly tabId: string;
    readonly payload?: string;
    readonly timestamp: number;
}

export interface SyncState {
    readonly activeTabId: string | null;
    readonly sessions: TabSession[];
    readonly lastUpdate: number;
}

export class MultiTabSyncManager {
    private worker: SharedWorker | null = null;
    private tabId: string;
    private listeners: Map<string, Set<(data: any) => void>> = new Map();
    private _isMaster = false;
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private lockTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    get isMaster(): boolean { return this._isMaster; }
    get currentTabId(): string { return this.tabId; }

    init(): boolean {
        if (typeof SharedWorker === 'undefined') return false;
        try {
            this.worker = new SharedWorker(new URL('./multi_tab_sync_worker.js', import.meta.url));
            this.worker.port.start();
            this.worker.port.onmessage = (event: MessageEvent<TabSyncMessage>) => {
                this.handleMessage(event.data);
            };
            this.startHeartbeat();
            return true;
        } catch {
            return false;
        }
    }

    private handleMessage(msg: TabSyncMessage): void {
        switch (msg.type) {
            case 'LOCK_ACQUIRE':
                this._isMaster = msg.tabId === this.tabId;
                break;
            case 'LOCK_RELEASE':
                if (msg.tabId === this.tabId) this._isMaster = false;
                break;
            case 'STATE_UPDATE':
                this.emit('state_update', msg.payload);
                break;
        }
        this.emit('message', msg);
    }

    acquireLock(): void {
        this.postMessage({ type: 'LOCK_ACQUIRE', tabId: this.tabId, payload: undefined, timestamp: Date.now() });
        this._isMaster = true;
        if (this.lockTimer) clearTimeout(this.lockTimer);
        this.lockTimer = setTimeout(() => this.releaseLock(), 30000);
    }

    releaseLock(): void {
        this.postMessage({ type: 'LOCK_RELEASE', tabId: this.tabId, payload: undefined, timestamp: Date.now() });
        this._isMaster = false;
    }

    broadcastState(payload: string): void {
        this.postMessage({ type: 'STATE_UPDATE', tabId: this.tabId, payload, timestamp: Date.now() });
    }

    private postMessage(msg: TabSyncMessage): void {
        if (this.worker) {
            this.worker.port.postMessage(msg);
        }
    }

    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            this.postMessage({ type: 'HEARTBEAT', tabId: this.tabId, payload: undefined, timestamp: Date.now() });
        }, 5000);
    }

    on(event: string, callback: (data: any) => void): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);
    }

    off(event: string, callback: (data: any) => void): void {
        this.listeners.get(event)?.delete(callback);
    }

    private emit(event: string, data: any): void {
        this.listeners.get(event)?.forEach(cb => cb(data));
    }

    destroy(): void {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.lockTimer) clearTimeout(this.lockTimer);
        this._isMaster = false;
        this.postMessage({ type: 'TAB_DISCONNECTED', tabId: this.tabId, payload: undefined, timestamp: Date.now() });
        this.worker?.port.close();
        this.worker = null;
        this.listeners.clear();
    }
}
