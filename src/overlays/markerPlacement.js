// CSS pixel layout only. Geographic positions are never modified.
const CELL = 40;
const OFFSETS = [
  [0, -24],
  [0, -44],
  [0, -64],
];
const ANCHOR_GAP = 56;
export function placeTargetMarkers(
  markers,
  width,
  height,
  { previous = new Map(), selectedId, obstacles = [] } = {},
) {
  const grid = new Map();
  const anchorGrid = new Map();
  const cells = (r, fn) => {
    for (
      let x = Math.floor(r.left / CELL);
      x <= Math.floor(r.right / CELL);
      x++
    )
      for (
        let y = Math.floor(r.top / CELL);
        y <= Math.floor(r.bottom / CELL);
        y++
      )
        fn(`${x}:${y}`);
  };
  for (const obstacle of obstacles) {
    const r = {
      left: obstacle.x - 3,
      top: obstacle.y - 3,
      right: obstacle.x + obstacle.w + 3,
      bottom: obstacle.y + obstacle.h + 3,
    };
    if (![r.left, r.top, r.right, r.bottom].every(Number.isFinite)) continue;
    cells(r, (key) => {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(r);
    });
  }
  return [...markers]
    .sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId))
    .map((marker) => {
      const { id, x, y, size } = marker;
      const hidden = { id, size, x, y, dx: 0, dy: 0, visible: false };
      if (
        ![x, y, size, width, height].every(Number.isFinite) ||
        size <= 0 ||
        width < size ||
        height < size
      )
        return hidden;
      const ax = Math.floor(x / ANCHOR_GAP),
        ay = Math.floor(y / ANCHOR_GAP);
      for (let gx = ax - 1; gx <= ax + 1; gx++)
        for (let gy = ay - 1; gy <= ay + 1; gy++)
          for (const anchor of anchorGrid.get(`${gx}:${gy}`) || [])
            if (Math.hypot(anchor.x - x, anchor.y - y) < ANCHOR_GAP)
              return hidden;
      const prior = previous.get(id);
      const candidates = marker.fixed
        ? [[0, 0]]
        : prior
          ? OFFSETS.some(([dx, dy]) => prior.dx === dx && prior.dy === dy)
            ? [[prior.dx, prior.dy], ...OFFSETS]
            : OFFSETS
          : OFFSETS;
      for (const [dx, dy] of candidates) {
        const cx = x + dx,
          cy = y + dy;
        if (
          cx - size / 2 < 0 ||
          cx + size / 2 > width ||
          cy - size / 2 < 0 ||
          cy + size / 2 > height
        )
          continue;
        const half = size / 2 + 3;
        const rect = {
          left: cx - half,
          right: cx + half,
          top: cy - half,
          bottom: cy + half,
        };
        let collision = false;
        cells(rect, (key) => {
          for (const r of grid.get(key) || [])
            if (
              rect.left < r.right &&
              rect.right > r.left &&
              rect.top < r.bottom &&
              rect.bottom > r.top
            ) {
              collision = true;
              break;
            }
        });
        if (collision) continue;
        cells(rect, (key) => {
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(rect);
        });
        const anchorKey = `${ax}:${ay}`;
        if (!anchorGrid.has(anchorKey)) anchorGrid.set(anchorKey, []);
        anchorGrid.get(anchorKey).push({ x, y });
        return {
          id,
          size,
          x: cx,
          y: cy,
          dx: cx - x,
          dy: cy - y,
          visible: true,
        };
      }
      return hidden;
    });
}
