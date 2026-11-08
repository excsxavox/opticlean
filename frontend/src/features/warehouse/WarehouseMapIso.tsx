import type { ReactNode } from 'react';
import type { AppState, Location, WarehouseLayout } from '../../shared/types';
import { qtyAt, scopedLots } from '../../shared/lib/inventory';
import { locationsForRack } from '../../shared/lib/warehouseLayout';
import { rackPositions } from '../../shared/lib/rackPositioning';
import { isoProject, polygonPoints, type IsoRack } from './iso';

type Props = {
  state: AppState;
  racks: IsoRack[];
  layout: WarehouseLayout;
  locations: Location[];
  selectedLoc: string;
  level: string;
  warehouseSearch: string;
  pickLocs: Set<string>;
  zoom: number;
  yaw: number;
  onSelect: (loc: string) => void;
  onSelectRack: (rack: string) => void;
};

function Poly({
  corners,
  fill,
  stroke = '#b9cfdf',
  strokeWidth = 0.75,
  onClick,
  className,
  role,
  tabIndex,
  ariaLabel,
  yaw,
}: {
  corners: Array<[number, number, number?]>;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  onClick?: () => void;
  className?: string;
  role?: string;
  tabIndex?: number;
  ariaLabel?: string;
  yaw: number;
}) {
  return (
    <polygon
      points={polygonPoints(corners, yaw)}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      className={className}
      role={role}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
    />
  );
}

