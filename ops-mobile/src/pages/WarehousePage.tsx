import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { productOf } from '../lib/inventory';
import type { AppState, WarehouseFamily } from '../types';

const EMBED_SRC = '/control-embed/index.html?embed=1&mobile=1&v=20261109a#bodega';

type Mode = 'mapa' | 'lista';

type LocRow = {
  loc: string;
  rack: string;
  qty: number;
  productId: string;
  batch: string;
  products: number;
  fragile: boolean;
  family?: WarehouseFamily;
};

function familyOfProduct(state: AppState, productId: string): WarehouseFamily | undefined {
  const p = productOf(state, productId);
  if (!p) return undefined;
  const families = state.families ?? [];
  if (p.familyId) {
    const byId = families.find((f) => f.id === p.familyId);
    if (byId) return byId;
  }
  return families.find((f) => f.productCategories.includes(p.category));
}

function WarehouseList({ state }: { state: AppState }) {
  const [query, setQuery] = useState('');
  const [rack, setRack] = useState('all');
  const [familyId, setFamilyId] = useState('all');

  const occupied = useMemo<LocRow[]>(() => {
    const map = new Map<string, LocRow>();
    for (const lot of state.lots) {
      if (lot.qty <= 0) continue;
      const p = productOf(state, lot.productId);
      const fam = familyOfProduct(state, lot.productId);
      const prev = map.get(lot.loc);
      if (prev) {
        prev.qty += lot.qty;
        if (prev.productId !== lot.productId) prev.products += 1;
        prev.fragile = prev.fragile || !!p?.fragile;
      } else {
        map.set(lot.loc, {
          loc: lot.loc,
          rack: lot.loc.split('-')[0] || '?',
          qty: lot.qty,
          productId: lot.productId,
          batch: lot.batch,
          products: 1,
          fragile: !!p?.fragile,
          family: fam,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.loc.localeCompare(b.loc, 'es', { numeric: true }));
  }, [state]);

  const racks = useMemo(
    () => [...new Set(occupied.map((o) => o.rack))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
    [occupied],
  );

  const families = state.families ?? [];

  const familyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of occupied) {
      if (!row.family) continue;
      counts.set(row.family.id, (counts.get(row.family.id) ?? 0) + 1);
    }
    return counts;
  }, [occupied]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return occupied.filter((row) => {
      if (rack !== 'all' && row.rack !== rack) return false;
      if (familyId !== 'all' && row.family?.id !== familyId) return false;
      if (!q) return true;
      const p = productOf(state, row.productId);
      return `${row.loc} ${row.productId} ${p?.name ?? ''} ${row.family?.name ?? ''} ${row.family?.code ?? ''} ${row.batch}`
        .toLowerCase()
        .includes(q);
    });
  }, [occupied, rack, familyId, query, state]);

  const grouped = useMemo(() => {
    const groups: Array<{ rack: string; rows: LocRow[] }> = [];
    for (const row of filtered) {
      const last = groups[groups.length - 1];
      if (last && last.rack === row.rack) last.rows.push(row);
      else groups.push({ rack: row.rack, rows: [row] });
    }
    return groups;
  }, [filtered]);

  const fragileCount = occupied.filter((r) => r.fragile || r.family?.fragilePreferred).length;
  const selectedFamily = families.find((f) => f.id === familyId);

  return (
    <>
      <header className="page-head wh-head">
        <div>
          <div className="eyebrow">Operación</div>
          <h1>Bodega</h1>
          <p>{state.settings.warehouse}</p>
        </div>
        <div className="wh-head-stat">
          <strong>{filtered.length}</strong>
          <span>ubicaciones</span>
        </div>
      </header>

      <div className="wh-kpis">
        <article>
          <strong>{occupied.length}</strong>
          <span>Ocupadas</span>
        </article>
        <article>
          <strong>{racks.length}</strong>
          <span>Racks</span>
        </article>
        <article>
          <strong>{fragileCount}</strong>
          <span>Frágil</span>
        </article>
      </div>

      {families.length ? (
        <section className="wh-families" aria-label="Filtrar por familia">
          <button
            type="button"
            className={`wh-pill ${familyId === 'all' ? 'is-active' : ''}`}
            onClick={() => setFamilyId('all')}
          >
            Todas <em>{occupied.length}</em>
          </button>
          {families.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`wh-pill ${familyId === f.id ? 'is-active' : ''}`}
              style={{ ['--fam' as string]: f.color }}
              onClick={() => setFamilyId((cur) => (cur === f.id ? 'all' : f.id))}
            >
              <i style={{ background: f.color }} />
              {f.code}
              <em>{familyCounts.get(f.id) ?? 0}</em>
              {f.fragilePreferred ? <span className="wh-pill-frag">F</span> : null}
            </button>
          ))}
        </section>
      ) : null}

      <div className="wh-toolbar">
        <label className="search-input">
          <Icon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar ubicación, lote o producto"
          />
        </label>
        <div className="wh-rack-scroll" role="tablist" aria-label="Racks">
          <button
            type="button"
            role="tab"
            aria-selected={rack === 'all'}
            className={rack === 'all' ? 'is-active' : ''}
            onClick={() => setRack('all')}
          >
            Todos
          </button>
          {racks.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={rack === r}
              className={rack === r ? 'is-active' : ''}
              onClick={() => setRack((cur) => (cur === r ? 'all' : r))}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {selectedFamily ? (
        <div className="wh-filter-bar">
          <span>
            Familia <strong>{selectedFamily.name}</strong>
            {selectedFamily.fragilePreferred ? ' · frágil' : ''}
            {selectedFamily.rackIds?.length ? ` · racks ${selectedFamily.rackIds.join(', ')}` : ''}
          </span>
          <button type="button" onClick={() => setFamilyId('all')}>
            Limpiar
          </button>
        </div>
      ) : null}

      {!occupied.length ? (
        <section className="panel">
          <p className="empty-copy">Sin stock ubicado en la bodega activa.</p>
        </section>
      ) : !filtered.length ? (
        <section className="panel">
          <p className="empty-copy">Sin coincidencias. Prueba otra familia o rack.</p>
        </section>
      ) : (
        <div className="wh-groups">
          {grouped.map((group) => (
            <section key={group.rack} className="wh-group">
              <header className="wh-group-head">
                <strong>Rack {group.rack}</strong>
                <span>{group.rows.length} pos.</span>
              </header>
              <ul className="wh-loc-list">
                {group.rows.map((row) => {
                  const p = productOf(state, row.productId);
                  return (
                    <li key={row.loc} className="wh-loc-card">
                      <div className="wh-loc-top">
                        <code>{row.loc}</code>
                        <strong>{row.qty} u.</strong>
                      </div>
                      <div className="wh-loc-name">{p?.name ?? row.productId}</div>
                      <div className="wh-loc-meta">
                        <span>Lote {row.batch}</span>
                        {row.family ? <em style={{ color: row.family.color }}>{row.family.code}</em> : null}
                        {row.fragile ? <em className="is-fragile">Frágil</em> : null}
                        {row.products > 1 ? <em>{row.products} SKUs</em> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export function WarehousePage({ state }: { state: AppState }) {
  const [mode, setMode] = useState<Mode>('mapa');

  return (
    <div className={`page wh-page ${mode === 'mapa' ? 'wh-page--map' : ''}`}>
      <div className="wh-mode" role="tablist" aria-label="Vista de bodega">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'mapa'}
          className={mode === 'mapa' ? 'is-active' : ''}
          onClick={() => setMode('mapa')}
        >
          <Icon name="warehouse" />
          Mapa visual
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'lista'}
          className={mode === 'lista' ? 'is-active' : ''}
          onClick={() => setMode('lista')}
        >
          <Icon name="box" />
          Lista
        </button>
      </div>

      {mode === 'mapa' ? (
        <div className="wh-embed">
          <iframe
            className="wh-embed__frame"
            title="Bodega visual OPTICLEAN"
            src={EMBED_SRC}
            allow="clipboard-write"
          />
        </div>
      ) : (
        <WarehouseList state={state} />
      )}
    </div>
  );
}
