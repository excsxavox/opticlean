import type { AppState, Location, WarehouseLayout } from '../../shared/types';
import { qtyAt } from '../../shared/lib/inventory';
import { locationsForRack } from '../../shared/lib/warehouseLayout';

type RackInfo = { id: string; name: string; category?: string };

type Props = {
  state: AppState;
  rack: RackInfo;
  layout: WarehouseLayout;
  locations: Location[];
  selectedLoc: string;
  filterLevel: string;
  cellColor: (id: string) => string;
  onSelect: (loc: string) => void;
};

export function WarehouseMapFront({
  state,
  rack,
  layout,
  locations,
  selectedLoc,
  filterLevel,
  cellColor,
  onSelect,
}: Props) {
  const rackLocs = locationsForRack(rack.id, locations);
  const levels = [...new Set(rackLocs.map((l) => l.level))].sort((a, b) => b - a);
  const posCount = layout.positionsPerLevel;
  const dual = layout.depthFaces === 2;
  const category = rack.category ?? rackLocs[0]?.category ?? 'Almacenamiento';

  const gridX = 168;
  const gridW = 484;
  const colW = gridW / posCount;
  const faceH = dual ? 34 : 68;
  const levelBlockH = dual ? 88 : 78;
  const levelGap = 14;
  const totalGridH = levels.length * levelBlockH + (levels.length - 1) * levelGap;
  const canvasHeight = Math.max(450, 160 + totalGridH);

  const findCell = (level: number, pos: number, face?: 'D' | 'T') =>
    rackLocs.find((c) => c.level === level && c.pos === pos && c.face === face);

  const rackCapacity =
    posCount * layout.levels * (dual ? 2 : 1) * layout.capacityPerCell;

  return (
    <svg viewBox={`0 0 820 ${canvasHeight}`} role="group" aria-label={`Vista frontal rack ${rack.id}`}>
      <rect x="0" y="0" width="820" height={canvasHeight} fill="#f8fbfe" />
      <text x="410" y="52" textAnchor="middle" fontSize="18" fontWeight="600" fill="#2f5678">
        Rack {rack.id}
      </text>
      <text x="410" y="72" textAnchor="middle" fontSize="11" fill="#7d97ae">
        {category}
        {dual ? ' · Doble profundidad (Del arriba · Tras abajo)' : ''}
      </text>

      <rect
        x={gridX - 12}
        y={88}
        width={gridW + 24}
        height={totalGridH + 36}
        rx="10"
        fill="#fff"
        stroke="#d4e2ee"
        strokeWidth="1.5"
      />
      <path d={`M${gridX - 4} 118h${gridW + 8}`} stroke="#5f8da8" strokeWidth="6" strokeLinecap="round" />
      <path d={`M${gridX - 4} ${88 + totalGridH + 28}h${gridW + 8}`} stroke="#5f8da8" strokeWidth="6" strokeLinecap="round" />

      {Array.from({ length: posCount }, (_, i) => (
        <text
          key={`col-${i}`}
          x={gridX + colW * i + colW / 2}
          y={104}
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          fill="#8aa3b8"
          letterSpacing="0.5"
        >
          POS {i + 1}
        </text>
      ))}

      {levels.map((lvl, li) => {
        const blockY = 118 + li * (levelBlockH + levelGap);
        const lit = filterLevel === 'all' || Number(filterLevel) === lvl;
        return (
          <g key={lvl} opacity={lit ? 1 : 0.22}>
            <text x={gridX - 28} y={blockY + (dual ? faceH + 1 : faceH / 2) + 4} textAnchor="end" fill="#6d8da8" fontSize="10" fontWeight="600">
              N{lvl}
            </text>
            <rect x={gridX} y={blockY + (dual ? faceH * 2 : faceH) - 2} width={gridW} height="5" rx="2" fill="#8eb0c8" />
            {Array.from({ length: posCount }, (_, pi) => {
              const pos = pi + 1;
              const faces = dual ? (['D', 'T'] as const) : ([undefined] as const);
              return (
                <g key={`${lvl}-${pos}`}>
                  {faces.map((face, fi) => {
                    const cell = findCell(lvl, pos, face);
                    const id = cell?.id ?? `${rack.id}-${String(lvl).padStart(2, '0')}-${String(pos).padStart(2, '0')}${face ? `-${face}` : ''}`;
                    const q = qtyAt(state, id);
                    const selected = id === selectedLoc;
                    const bx = gridX + pi * colW + 4;
                    const by = blockY + fi * (faceH + 2);
                    const bw = colW - 8;
                    const bh = faceH - 2;
                    return (
                      <g
                        key={id}
                        className="map-cell"
                        role="button"
                        tabIndex={0}
                        aria-label={`Ubicación ${id}, ${q} unidades${face === 'D' ? ', delantera' : face === 'T' ? ', trasera' : ''}`}
                        aria-pressed={selected}
                        style={{ cursor: 'pointer' }}
                        onClick={() => onSelect(id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onSelect(id);
                          }
                        }}
                      >
                        <title>{`${id} · ${q ? `${q} u.` : 'Disponible'}`}</title>
                        <rect
                          x={bx}
                          y={by}
                          width={bw}
                          height={bh}
                          rx="6"
                          fill={cellColor(id)}
                          stroke={selected ? '#0468c4' : face === 'T' ? '#c5d8e8' : '#b8cfe0'}
                          strokeWidth={selected ? 2.5 : 1.2}
                        />
                        {dual ? (
                          <text x={bx + 8} y={by + 11} fontSize="7.5" fontWeight="700" fill={selected ? '#e8f4ff' : '#8aa8be'}>
                            {face}
                          </text>
                        ) : null}
                        <text
                          x={bx + bw / 2}
                          y={by + (dual ? 22 : 28)}
                          textAnchor="middle"
                          fontSize={dual ? 9 : 10}
                          fontWeight="600"
                          fill={selected ? '#fff' : '#3f698a'}
                        >
                          {dual ? `${rack.id}-${String(lvl).padStart(2, '0')}-${String(pos).padStart(2, '0')}` : id}
                        </text>
                        <text
                          x={bx + bw / 2}
                          y={by + (dual ? 31 : 44)}
                          textAnchor="middle"
                          fontSize="9"
                          fill={selected ? '#dbefff' : q ? '#5a819c' : '#9eb2c4'}
                        >
                          {q ? `${q} u.` : 'Libre'}
                        </text>
                      </g>
                    );
                  })}
                  {dual ? (
                    <line
                      x1={gridX + pi * colW + 4}
                      y1={blockY + faceH}
                      x2={gridX + (pi + 1) * colW - 4}
                      y2={blockY + faceH}
                      stroke="#dce9f3"
                      strokeWidth="1"
                      strokeDasharray="3 2"
                    />
                  ) : null}
                </g>
              );
            })}
          </g>
        );
      })}

      <text x="410" y={canvasHeight - 20} textAnchor="middle" fontSize="10" fill="#94aabd">
        {posCount} posiciones × {layout.levels} niveles
        {dual ? ' × 2 caras' : ''} · Capacidad del rack: {rackCapacity.toLocaleString('es-EC')} u.
      </text>
    </svg>
  );
}
