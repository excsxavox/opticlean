import type { ReactNode } from 'react';
import type { AppState } from '../../shared/types';
import { qtyAt } from '../../shared/lib/inventory';
import { isoProject, polygonPoints, type IsoRack } from './iso';

type Props = {
  state: AppState;
  racks: IsoRack[];
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
  selectedLoc,
  level,
  warehouseSearch,
  pickLocs,
  zoom,
  yaw,
  onSelect,
  onSelectRack,
}: Props) {
  const matching = warehouseSearch
    ? state.products
        .filter((p) => (p.name + p.id).toLowerCase().includes(warehouseSearch.toLowerCase()))
        .map((p) => p.id)
    : [];
  const matchesLoc = (id: string) =>
    state.lots.some((l) => l.loc === id && matching.includes(l.productId));

  const cellColor = (id: string, side = false) => {
    const q = qtyAt(state, id);
    if (id === selectedLoc) return side ? '#0670d3' : '#1795f5';
    if (warehouseSearch && !matchesLoc(id)) return q ? '#e6edf3' : '#f4f7fa';
    if (pickLocs.has(id) || matchesLoc(id)) return '#64c6b5';
    return q ? (q > 44 ? '#89b9dc' : '#bed8eb') : '#f6f9fc';
  };

  const dest = racks.find((r) => r.id === selectedLoc[0]) ?? racks[0];
  const label = isoProject(5.6, 8.8, 0, yaw);
  const arrowPt = isoProject(5.25, 7.8, 0, yaw);

  const sortedRacks = [...racks].sort((a, b) => a.x + a.y - (b.x + b.y));

  return (
    <svg viewBox="0 0 820 450" role="group" aria-label="Bodega 3D isométrica">
      <g transform={`translate(${410 * (1 - zoom)} ${230 * (1 - zoom)}) scale(${zoom})`}>
        <Poly yaw={yaw} corners={[[0, 0], [10.4, 0], [10.4, 0, 0.34], [0, 0, 0.34]]} fill="#e4edf4" stroke="#cfdeea" />
        <Poly yaw={yaw} corners={[[0, 0], [0, 8.5], [0, 8.5, 0.34], [0, 0, 0.34]]} fill="#e8f0f6" stroke="#cfdeea" />
        <Poly yaw={yaw} corners={[[0, 0], [10.4, 0], [10.4, 8.5], [0, 8.5]]} fill="#f0f5f9" stroke="#d3e1eb" />
        {Array.from({ length: 11 }, (_, i) => {
          const a = isoProject(i, 0, 0, yaw);
          const b = isoProject(i, 8.5, 0, yaw);
          return <path key={`gx-${i}`} d={`M${a.join(',')}L${b.join(',')}`} stroke="#e1eaf1" strokeWidth={0.55} />;
        })}
        {Array.from({ length: 9 }, (_, i) => {
          const a = isoProject(0, i, 0, yaw);
          const b = isoProject(10.4, i, 0, yaw);
          return <path key={`gy-${i}`} d={`M${a.join(',')}L${b.join(',')}`} stroke="#e1eaf1" strokeWidth={0.55} />;
        })}
        <path
          d={`M${isoProject(4.6, 0.4, 0, yaw).join(',')}L${isoProject(4.6, 7.6, 0, yaw).join(',')}`}
          stroke="#d9e7f0"
          strokeWidth={14}
          opacity={0.65}
        />
        <path
          d={`M${isoProject(4.7, 8, 0, yaw).join(',')}L${isoProject(4.7, dest.y + 0.45, 0, yaw).join(',')}L${isoProject(dest.x + 1.5, dest.y + 0.45, 0, yaw).join(',')}`}
          fill="none"
          stroke="#35acdd"
          strokeWidth={2.3}
          strokeDasharray="5 4"
          opacity={0.75}
        />
        <Poly yaw={yaw} corners={[[4.05, 7.4], [6.3, 7.4], [6.3, 8.35], [4.05, 8.35]]} fill="#dcedf9" stroke="#a4cce8" />
        {sortedRacks.map((r) => (
          <RackIso
            key={r.id}
            rack={r}
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
        <text x={154} y={373} fill="#b2c2cf" fontSize={8} transform="rotate(27 154 373)">
          BODEGA PRINCIPAL
        </text>
      </g>
    </svg>
  );
}

function RackIso({
  rack: r,
  yaw,
  selectedLoc,
  level,
  cellColor,
  qtyAt,
  onSelect,
  onSelectRack,
}: {
  rack: IsoRack;
  yaw: number;
  selectedLoc: string;
  level: string;
  cellColor: (id: string, side?: boolean) => string;
  qtyAt: (id: string) => number;
  onSelect: (loc: string) => void;
  onSelectRack: (rack: string) => void;
}) {
  const w = 3;
  const d = 0.9;
  const h = 2.5;
  const x = r.x;
  const y = r.y;

  const shelves: ReactNode[] = [];
  for (let l = 1; l <= 3; l++) {
    const z = (l - 1) * 0.79 + 0.12;
    shelves.push(
      <Poly
        key={`shelf-${r.id}-${l}`}
        yaw={yaw}
        corners={[
          [x, y + d, z - 0.04],
          [x + w, y + d, z - 0.04],
          [x + w, y + d, z + 0.035],
          [x, y + d, z + 0.035],
        ]}
        fill="#7a9db8"
        stroke="#7a9db8"
      />,
    );
    for (let pos = 1; pos <= 4; pos++) {
      const xx = x + (pos - 1) * 0.75 + 0.055;
      const id = `${r.id}-0${l}-0${pos}`;
      const q = qtyAt(id);
      const lit = level === 'all' || Number(level) === l;
      const selected = id === selectedLoc;
      shelves.push(
        <g key={id} opacity={lit ? 1 : 0.23}>
          {q ? (
            <>
              <Poly
                yaw={yaw}
                corners={[
                  [xx, y + 0.13, z + 0.66],
                  [xx + 0.63, y + 0.13, z + 0.66],
                  [xx + 0.63, y + d - 0.04, z + 0.66],
                  [xx, y + d - 0.04, z + 0.66],
                ]}
                fill={selected ? '#67c1ff' : '#d2e4f0'}
                stroke="#b4cede"
              />
              <Poly
                yaw={yaw}
                corners={[
                  [xx + 0.63, y + 0.13, z],
                  [xx + 0.63, y + d - 0.04, z],
                  [xx + 0.63, y + d - 0.04, z + 0.66],
                  [xx + 0.63, y + 0.13, z + 0.66],
                ]}
                fill={selected ? '#1484dc' : '#a6c6dd'}
                stroke="#9abed7"
              />
            </>
          ) : null}
          <Poly
            yaw={yaw}
            corners={[
              [xx, y + d, z],
              [xx + 0.63, y + d, z],
              [xx + 0.63, y + d, z + 0.66],
              [xx, y + d, z + 0.66],
            ]}
            fill={cellColor(id)}
            stroke={selected ? '#067add' : '#a6c4da'}
            className="map-cell"
            role="button"
            tabIndex={0}
            ariaLabel={`Ubicación ${id}, ${q} unidades`}
            onClick={() => onSelect(id)}
          />
          {q ? (
            <path
              d={`M${isoProject(xx + 0.18, y + d + 0.007, z + 0.35, yaw).join(',')}L${isoProject(xx + 0.47, y + d + 0.007, z + 0.35, yaw).join(',')}`}
              stroke={selected ? '#d6efff' : '#f4faff'}
              strokeWidth={3}
              pointerEvents="none"
            />
          ) : null}
        </g>,
      );
    }
  }

  const label = isoProject(x + 1.5, y + d, h + 0.06, yaw);
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
      {[0, 3].map((a) => (
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
