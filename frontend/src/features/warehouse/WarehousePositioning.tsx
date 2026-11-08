import { useMemo, useState } from 'react';
import type { AppState, Location, WarehouseLayout } from '../../shared/types';
import { scopedLots } from '../../shared/lib/inventory';
import { WarehouseFloorPlan, type RackStats } from './WarehouseFloorPlan';

type Props = {
  state: AppState;
  layout: WarehouseLayout;
  locations: Location[];
  selectedLoc: string;
  level: string;
  query: string;
  matches: Location[];
  pickLocs: Set<string>;
  onSelect: (id: string) => void;
  onSelectRack: (id: string) => void;
};
type Availability = 'all' | 'free' | 'occupied' | 'full';

export function WarehousePositioning({ state, layout, locations, selectedLoc, level, query, matches, pickLocs, onSelect, onSelectRack }: Props) {
  const [availability, setAvailability] = useState<Availability>('all');
  const lots = useMemo(() => scopedLots(state).filter((lot) => lot.qty > 0), [state]);
  const quantities = useMemo(() => {
    const result = new Map<string, number>();
    lots.forEach((lot) => result.set(lot.loc, (result.get(lot.loc) ?? 0) + lot.qty));
    return result;
  }, [lots]);
  const products = new Map(state.products.map((product) => [product.id, product]));
  const firstProducts = new Map(lots.map((lot) => [lot.loc, products.get(lot.productId)]));
  const stats: RackStats = {};
  locations.forEach((location) => {
    const rack = stats[location.rack] ?? { occupied: 0, total: 0, units: 0 };
    const quantity = quantities.get(location.id) ?? 0;
    rack.total++; rack.units += quantity;
    if (quantity > 0) rack.occupied++;
    stats[location.rack] = rack;
  });
  const selected = locations.find((location) => location.id === selectedLoc) ?? locations[0];
  if (!selected) return null;
  const rackIds = Object.keys(stats);
  const rackLocations = locations.filter((location) => location.rack === selected.rack);
  const matching = new Set(matches.map((location) => location.id));
  const withinSearch = (location: Location) => (!query || matching.has(location.id)) && (level === 'all' || String(location.level) === level);
  const matchesAvailability = (location: Location, filter: Availability) => {
    const quantity = quantities.get(location.id) ?? 0;
    return filter === 'all' || (filter === 'free' ? quantity === 0 : filter === 'occupied' ? quantity > 0 : quantity >= location.capacity);
  };
  const visible = rackLocations.filter((location) => withinSearch(location) && matchesAvailability(location, availability));
  const levels = Array.from({ length: layout.levels }, (_, index) => layout.levels - index).filter((value) => level === 'all' || String(value) === level);
  const faces = layout.depthFaces === 2 ? ['D', 'T'] as const : [undefined];
  const filters: { id: Availability; label: string }[] = [{ id: 'all', label: 'Todas' }, { id: 'free', label: 'Libres' }, { id: 'occupied', label: 'Con stock' }, { id: 'full', label: 'Llenas' }];

  return <div className="positioning-workspace">
    <div className="positioning-floor"><WarehouseFloorPlan layout={layout} selectedRack={selected.rack} stats={stats} matchingRacks={query ? new Set(matches.map((location) => location.rack)) : undefined} onSelectRack={(id) => { setAvailability('all'); onSelectRack(id); }} /></div>
    <div className="positioning-rack">
      <div className="positioning-rack-heading"><div><div className="eyebrow">EXPLORADOR DE UBICACIONES</div><h3>Rack {selected.rack}</h3><p>{stats[selected.rack].occupied} de {rackLocations.length} ocupadas · {stats[selected.rack].units.toLocaleString('es-EC')} unidades</p></div><select className="positioning-rack-select" aria-label="Explorar rack" value={selected.rack} onChange={(event) => { setAvailability('all'); onSelectRack(event.target.value); }}>{rackIds.map((id) => <option key={id} value={id}>Rack {id}</option>)}</select></div>
      <div className="positioning-filters" role="group" aria-label="Filtrar ubicaciones por disponibilidad">{filters.map((filter) => <button key={filter.id} type="button" aria-pressed={availability === filter.id} className={availability === filter.id ? 'active' : ''} onClick={() => {
        setAvailability(filter.id);
        const next = rackLocations.find((location) => withinSearch(location) && matchesAvailability(location, filter.id));
        if (next && !rackLocations.some((location) => location.id === selectedLoc && withinSearch(location) && matchesAvailability(location, filter.id))) onSelect(next.id);
      }}>{filter.label}<span>{rackLocations.filter((location) => withinSearch(location) && matchesAvailability(location, filter.id)).length}</span></button>)}</div>
      {!visible.length ? <p className="positioning-empty" role="status">No hay ubicaciones con estos filtros en el rack {selected.rack}. Cambia el filtro o explora otro rack.</p> : null}
      <div className="positioning-grid-scroll">
        <div style={{ minWidth: Math.max(250, layout.positionsPerLevel * 77) }}>
          {levels.map((value) => <section className="positioning-level" key={value} aria-label={`Nivel ${value}`}>
            <div className="positioning-level-title"><strong>Nivel {value}</strong><span>{layout.positionsPerLevel} casillas{layout.depthFaces === 2 ? ' · 2 caras' : ''}</span></div>
            {faces.map((face) => <div key={face ?? 'single'}>{face ? <span className="positioning-face-label">{face === 'D' ? 'Delantera' : 'Trasera'}</span> : null}<div className="positioning-cells" style={{ gridTemplateColumns: `repeat(${layout.positionsPerLevel}, minmax(70px, 1fr))` }}>
              {rackLocations.filter((location) => location.level === value && location.face === face).map((location) => {
                const quantity = quantities.get(location.id) ?? 0;
                const item = firstProducts.get(location.id);
                const dimmed = !withinSearch(location) || !matchesAvailability(location, availability);
                return <button key={location.id} type="button" className={`position-cell ${quantity === 0 ? 'is-free' : quantity >= location.capacity ? 'is-full' : ''} ${location.id === selectedLoc ? 'is-selected' : ''} ${dimmed ? 'is-dimmed' : ''} ${pickLocs.has(location.id) ? 'is-picking' : ''}`} aria-pressed={location.id === selectedLoc} aria-label={`${location.id}, ${quantity === 0 ? 'libre' : `${quantity} de ${location.capacity} unidades`}${item ? `, ${item.name}` : ''}`} title={`${location.id} · ${item?.name ?? 'Disponible'} · ${quantity}/${location.capacity} u.`} onClick={() => onSelect(location.id)}><span className="cell-number">{String(location.pos).padStart(2, '0')}{face ? ` · ${face}` : ''}</span><span className="cell-quantity">{quantity ? `${quantity} u.` : 'Libre'}</span><span className="cell-product">{item?.name ?? `${location.capacity} u. disponibles`}</span></button>;
              })}
            </div></div>)}
          </section>)}
        </div>
      </div>
      <div className="positioning-rack-footer"><div className="positioning-legend"><span><i className="free" />Libre</span><span><i />Con stock</span><span><i className="full" />Llena</span><span><i className="selected" />Seleccionada</span></div><span>Rack → Nivel → Casilla</span></div>
    </div>
  </div>;
}
