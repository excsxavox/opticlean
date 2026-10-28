/** Proyección isométrica con rotación horizontal (yaw) para ver la parte trasera de los racks. */
const ISO_CENTER = { x: 5.2, y: 4.25 };

function rotateFloor(x: number, y: number, yaw: number): [number, number] {
  if (!yaw) return [x, y];
  const dx = x - ISO_CENTER.x;
  const dy = y - ISO_CENTER.y;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [ISO_CENTER.x + dx * cos - dy * sin, ISO_CENTER.y + dx * sin + dy * cos];
}

export function isoProject(x: number, y: number, z = 0, yaw = 0): [number, number] {
  const [rx, ry] = rotateFloor(x, y, yaw);
  return [410 + (rx - ry) * 37, 108 + (rx + ry) * 19 - z * 42];
}

export function polygonPoints(corners: Array<[number, number, number?]>, yaw = 0): string {
  return corners
    .map(([x, y, z]) => {
      const [px, py] = isoProject(x, y, z ?? 0, yaw);
      return `${Math.round(px * 10) / 10},${Math.round(py * 10) / 10}`;
    })
    .join(' ');
}

export type IsoRack = { id: string; name: string; x: number; y: number };

export const YAW_MIN = (-55 * Math.PI) / 180;
export const YAW_MAX = (55 * Math.PI) / 180;
