import type { AppState, Location, WarehouseLayout } from '../../shared/types';
import { qtyAt, scopedLots } from '../../shared/lib/inventory';
import { locationsForRack } from '../../shared/lib/warehouseLayout';
import { rackPositions } from '../../shared/lib/rackPositioning';
import { WarehouseMapFront } from './WarehouseMapFront';
import { WarehouseMapIso } from './WarehouseMapIso';

export type MapMode = '3d' | 'plan' | 'front';

type Props = {
  state: AppState;
  racks: { id: string; x: number; y: number; name: string; category?: string }[];
  layout: WarehouseLayout;
  locations: Location[];
  mode: MapMode;
  selectedLoc: string;
  level: string;
  warehouseSearch: string;
  pickLocs: Set<string>;
  zoom: number;
  yaw: number;
  onSelect: (loc: string) => void;
  onSelectRack: (rack: string) => void;
};

export function WarehouseMap({
  state,
  racks,
  layout,
  locations,
  mode,
  selectedLoc,
  level,
  warehouseSearch,
  pickLocs,
  zoom,
  yaw,
  onSelect,
  onSelectRack,
}: Props) {
  const query = warehouseSearch.trim().toLowerCase();
  const matching = query
    ? state.products
        .filter((p) => (p.name + p.id).toLowerCase().includes(query))
        .map((p) => p.id)
    : [];
  const matchingStock = new Set(scopedLots(state)
    .filter((lot) => lot.qty > 0 && matching.includes(lot.productId))
    .map((lot) => lot.loc));
  const matchesLoc = (id: string) => Boolean(query) &&
    (id.toLowerCase().includes(query) || matchingStock.has(id));

  const cellColor = (id: string) => {
    const q = qtyAt(state, id);
    if (id === selectedLoc) return '#1795f5';
    if (query && !matchesLoc(id)) return q ? '#e6edf3' : '#f4f7fa';
    if (pickLocs.has(id) || matchesLoc(id)) return '#64c6b5';
    return q ? (q > 44 ? '#89b9dc' : '#bed8eb') : '#f6f9fc';
  };

  if (mode === '3d') {
    return (
      <WarehouseMapIso
        state={state}
        racks={racks}
        layout={layout}
        locations={locations}
        selectedLoc={selectedLoc}
        level={level}
        warehouseSearch={warehouseSearch}
        pickLocs={pickLocs}
        zoom={zoom}
        yaw={yaw}
        onSelect={onSelect}
        onSelectRack={onSelectRack}
      />
    );
  }

  if (mode === 'front') {
    const rackId = locations.find((l) => l.id === selectedLoc)?.rack ?? selectedLoc.split('-')[0];
    const r = racks.find((x) => x.id === rackId) ?? racks[0];
    return (
      <WarehouseMapFront
        state={state}
        rack={r}
        layout={layout}
        locations={locations}
        selectedLoc={selectedLoc}
        filterLevel={level}
        cellColor={cellColor}
        onSelect={onSelect}
      />
    );
  }

  const positions = rackPositions(layout);
  const columns = Math.max(1, ...positions.map((position) => position.column + 1));
  const rows = Math.max(1, ...positions.map((position) => position.row + 1));
  const cellWidth = 42;
  const cellHeight = layout.depthFaces === 2 ? 10 : 18;
  const levelHeight = layout.depthFaces === 2 ? 24 : 22;
  const rackWidth = layout.positionsPerLevel * 46 - 4;
  const rackHeight = layout.levels * levelHeight;
  const rowStride = rackHeight + 38;
  const aisleWidth = 80;
  const floorWidth = Math.max(600, columns * rackWidth + (columns - 1) * aisleWidth + 80);
  const floorHeight = rows * rowStride + 95;
  const viewWidth = floorWidth + 80;
  const viewHeight = floorHeight + 80;
  const startX = (viewWidth - columns * rackWidth - (columns - 1) * aisleWidth) / 2;
  const aisleX = startX + rackWidth + aisleWidth / 2;
  const receptionY = 80 + rows * rowStride;

  return (
    <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="group" aria-label="Plano de bodega">
      <defs>
        <pattern id="planGrid" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M25 0H0V25" fill="none" stroke="#eaf0f6" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect x={40} y={40} width={floorWidth} height={floorHeight} rx={8} fill="url(#planGrid)" stroke="#d5e1eb" strokeWidth={2} />
      {columns > 1 ? (
        <>
          <path d={`M${aisleX} 52V${receptionY}`} stroke="#e2edf5" strokeWidth={54} />
          <text x={aisleX + 4} y={(receptionY + 52) / 2} textAnchor="middle" transform={`rotate(90 ${aisleX + 4} ${(receptionY + 52) / 2})`} fill="#7795ad" fontSize={9} letterSpacing={2}>
            PASILLO PRINCIPAL
          </text>
        </>
      ) : null}
      {racks.map((r, i) => {
        const position = positions.find((entry) => entry.rackId === r.id) ?? positions[i];
        const x = startX + position.column * (rackWidth + aisleWidth);
        const y = 80 + position.row * rowStride;
        const rackLocs = locationsForRack(r.id, locations);
        return (
          <g key={r.id}>
            <text x={x} y={y - 10} fill="#6c90ab" fontSize="10" fontWeight="600">
              RACK {r.id}
            </text>
            {rackLocs.map((cell) => {
              const id = cell.id;
              const rowFromTop = layout.levels - cell.level;
              const faceRow = cell.face === 'T' ? 1 : 0;
              return (
                <rect
                  key={id}
                  x={x + (cell.pos - 1) * 46}
                  y={y + rowFromTop * levelHeight + faceRow * (cellHeight + 2)}
                  width={cellWidth}
                  height={cellHeight}
                  rx={2}
                  opacity={level === 'all' || String(level) === String(cell.level) ? 1 : 0.25}
                  fill={cellColor(id)}
                  stroke={cell.face === 'T' ? '#9eb8cc' : '#bad0e2'}
                  className="map-cell"
                  role="button"
                  tabIndex={0}
                  aria-label={`Ubicación ${id}, ${qtyAt(state, id)} unidades`}
                  aria-pressed={id === selectedLoc}
                  onClick={() => onSelect(id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(id);
                    }
                  }}
                >
                  <title>{`${id} · ${qtyAt(state, id)} u.`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
      <rect x={viewWidth / 2 - 95} y={receptionY} width={190} height={48} rx={5} fill="#e8f2fd" stroke="#cddff2" />
      <text x={viewWidth / 2} y={receptionY + 21} textAnchor="middle" fontSize={10} fill="#7298b8">
        RECEPCIÓN / DESPACHO
      </text>
      <text x={viewWidth / 2} y={receptionY + 36} textAnchor="middle" fontSize={8} fill="#9ab2c5">
        Acceso a la bodega
      </text>
    </svg>
  );
}
