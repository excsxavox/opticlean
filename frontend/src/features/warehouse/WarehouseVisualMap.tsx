import { useMemo } from 'react';
import type { AppState } from '../../shared/types';
import {
  plan2D,
  iso3D,
  frontView,
  racksIn,
  rackOfLoc,
  type MapLayer,
  type MapMode,
  type VisualLayout,
  type VisualLocation,
  qtyAtVisual,
  locDays,
  expColor,
} from './engine';

type Props = {
  state: AppState;
  layout: VisualLayout;
  locations: VisualLocation[];
  mapMode: MapMode;
  layer: MapLayer;
  selectedLoc: string;
  level: string;
  openSection: string | null;
  activeFloor: string;
  warehouseSearch: string;
  pickLocs: Set<string>;
  zoom: number;
};

export function WarehouseVisualMap({
  state,
  layout,
  locations,
  mapMode,
  layer,
  selectedLoc,
  level,
  openSection,
  activeFloor,
  warehouseSearch,
  pickLocs,
  zoom,
}: Props) {
  const floor =
    activeFloor === '*'
      ? layout.floors[0]
      : layout.floors.find((f) => f.id === activeFloor) ?? layout.floors[0];

  const svg = useMemo(() => {
    const q = warehouseSearch.trim().toLowerCase();
    const matchingProducts = q
      ? state.products.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(q)).map((p) => p.id)
      : [];
    const matchesLoc = (id: string) =>
      Boolean(q) &&
      (id.toLowerCase().includes(q) ||
        state.lots.some(
          (l) =>
            (l.loc === id || l.loc.startsWith(`${id}-`)) &&
            matchingProducts.includes(l.productId) &&
            l.qty > 0,
        ));
    const isPicking = (id: string) => pickLocs.has(id);
    const cellColor = (id: string, side = false) => {
      const qty = qtyAtVisual(state, id);
      if (id === selectedLoc) return side ? '#0670d3' : '#1795f5';
      if (warehouseSearch && !matchesLoc(id)) return qty ? '#e6edf3' : '#f4f7fa';
      if (isPicking(id) || matchesLoc(id)) return '#64c6b5';
      if (layer === 'exp') return expColor(locDays(state, id));
      if (layer === 'pick') return qty ? '#e6edf3' : '#f4f7fa';
      return qty ? (qty > 44 ? '#89b9dc' : '#bed8eb') : '#f6f9fc';
    };
    const cellAttrs = (id: string) =>
      `class="map-cell" data-action="select-location" data-loc="${id}" tabindex="0" role="button" aria-label="Ubicación ${id}, ${qtyAtVisual(state, id)} unidades"`;
    const common = {
      selectedLoc,
      level,
      cellColor,
      cellAttrs,
      qtyAt: (id: string) => qtyAtVisual(state, id),
    };

    if (mapMode === 'plan') {
      const occ = (rid: string) => {
        const ls = locations.filter((l) => l.rack === rid);
        return { used: ls.filter((l) => qtyAtVisual(state, l.id) > 0).length, total: ls.length || 1 };
      };
      const rackLocs = (rid: string) => locations.filter((l) => l.rack === rid);
      return plan2D(floor, {
        rackFill: (rid: string) => {
          if (layer === 'exp') {
            const ds = rackLocs(rid)
              .map((l) => locDays(state, l.id))
              .filter((d): d is number => d !== null);
            return ds.length ? expColor(Math.min(...ds)) : undefined;
          }
          if (layer === 'pick') return rackLocs(rid).some((l) => isPicking(l.id)) ? '#64c6b5' : '#eef3f8';
          return undefined;
        },
        rackNote: (rid: string) => {
          if (layer === 'exp') {
            const ds = rackLocs(rid)
              .map((l) => locDays(state, l.id))
              .filter((d): d is number => d !== null);
            return ds.length ? `vence ${Math.min(...ds)} d` : '';
          }
          if (layer === 'pick') {
            const pickArr = [...pickLocs];
            const i = pickArr.findIndex((p) => rackOfLoc(p) === rid);
            return i >= 0 ? `paso ${i + 1}` : '';
          }
          const o = occ(rid);
          return `${o.used}/${o.total}`;
        },
        floorName: (id: string) => layout.floors.find((f) => f.id === id)?.name,
        selectedRack: rackOfLoc(selectedLoc),
        searching: Boolean(warehouseSearch || pickLocs.size),
        rackOccupancy: occ,
        matches: (rid: string) =>
          locations.some((l) => l.rack === rid && (matchesLoc(l.id) || isPicking(l.id))),
        sectionStats: (sid: string) => {
          const rs = racksIn(floor, sid) as Array<{ id: string }>;
          const o = rs.map((r) => occ(r.id));
          const u = o.reduce((n: number, x: { used: number }) => n + x.used, 0);
          const t = o.reduce((n: number, x: { total: number }) => n + x.total, 0);
          return `${rs.length} rack${rs.length === 1 ? '' : 's'} · ${t ? Math.round((u / t) * 100) : 0}% ocupado`;
        },
      });
    }

    if (mapMode === 'front') {
      return frontView(layout, rackOfLoc(selectedLoc), common);
    }

    return iso3D(layout, {
      ...common,
      floor: activeFloor === '*' ? '*' : floor.id,
      section: openSection,
      zoom,
      legend: false,
    });
  }, [
    state,
    layout,
    floor,
    locations,
    mapMode,
    layer,
    selectedLoc,
    level,
    openSection,
    activeFloor,
    warehouseSearch,
    pickLocs,
    zoom,
  ]);

  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}
