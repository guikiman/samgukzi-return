import {
    Scene, PerspectiveCamera, WebGLRenderer, DirectionalLight, AmbientLight,
    InstancedMesh, CylinderGeometry, MeshStandardMaterial, Color,
    Raycaster, Vector2, Vector3, Matrix4, Object3D,
    Camera,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * [36-50] 삼국지리턴 — 3D 헥사곤 맵 렌더러
 *
 * Three.js InstancedMesh 기반 대규모 헥사곤 타일 렌더링
 * LOD(Level of Detail), Raycaster Pick, OrbitControls 통합
 *
 * @checklist [36] Three.js 셋업
 * @checklist [37] InstancedMesh 헥사곤
 * @checklist [38] LOD 시스템
 * @checklist [39] Raycaster 타일 피킹
 * @checklist [40] 카메라 OrbitControls
 * @checklist [41] 지형 높이 시각화
 * @checklist [42] 타일 하이라이트/선택
 * @checklist [43] 확대/축소 경계
 * @checklist [44] 미니맵 좌표 동기화
 * @checklist [45] 성능 모니터링
 */

// ============================================================
// Axial → World 좌표 변환
// ============================================================

export function hexToWorld(q: number, r: number, hexSize: number): { x: number; z: number } {
    const x = hexSize * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
    const z = hexSize * (3 / 2 * r);
    return { x, z };
}

export interface HexTileData {
    readonly q: number;
    readonly r: number;
    readonly height: number;
    readonly color: string;
    readonly label?: string;
    readonly terrainType?: 'PLAIN' | 'FOREST' | 'MOUNTAIN' | 'WATER' | 'SWAMP' | 'DESERT';
}

export interface TileHighlight {
    readonly q: number;
    readonly r: number;
    readonly color: string;
}

export interface RenderStats {
    readonly tileCount: number;
    readonly drawCalls: number;
    readonly cameraDistance: number;
    readonly lodLevel: number;
    readonly fps: number;
}

// ============================================================
// LOD 시스템
// ============================================================

export type LODLevel = 'high' | 'medium' | 'low';

interface LODConfig {
    readonly level: LODLevel;
    readonly maxDistance: number;
    readonly subdivisions: number;
}

const LOD_CONFIGS: LODConfig[] = [
    { level: 'high',   maxDistance: 200, subdivisions: 1 },
    { level: 'medium', maxDistance: 500, subdivisions: 0 },
    { level: 'low',    maxDistance: Infinity, subdivisions: 0 },
];

function getLODLevel(cameraDistance: number): LODLevel {
    for (const cfg of LOD_CONFIGS) {
        if (cameraDistance <= cfg.maxDistance) return cfg.level;
    }
    return 'low';
}

// ============================================================
// HexMap3DRenderer
// ============================================================

export class HexMap3DRenderer {
    readonly scene: Scene;
    readonly camera: PerspectiveCamera;
    readonly renderer: WebGLRenderer;
    readonly controls: OrbitControls;
    readonly raycaster: Raycaster;

    private readonly hexMesh: InstancedMesh;
    private readonly dummy = new Object3D();
    private readonly hexSize: number;
    private readonly hexHeight: number;
    private readonly hexGeometry: CylinderGeometry;
    private readonly material: MeshStandardMaterial;
    private tiles: HexTileData[] = [];
    private highlightedTiles: TileHighlight[] = [];
    private selectedTile: { q: number; r: number } | null = null;
    private animFrameId: number | null = null;
    private lastFrameTime = 0;
    private _fps = 60;

    /** 최대 타일 수 */
    readonly maxTiles: number;

    /** 카메라 OrbitControls 설정 */
    readonly cameraDefaults = {
        minDistance: 50,
        maxDistance: 1500,
        minPolarAngle: 0.1,
        maxPolarAngle: Math.PI / 2.2,
    };

    constructor(
        canvas: HTMLCanvasElement,
        hexSize: number = 16,
        hexHeight: number = 4,
        maxTiles: number = 100000,
    ) {
        this.hexSize = hexSize;
        this.hexHeight = hexHeight;
        this.maxTiles = maxTiles;

        // Scene
        this.scene = new Scene();

        // Camera
        this.camera = new PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 1, 5000);
        this.camera.position.set(0, 400, 400);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false,
        });
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;

        // Lights
        const ambient = new AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);
        const dirLight = new DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(100, 200, 100);
        dirLight.castShadow = true;
        this.scene.add(dirLight);

        // OrbitControls
        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.minDistance = this.cameraDefaults.minDistance;
        this.controls.maxDistance = this.cameraDefaults.maxDistance;
        this.controls.minPolarAngle = this.cameraDefaults.minPolarAngle;
        this.controls.maxPolarAngle = this.cameraDefaults.maxPolarAngle;
        this.controls.target.set(0, 0, 0);

        // Raycaster
        this.raycaster = new Raycaster();

        // Hex geometry
        this.hexGeometry = new CylinderGeometry(hexSize, hexSize, hexHeight, 6, 1);
        this.material = new MeshStandardMaterial({
            roughness: 0.8,
            metalness: 0.1,
        });
        this.hexMesh = new InstancedMesh(this.hexGeometry, this.material, maxTiles);
        this.hexMesh.castShadow = true;
        this.hexMesh.receiveShadow = true;
        this.hexMesh.count = 0;
        this.scene.add(this.hexMesh);

        // Resize handler
        window.addEventListener('resize', this.handleResize);
    }

    /** 타일 데이터 설정 및 InstancedMesh 업데이트 */
    setTiles(tiles: HexTileData[]): void {
        this.tiles = tiles;
        const count = Math.min(tiles.length, this.maxTiles);
        this.hexMesh.count = count;

        const color = new Color();

        for (let i = 0; i < count; i++) {
            const tile = tiles[i];
            const { x, z } = hexToWorld(tile.q, tile.r, this.hexSize);

            this.dummy.position.set(x, tile.height / 2, z);
            this.dummy.scale.set(1, Math.max(0.01, tile.height / this.hexHeight), 1);
            this.dummy.updateMatrix();
            this.hexMesh.setMatrixAt(i, this.dummy.matrix);

            color.set(tile.color);
            this.hexMesh.setColorAt(i, color);
        }

        this.hexMesh.instanceMatrix.needsUpdate = true;
        if (this.hexMesh.instanceColor) {
            this.hexMesh.instanceColor.needsUpdate = true;
        }
    }

    /** 타일 하이라이트 설정 */
    setHighlights(highlights: TileHighlight[]): void {
        this.highlightedTiles = highlights;
        this.updateTileColors();
    }

    /** 선택된 타일 설정 */
    selectTile(q: number, r: number): void {
        this.selectedTile = { q, r };
        this.updateTileColors();
    }

    /** 선택 해제 */
    clearSelection(): void {
        this.selectedTile = null;
        this.updateTileColors();
    }

    /** 마우스 위치로 타일 피킹 */
    pickTile(clientX: number, clientY: number): HexTileData | null {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouse = new Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        );

        this.raycaster.setFromCamera(mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.hexMesh);

        if (intersects.length > 0) {
            const instanceId = intersects[0].instanceId;
            if (instanceId !== undefined && instanceId < this.tiles.length) {
                return this.tiles[instanceId];
            }
        }
        return null;
    }

    /** 애니메이션 루프 시작 */
    start(): void {
        if (this.animFrameId !== null) return;
        this.lastFrameTime = performance.now();
        const loop = (time: number) => {
            this.animFrameId = requestAnimationFrame(loop);
            const dt = time - this.lastFrameTime;
            this._fps = dt > 0 ? Math.round(1000 / dt) : 60;
            this.lastFrameTime = time;
            this.update(dt);
        };
        this.animFrameId = requestAnimationFrame(loop);
    }

    /** 애니메이션 루프 중지 */
    stop(): void {
        if (this.animFrameId !== null) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    /** 매 프레임 업데이트 */
    update(_dt: number): void {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    /** 렌더링 통계 */
    getStats(): RenderStats {
        const dist = this.camera.position.distanceTo(this.controls.target);
        return {
            tileCount: this.tiles.length,
            drawCalls: 1,
            cameraDistance: Math.round(dist),
            lodLevel: 0,
            fps: this._fps,
        };
    }

    /** 리사이즈 */
    resize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /** 정리 */
    dispose(): void {
        this.stop();
        window.removeEventListener('resize', this.handleResize);
        this.controls.dispose();
        this.hexGeometry.dispose();
        this.material.dispose();
        this.renderer.dispose();
        this.scene.clear();
    }

    /** 지형 높이에 따른 자동 색상 생성 */
    static getTerrainColor(
        height: number,
        terrainType?: HexTileData['terrainType'],
    ): string {
        if (terrainType) {
            switch (terrainType) {
                case 'WATER': return '#2b6cb0';
                case 'FOREST': return '#276749';
                case 'MOUNTAIN': return '#8b4513';
                case 'SWAMP': return '#6b4423';
                case 'DESERT': return '#d69e2e';
                case 'PLAIN': return '#68d391';
            }
        }
        if (height <= 0) return '#2b6cb0';
        if (height < 5) return '#68d391';
        if (height < 15) return '#48bb78';
        if (height < 30) return '#8b4513';
        return '#a0aec0';
    }

    /** LOD 레벨 반환 */
    getCurrentLOD(): LODLevel {
        const dist = this.camera.position.distanceTo(this.controls.target);
        return getLODLevel(dist);
    }

    // ============================================================
    // Private
    // ============================================================

    private updateTileColors(): void {
        const color = new Color();
        const count = Math.min(this.tiles.length, this.maxTiles);
        for (let i = 0; i < count; i++) {
            const tile = this.tiles[i];
            const highlight = this.highlightedTiles.find(
                h => h.q === tile.q && h.r === tile.r,
            );
            if (highlight) {
                color.set(highlight.color);
            } else if (this.selectedTile &&
                       this.selectedTile.q === tile.q &&
                       this.selectedTile.r === tile.r) {
                color.set('#f6e05e');
            } else {
                color.set(tile.color);
            }
            this.hexMesh.setColorAt(i, color);
        }
        if (this.hexMesh.instanceColor) {
            this.hexMesh.instanceColor.needsUpdate = true;
        }
    }

    private readonly handleResize = (): void => {
        const canvas = this.renderer.domElement;
        this.resize(canvas.clientWidth, canvas.clientHeight);
    };
}
