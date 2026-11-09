import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { available, stock } from '../lib/inventory';
import type { AppState } from '../types';

export function InventoryPage({ state }: { state: AppState }) {
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [filter, setFilter] = useState<'all' | 'low'>(params.get('filter') === 'low' ? 'low' : 'all');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.products
      .map((p) => {
        const onHand = stock(state, p.id);
        const avail = available(state, p.id);
        const status = avail <= 0 ? 'unavailable' : avail < p.min ? 'low' : 'healthy';
        return { p, onHand, avail, status };
      })
      .filter((row) => {
        if (filter === 'low' && row.status === 'healthy') return false;
        if (!q) return true;
        return `${row.p.id} ${row.p.sku} ${row.p.name} ${row.p.category}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const rank = { unavailable: 0, low: 1, healthy: 2 } as const;
        return rank[a.status as keyof typeof rank] - rank[b.status as keyof typeof rank] || a.p.name.localeCompare(b.p.name, 'es');
      });
  }, [state, query, filter]);

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">Operación</div>
        <h1>Inventario</h1>
        <p>Consulta stock, ubicación y productos bajo mínimo.</p>
      </header>

      <div className="toolbar">
        <label className="search-input">
          <Icon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto o código…"
            autoComplete="off"
          />
        </label>
        <div className="segmented">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            Todos
          </button>
          <button type="button" className={filter === 'low' ? 'active' : ''} onClick={() => setFilter('low')}>
            Atención
          </button>
        </div>
      </div>

      <section className="panel">
        <ul className="data-list inventory-list">
          {rows.map(({ p, onHand, avail, status }) => {
            const locs = [...new Set(state.lots.filter((l) => l.productId === p.id && l.qty > 0).map((l) => l.loc))];
            return (
              <li key={p.id}>
                <div className="product-icon">
                  <Icon name="box" />
                </div>
                <div className="inv-body">
                  <strong>{p.name}</strong>
                  <span>
                    {p.id} · {p.category}
                    {p.fragile ? ' · Frágil' : ''}
                  </span>
                  <small>{locs.length ? locs.slice(0, 3).join(' · ') : 'Sin ubicación'}</small>
                </div>
                <div className="inv-qty">
                  <strong>{avail}</strong>
                  <span>disp. / {onHand}</span>
                  <em className={`badge ${status === 'healthy' ? 'green' : status === 'low' ? 'amber' : 'red'}`}>
                    {status === 'healthy' ? 'OK' : status === 'low' ? 'Bajo' : 'Agotado'}
                  </em>
                </div>
              </li>
            );
          })}
        </ul>
        {!rows.length ? <p className="empty-copy">Sin productos para este filtro.</p> : null}
      </section>
    </div>
  );
}
