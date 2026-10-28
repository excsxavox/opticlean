import type { AppState } from '../../shared/types';
import { qtyAt } from '../../shared/lib/inventory';
import { WarehouseMapIso } from './WarehouseMapIso';

export type MapMode = '3d' | 'plan' | 'front';

type Props = {
  state: AppState;
  racks: { id: string; x: number; y: number; name: string }[];
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
  const matching = warehouseSearch
    ? state.products
        .filter((p) => (p.name + p.id).toLowerCase().includes(warehouseSearch.toLowerCase()))
        .map((p) => p.id)
    : [];
  const matchesLoc = (id: string) => state.lots.some((l) => l.loc === id && matching.includes(l.productId));

  const cellColor = (id: string) => {
    const q = qtyAt(state, id);
    if (id === selectedLoc) return '#1795f5';
    if (warehouseSearch && !matchesLoc(id)) return q ? '#e6edf3' : '#f4f7fa';
    if (pickLocs.has(id) || matchesLoc(id)) return '#64c6b5';
    return q ? (q > 44 ? '#89b9dc' : '#bed8eb') : '#f6f9fc';
  };

  if (mode === '3d') {
    return (
      <WarehouseMapIso
        state={state}
        racks={racks}
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
    const r = racks.find((x) => x.id === selectedLoc[0]) ?? racks[0];
    return (
      <svg viewBox="0 0 820 450" role="group" aria-label={`Rack ${r.id}`}>
        <text x="410" y="61" textAnchor="middle" fontSize="17" fontWeight="600" fill="#3f698a">
          Rack {r.id} · {r.name}
        </text>
        <text x="410" y="82" textAnchor="middle" fontSize="10" fill="#92aabc">
          Selecciona una posición para ver su contenido
        </text>
        {[1, 2, 3].map((l) => {
          const y = 115 + (3 - l) * 80;
          return (
            <g key={l}>
              <text x="125" y={y + 36} textAnchor="end" fill="#87a3b9" fontSize="10">
                NIVEL {l}
              </text>
              <rect x="151" y={y + 67} width="522" height="8" rx="2" fill="#87a9c2" />
              {[1, 2, 3, 4].map((pos) => {
                const id = `${r.id}-0${l}-0${pos}`;
                const q = qtyAt(state, id);
                const lit = level === 'all' || Number(level) === l;
                return (
                  <g
                    key={id}
                    opacity={lit ? 1 : 0.25}
                    onClick={() => onSelect(id)}
                    style={{ cursor: 'pointer' }}
                    className="map-cell"
                    role="button"
                    tabIndex={0}
                  >
                    <rect
                      x={163 + (pos - 1) * 125}
                      y={y}
                      width={112}
                      height={63}
                      rx={5}
                      fill={cellColor(id)}
                      stroke={selectedLoc === id ? '#0574c4' : '#bdd2e2'}
                    />
                    <text
                      x={219 + (pos - 1) * 125}
                      y={y + 26}
                      textAnchor="middle"
                      fontSize="11"
                      fill={id === selectedLoc ? 'white' : '#4d7798'}
                    >
                      {id}
                    </text>
                    <text
                      x={219 + (pos - 1) * 125}
                      y={y + 45}
                      textAnchor="middle"
                      fontSize="9"
                      fill={id === selectedLoc ? '#d5edff' : '#7597b0'}
                    >
                      {q ? `${q} u.` : 'Disponible'}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
        <path d="M153 110v249m515-249v249" stroke="#5f8da8" strokeWidth="7" />
        <path d="M125 367h572" stroke="#dbe6ef" strokeWidth="3" />
        <text x="410" y="397" textAnchor="middle" fontSize="10" fill="#a0b4c6">
          4 posiciones × 3 niveles · Capacidad: 720 unidades
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 820 450" role="group" aria-label="Plano de bodega">
      <defs>
        <pattern id="planGrid" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M25 0H0V25" fill="none" stroke="#eaf0f6" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect x="80" y="40" width="660" height="340" rx="5" fill="url(#planGrid)" stroke="#d5e1eb" strokeWidth="2" />
      <path d="M410 48v315" stroke="#e2edf5" strokeWidth="55" />
      <text x="417" y="199" transform="rotate(90 417 199)" fill="#92adbf" fontSize="9" letterSpacing="3">
        PASILLO PRINCIPAL
      </text>
      {racks.map((r, i) => {
        const x = r.x === 1 ? 130 : 490;
        const y = 67 + (i % 3) * 91;
        return (
          <g key={r.id}>
            <text x={x} y={y - 10} fill="#6c90ab" fontSize="10" fontWeight="600">
              RACK {r.id}
            </text>
            {[1, 2, 3].map((l) =>
              [1, 2, 3, 4].map((pos) => {
                const id = `${r.id}-0${l}-0${pos}`;
                return (
                  <rect
                    key={id}
                    x={x + (pos - 1) * 46}
                    y={y + (3 - l) * 18}
                    width={42}
                    height={15}
                    rx={2}
                    opacity={level === 'all' || String(level) === String(l) ? 1 : 0.25}
                    fill={cellColor(id)}
                    stroke="#bad0e2"
                    className="map-cell"
                    role="button"
                    tabIndex={0}
                    aria-label={`Ubicación ${id}`}
                    onClick={() => onSelect(id)}
                  />
                );
              }),
            )}
          </g>
        );
      })}
      <rect x="315" y="340" width="190" height="48" rx="5" fill="#e8f2fd" stroke="#cddff2" />
      <text x="410" y="361" textAnchor="middle" fontSize="10" fill="#7298b8">
        RECEPCIÓN / DESPACHO
      </text>
      <text x="410" y="376" textAnchor="middle" fontSize="8" fill="#9ab2c5">
        Acceso a la bodega
      </text>
    </svg>
  );
}