export function WarehouseMapIso({
  state,
  racks,
  layout,
  locations,
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

  // Keep each position readable and preserve the aisle as racks become wider.
  const rackWidth = Math.max(3, layout.positionsPerLevel * 0.72);
  const rackDepth = layout.depthFaces === 2 ? 1.05 : 0.9;
  const positions = rackPositions(layout);
  const columns = Math.max(1, ...positions.map((position) => position.column + 1));
  const positionedRacks = racks.map((rack, index) => {
    const position = positions.find((entry) => entry.rackId === rack.id) ?? positions[index];
    return { ...rack, x: 1 + position.column * (rackWidth + 2), y: 1 + position.row * 2.4 };
  });
  const floorWidth = columns * rackWidth + (columns - 1) * 2 + 2;
  const floorDepth = Math.max(4.8, ...positionedRacks.map((rack) => rack.y + rackDepth + 2));
  const aisleX = floorWidth / 2;
  const receptionY = floorDepth - 1.2;
  const dest = positionedRacks.find((rack) => rack.id === selectedLoc.split('-')[0]) ?? positionedRacks[0];
  const label = isoProject(aisleX, floorDepth + 0.15, 0, yaw);
  const arrowPt = isoProject(aisleX, receptionY + 0.35, 0, yaw);
  const rackHeight = 0.12 + layout.levels * Math.min(0.79, 2.35 / Math.max(layout.levels, 1));

  // Project the complete enclosure on each rotation so any valid layout stays in frame.
  const bounds = [0, rackHeight + 0.5].flatMap((z) =>
    [[0, 0], [floorWidth, 0], [floorWidth, floorDepth], [0, floorDepth]]
      .map(([x, y]) => isoProject(x, y, z, yaw)));
  bounds.push([label[0] - 85, label[1] + 15], [label[0] + 85, label[1] + 15]);
  const minX = Math.min(...bounds.map(([x]) => x)) - 35;
  const minY = Math.min(...bounds.map(([, y]) => y)) - 35;
  const viewWidth = Math.max(...bounds.map(([x]) => x)) - minX + 35;
  const viewHeight = Math.max(...bounds.map(([, y]) => y)) - minY + 35;
  const centerX = minX + viewWidth / 2;
  const centerY = minY + viewHeight / 2;
  const depthOrder = (rack: IsoRack) =>
    rack.x * (Math.cos(yaw) + Math.sin(yaw)) + rack.y * (Math.cos(yaw) - Math.sin(yaw));
  const sortedRacks = [...positionedRacks].sort((a, b) => depthOrder(a) - depthOrder(b));

  return (
    <svg viewBox={`${minX} ${minY} ${viewWidth} ${viewHeight}`} role="group" aria-label="Bodega 3D isométrica">
      <g transform={`translate(${centerX * (1 - zoom)} ${centerY * (1 - zoom)}) scale(${zoom})`}>
        <Poly yaw={yaw} corners={[[0, 0], [floorWidth, 0], [floorWidth, 0, 0.34], [0, 0, 0.34]]} fill="#e4edf4" stroke="#cfdeea" />
        <Poly yaw={yaw} corners={[[0, 0], [0, floorDepth], [0, floorDepth, 0.34], [0, 0, 0.34]]} fill="#e8f0f6" stroke="#cfdeea" />
        <Poly yaw={yaw} corners={[[0, 0], [floorWidth, 0], [floorWidth, floorDepth], [0, floorDepth]]} fill="#f0f5f9" stroke="#d3e1eb" />
        {Array.from({ length: Math.floor(floorWidth) + 1 }, (_, i) => {
          const a = isoProject(i, 0, 0, yaw);
          const b = isoProject(i, floorDepth, 0, yaw);
          return <path key={`gx-${i}`} d={`M${a.join(',')}L${b.join(',')}`} stroke="#e1eaf1" strokeWidth={0.55} />;
        })}
        {Array.from({ length: Math.floor(floorDepth) + 1 }, (_, i) => {
          const a = isoProject(0, i, 0, yaw);
          const b = isoProject(floorWidth, i, 0, yaw);
          return <path key={`gy-${i}`} d={`M${a.join(',')}L${b.join(',')}`} stroke="#e1eaf1" strokeWidth={0.55} />;
        })}
        {columns > 1 ? <path
          d={`M${isoProject(aisleX, 0.4, 0, yaw).join(',')}L${isoProject(aisleX, receptionY, 0, yaw).join(',')}`}
          stroke="#d9e7f0"
          strokeWidth={14}
          opacity={0.65}
        /> : null}
        {dest ? <path
          d={`M${isoProject(aisleX, receptionY + 0.35, 0, yaw).join(',')}L${isoProject(aisleX, dest.y + rackDepth + 0.25, 0, yaw).join(',')}L${isoProject(dest.x + rackWidth / 2, dest.y + rackDepth + 0.25, 0, yaw).join(',')}`}
          fill="none"
          stroke="#35acdd"
          strokeWidth={2.3}
          strokeDasharray="5 4"
          opacity={0.75}
        /> : null}
        <Poly yaw={yaw} corners={[[aisleX - 1.1, receptionY], [aisleX + 1.1, receptionY], [aisleX + 1.1, receptionY + 0.95], [aisleX - 1.1, receptionY + 0.95]]} fill="#dcedf9" stroke="#a4cce8" />
        {sortedRacks.map((r) => (
          <RackIso
            key={r.id}
            rack={r}
            rackWidth={rackWidth}
            layout={layout}
            rackLocations={locationsForRack(r.id, locations)}
            yaw={yaw}
            selectedLoc={selectedLoc}
            level={level}
            cellColor={cellColor}
            qtyAt={(id) => qtyAt(state, id)}
            onSelect={onSelect}
            onSelectRack={onSelectRack}
          />
        ))}
        <text x={label[0]} y={label[1] + 11} textAnchor="middle" fill="#83a2bb" fontSize={9} letterSpacing={1.2}>
          RECEPCIÓN / DESPACHO
        </text>
        <path
          d={`M${arrowPt[0] - 7},${arrowPt[1] + 2}h14m-5-4 5 4-5 4`}
          fill="none"
          stroke="#7eafd1"
          strokeWidth={1.5}
        />
      </g>
    </svg>
  );
}

function RackIso({
  rack: r,
  rackWidth,
  layout,
  rackLocations,
  yaw,
  selectedLoc,
  level,
  cellColor,
  qtyAt,
  onSelect,
  onSelectRack,
}: {
  rack: IsoRack;
  rackWidth: number;
  layout: WarehouseLayout;
  rackLocations: Location[];
  yaw: number;
  selectedLoc: string;
  level: string;
  cellColor: (id: string) => string;
  qtyAt: (id: string) => number;
  onSelect: (loc: string) => void;
  onSelectRack: (rack: string) => void;
}) {
  const w = rackWidth;
  const d = layout.depthFaces === 2 ? 1.05 : 0.9;
  const x = r.x;
  const y = r.y;
  const levels = layout.levels;
  const positions = layout.positionsPerLevel;
  const shelfStep = Math.min(0.79, 2.35 / Math.max(levels, 1));
  const h = 0.12 + levels * shelfStep;
  const cellW = (w - 0.08) / positions;
  const dual = layout.depthFaces === 2;
  const aisleY = y + d;
  const cellDepth = d - 0.18;
  const fullCellH = Math.min(0.66, shelfStep * 0.82);
  const cellGap = dual ? 0.04 : 0;

  const shelves: ReactNode[] = [];
  const cellLayers: ReactNode[] = [];

  for (let l = 1; l <= levels; l++) {
    const zBase = (l - 1) * shelfStep + 0.12;
    shelves.push(
      <Poly
        key={`shelf-${r.id}-${l}`}
        yaw={yaw}
        corners={[
          [x, aisleY, zBase - 0.04],
          [x + w, aisleY, zBase - 0.04],
          [x + w, aisleY, zBase + 0.035],
          [x, aisleY, zBase + 0.035],
        ]}
        fill="#7a9db8"
        stroke="#7a9db8"
      />,
    );

    for (let pos = 1; pos <= positions; pos++) {
      const faces = dual ? (['T', 'D'] as const) : ([undefined] as const);
      faces.forEach((face, fi) => {
        const loc = rackLocations.find((c) => c.level === l && c.pos === pos && c.face === face);
        const id =
          loc?.id ??
          `${r.id}-${String(l).padStart(2, '0')}-${String(pos).padStart(2, '0')}${face ? `-${face}` : ''}`;
        const xx = x + (pos - 1) * cellW + 0.04;
        const sliceH = dual ? (fullCellH - cellGap) / 2 : fullCellH;
        const z = dual ? zBase + fi * (sliceH + cellGap) : zBase;
        const q = qtyAt(id);
        const lit = level === 'all' || Number(level) === l;
        const selected = id === selectedLoc;
        const depthY = y + 0.11 + (face === 'T' ? cellDepth * 0.35 : face === 'D' ? cellDepth * 0.72 : cellDepth * 0.55);

        cellLayers.push(
          <g key={id} opacity={lit ? 1 : 0.28}>
            {q ? (
              <>
                <Poly
                  yaw={yaw}
                  corners={[
                    [xx, aisleY, z + sliceH],
                    [xx + cellW - 0.06, aisleY, z + sliceH],
                    [xx + cellW - 0.06, depthY, z + sliceH],
                    [xx, depthY, z + sliceH],
                  ]}
                  fill={selected ? '#67c1ff' : '#d2e4f0'}
                  stroke="#b4cede"
                />
                <Poly
                  yaw={yaw}
                  corners={[
                    [xx + cellW - 0.06, aisleY, z],
                    [xx + cellW - 0.06, depthY, z],
                    [xx + cellW - 0.06, depthY, z + sliceH],
                    [xx + cellW - 0.06, aisleY, z + sliceH],
                  ]}
                  fill={selected ? '#1484dc' : '#a6c6dd'}
                  stroke="#9abed7"
                />
              </>
            ) : null}
            <Poly
              yaw={yaw}
              corners={[
                [xx, aisleY, z],
                [xx + cellW - 0.06, aisleY, z],
                [xx + cellW - 0.06, aisleY, z + sliceH],
                [xx, aisleY, z + sliceH],
              ]}
              fill={cellColor(id)}
              stroke={selected ? '#067add' : face === 'T' ? '#7a9eb8' : '#8eb4cc'}
              strokeWidth={selected ? 1.1 : 0.85}
              className="map-cell"
              role="button"
              tabIndex={0}
              ariaLabel={`Ubicación ${id}, ${q} unidades${face === 'D' ? ', delantera' : face === 'T' ? ', trasera' : ''}`}
              onClick={() => onSelect(id)}
            />
            {dual ? (
              <text
                x={isoProject(xx + (cellW - 0.06) * 0.42, aisleY, z + sliceH * 0.62, yaw)[0]}
                y={isoProject(xx + (cellW - 0.06) * 0.42, aisleY, z + sliceH * 0.62, yaw)[1]}
                textAnchor="middle"
                fontSize={5.5}
                fill={selected ? '#fff' : '#7a96ad'}
                pointerEvents="none"
              >
                {face}
              </text>
            ) : null}
            {q ? (
              <path
                d={`M${isoProject(xx + cellW * 0.22, aisleY + 0.008, z + sliceH * 0.52, yaw).join(',')}L${isoProject(xx + cellW * 0.58, aisleY + 0.008, z + sliceH * 0.52, yaw).join(',')}`}
                stroke={selected ? '#d6efff' : '#f4faff'}
                strokeWidth={2.5}
                pointerEvents="none"
              />
            ) : null}
          </g>,
        );
      });
    }
  }

  const label = isoProject(x + w / 2, y + d, h + 0.06, yaw);
  const rackSelected = selectedLoc[0] === r.id;

  return (
    <g>
      <Poly
        yaw={yaw}
        corners={[
          [x - 0.1, y - 0.07],
          [x + w + 0.22, y - 0.07],
          [x + w + 0.32, y + d + 0.25],
          [x - 0.06, y + d + 0.25],
        ]}
        fill="#d5e0e85c"
        stroke="none"
      />
      <Poly
        yaw={yaw}
        corners={[
          [x + w, y, 0],
          [x + w, y + d, 0],
          [x + w, y + d, h],
          [x + w, y, h],
        ]}
        fill="#d4e1eb"
        stroke="#93afc5"
      />
      <Poly
        yaw={yaw}
        corners={[
          [x, y, h],
          [x + w, y, h],
          [x + w, y + d, h],
          [x, y + d, h],
        ]}
        fill="#d9e8f3"
        stroke="#98b6cb"
      />
      {shelves}
      {dual ? (
        <Poly
          yaw={yaw}
          corners={[
            [x + 0.02, y + d * 0.52, 0.1],
            [x + w - 0.02, y + d * 0.52, 0.1],
            [x + w - 0.02, y + d * 0.52, h - 0.05],
            [x + 0.02, y + d * 0.52, h - 0.05],
          ]}
          fill="#b8cad988"
          stroke="#94adbf"
          strokeWidth={0.45}
        />
      ) : null}
      {cellLayers}
      {[0, w].map((a) => (
        <path
          key={`post-${a}`}
          d={`M${isoProject(x + a, y + d, 0, yaw).join(',')}L${isoProject(x + a, y + d, h + 0.035, yaw).join(',')}`}
          stroke="#7398b3"
          strokeWidth={3.8}
        />
      ))}
      <g
        role="button"
        tabIndex={0}
        aria-label={`Ver rack ${r.id}`}
        style={{ cursor: 'pointer' }}
        onClick={() => onSelectRack(r.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectRack(r.id);
          }
        }}
      >
        <rect
          x={label[0] - 20}
          y={label[1] - 18}
          width={40}
          height={18}
          rx={4}
          fill={rackSelected ? '#1688ea' : '#fff'}
          stroke={rackSelected ? '#1688ea' : '#cbddea'}
        />
        <text
          x={label[0]}
          y={label[1] - 5}
          textAnchor="middle"
          fontSize={8}
          fontWeight={600}
          fill={rackSelected ? 'white' : '#6a8ca8'}
        >
          RACK {r.id}
        </text>
      </g>
    </g>
  );
}
