/**
 * [E42] SharedWorker 백그라운드 스크립트 — 탭 간 상태 중재
 */

const connections: Map<string, MessagePort> = new Map();
let currentLockHolder: string | null = null;
const sessions: Map<string, { connectedAt: number; lastHeartbeat: number }> = new Map();
const heartbeatTimeout = 15000;

(self as unknown as SharedWorkerGlobalScope).onconnect = (event: MessageEvent) => {
    const port = event.ports[0];

    port.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        const tabId = msg.tabId;

        switch (msg.type) {
            case 'LOCK_ACQUIRE': {
                if (currentLockHolder === null || currentLockHolder === tabId) {
                    currentLockHolder = tabId;
                    port.postMessage({ type: 'LOCK_ACQUIRE', tabId, timestamp: Date.now() });
                    broadcast(tabId, { type: 'LOCK_CHANGED', tabId: currentLockHolder, timestamp: Date.now() });
                }
                break;
            }
            case 'LOCK_RELEASE': {
                if (currentLockHolder === tabId) {
                    currentLockHolder = null;
                    broadcast(tabId, { type: 'LOCK_CHANGED', tabId: null, timestamp: Date.now() });
                }
                break;
            }
            case 'STATE_UPDATE': {
                broadcast(tabId, msg);
                break;
            }
            case 'HEARTBEAT': {
                const now = Date.now();
                sessions.set(tabId, { connectedAt: sessions.get(tabId)?.connectedAt ?? now, lastHeartbeat: now });
                cleanupStaleSessions();
                break;
            }
            case 'TAB_DISCONNECTED': {
                if (currentLockHolder === tabId) currentLockHolder = null;
                sessions.delete(tabId);
                broadcast(tabId, { type: 'TAB_DISCONNECTED', tabId, timestamp: Date.now() });
                break;
            }
        }
    };

    connections.set(`conn_${Date.now()}_${Math.random()}`, port);
    port.start();
};

function broadcast(senderTabId: string, msg: any): void {
    for (const [id, conn] of connections) {
        try {
            conn.postMessage(msg);
        } catch {
            connections.delete(id);
        }
    }
}

function cleanupStaleSessions(): void {
    const now = Date.now();
    for (const [tabId, session] of sessions) {
        if (now - session.lastHeartbeat > heartbeatTimeout) {
            sessions.delete(tabId);
            if (currentLockHolder === tabId) {
                currentLockHolder = null;
                broadcast(tabId, { type: 'LOCK_CHANGED', tabId: null, timestamp: now });
            }
        }
    }
}
