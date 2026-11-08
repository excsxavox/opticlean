import { useState, type DragEvent } from 'react';
import type { WarehouseLayout } from '../../shared/types';
import { FLOOR_COLUMNS, FLOOR_ROWS, moveRack, rackPositions } from '../../shared/lib/rackPositioning';
import { Icon } from '../../shared/components/Icon';
import '../../styles/warehouse-positioning.css';

export type RackStats = Record<string, { occupied: number; total: number; units: number }>;

type Props = {
  layout: WarehouseLayout;
  selectedRack: string;
  onSelectRack: (id: string) => void;
  onChange?: (layout: WarehouseLayout) => void;
  stats?: RackStats;
  matchingRacks?: Set<string>;
};

export function WarehouseFloorPlan({ layout, selectedRack, onSelectRack, onChange, stats, matchingRacks }: Props) {
  const positions = rackPositions(layout);
  const selected = positions.find((position) => position.rackId === selectedRack) ?? positions[0];
  const [moving, setMoving] = useState(false);
  const [dragging, setDragging] = useState('');
  const [over, setOver] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const editable = Boolean(onChange);
  const rows = editable ? FLOOR_ROWS : Math.max(3, ...positions.map((position) => position.row + 1));
  const columns = editable ? FLOOR_COLUMNS : Math.max(2, ...positions.map((position) => position.column + 1));

  const place = (rackId: string, column: number, row: number) => {
    if (!onChange || !positions.some((position) => position.rackId === rackId)) return;
    const other = positions.find((position) => position.column === column && position.row === row && position.rackId !== rackId);
    onChange(moveRack(layout, rackId, column, row));
    onSelectRack(rackId);
    setMoving(false);
    setDragging('');
    setOver('');
    setAnnouncement(`Rack ${rackId} en columna ${column + 1}, fila ${row + 1}.${other ? ` Se intercambió con el rack ${other.rackId}.` : ''}`);
  };
  const drop = (event: DragEvent, column: number, row: number) => {
    event.preventDefault();
    place(dragging || event.dataTransfer.getData('application/x-opticlean-rack'), column, row);
  };

  return <div className={`floor-plan ${editable ? 'is-editable' : ''}`}>
    <div className="floor-plan-topline"><span><i /> VISTA SUPERIOR</span><span>{layout.rackCount} racks · {columns} columnas</span></div>
    {editable ? <div className="floor-edit-guide"><Icon name="cursor" /><p>Arrastra un rack o selecciona <strong>Mover rack</strong> y toca su destino. Al ocupar otro rack, intercambian posiciones.</p></div> : null}
    <div className="floor-scroll">
      <div className="floor-envelope" style={{ minWidth: columns > 2 ? 380 : 260 }}>
        <div className="floor-columns" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{Array.from({ length: columns }, (_, column) => <span key={column}>Columna {column + 1}</span>)}</div>
        <div className="floor-slots" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="group" aria-label={editable ? 'Plano editable de racks' : 'Distribución de racks'}>
          {Array.from({ length: columns * rows }, (_, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const position = positions.find((entry) => entry.column === column && entry.row === row);
            const rack = position?.rackId;
            const rackStats = rack ? stats?.[rack] : undefined;
            const active = rack === selected.rackId;
            const faded = rack && matchingRacks && !matchingRacks.has(rack);
            const className = `floor-slot ${rack ? 'has-rack' : 'is-empty'} ${active ? 'is-selected' : ''} ${faded ? 'is-muted' : ''} ${over === `${column}:${row}` ? 'is-drop-target' : ''}`;
            return <button key={`${column}:${row}`} type="button" className={className}
              disabled={!rack && !editable} draggable={editable && !!rack}
              aria-pressed={rack ? active : undefined}
              aria-label={rack ? `Rack ${rack}, columna ${column + 1}, fila ${row + 1}${rackStats ? `, ${rackStats.occupied} de ${rackStats.total} ubicaciones ocupadas` : ''}` : `Espacio libre, columna ${column + 1}, fila ${row + 1}`}
              onClick={() => { if (moving && editable) place(selected.rackId, column, row); else if (rack) onSelectRack(rack); }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setMoving(false);
                if (!editable || !rack || !event.altKey) return;
                const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
                const offset = offsets[event.key];
                if (!offset) return;
                event.preventDefault();
                const nextColumn = column + offset[0];
                const nextRow = row + offset[1];
                if (nextColumn >= 0 && nextColumn < FLOOR_COLUMNS && nextRow >= 0 && nextRow < FLOOR_ROWS) place(rack, nextColumn, nextRow);
              }}
              onDragStart={(event) => { if (!rack || !editable) return; event.dataTransfer.setData('application/x-opticlean-rack', rack); event.dataTransfer.effectAllowed = 'move'; setDragging(rack); onSelectRack(rack); }}
              onDragEnd={() => { setDragging(''); setOver(''); }}
              onDragOver={(event) => { if (!editable || !dragging) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(`${column}:${row}`); }}
              onDrop={(event) => drop(event, column, row)}>
              <span className="floor-slot-coordinate">{row + 1}.{column + 1}</span>
              {rack ? <><span className="floor-rack-name"><Icon name="warehouse" /><strong>{rack}</strong>{editable ? <Icon name="menu" /> : null}</span><span className="floor-rack-shelves" aria-hidden="true"><i /><i /><i /></span><span className="floor-rack-meta">{rackStats ? `${rackStats.occupied}/${rackStats.total} ocupadas` : `${layout.levels} niveles · ${layout.positionsPerLevel} casillas`}</span>{rackStats ? <span className="floor-rack-fill"><i style={{ width: `${Math.min(100, rackStats.occupied / Math.max(1, rackStats.total) * 100)}%` }} /></span> : null}</> : <span className="floor-free-label">{moving ? 'Colocar aquí' : 'Espacio libre'}</span>}
            </button>;
          })}
        </div>
        <div className="floor-access"><Icon name="receive" /><span>RECEPCIÓN <b>/</b> DESPACHO</span><Icon name="truck" /></div>
      </div>
    </div>
    {editable ? <div className="floor-placement-tools">
      <div><strong>Rack {selected.rackId}</strong><span>Seleccionado · Alt + flechas para mover</span></div>
      <label>Columna<select aria-label={`Columna del rack ${selected.rackId}`} value={selected.column} onChange={(event) => place(selected.rackId, Number(event.target.value), selected.row)}>{Array.from({ length: FLOOR_COLUMNS }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}</select></label>
      <label>Fila<select aria-label={`Fila del rack ${selected.rackId}`} value={selected.row} onChange={(event) => place(selected.rackId, selected.column, Number(event.target.value))}>{Array.from({ length: FLOOR_ROWS }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}</select></label>
      <button type="button" className={`btn ${moving ? 'primary' : ''}`} aria-pressed={moving} onClick={() => setMoving(!moving)}><Icon name={moving ? 'close' : 'swap'} />{moving ? 'Cancelar movimiento' : 'Mover rack'}</button>
    </div> : null}
    <p className="floor-plan-note">{moving ? `Elige el nuevo espacio del rack ${selected.rackId}.` : editable ? 'La distribución es referencial. Los espacios entre módulos representan los pasillos de circulación.' : 'Selecciona un rack para explorar sus niveles y ubicaciones.'}</p>
    <span className="floor-announcement" role="status">{announcement}</span>
  </div>;
}
