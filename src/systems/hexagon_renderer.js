/**
 * 삼국지리턴 웹 프로젝트 - Phase 3 WebGL/Canvas 헥사곤 렌더러
 * 60fps 프레임 동기화 및 전장의 안개(Fog of War) 마스킹 기능 포함
 */

function drawHexagon(ctx, centerX, centerY, radius, terrainType, hasFog, filterColor = null) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle_rad = (Math.PI / 180) * (60 * i);
        const x = centerX + radius * Math.cos(angle_rad);
        const y = centerY + radius * Math.sin(angle_rad);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();

    if (hasFog) {
        ctx.fillStyle = "rgba(40, 40, 40, 0.9)";
    } else {
        ctx.fillStyle = filterColor || (terrainType === "MOUNTAIN" ? "#4a4a4a" : (terrainType === "RIVER" ? "#8fb1bc" : "#d1d1c4"));
    }
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
    ctx.stroke();
}

export function renderMap(ctx, gridState, renderSettings, filter = "NONE") {
    const radius = renderSettings.hexRadius;
    
    gridState.cities.forEach((hex, index) => {
        const centerX = radius * (Math.sqrt(3) * hex.q + Math.sqrt(3)/2 * hex.r);
        const centerY = radius * (3/2 * hex.r);
        const terrain = gridState.terrain[index] || "PLAINS";
        const hasFog = gridState.fogOfWarMatrix?.[hex.q]?.[hex.r] ?? true;

        let filterColor = null;
        if (filter === "OWNERSHIP") {
            filterColor = hex.owner === "PLAYER" ? "#8b0000" : "#4a4a4a";
        }

        drawHexagon(ctx, centerX, centerY, radius, terrain, hasFog, filterColor);
    });
}
