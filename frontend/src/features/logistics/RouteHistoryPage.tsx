import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { money } from '../../shared/lib/inventory';
import { Badge, Btn, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { FLEET, buildRouteHistory, fmtHours } from './fleet';
import '../../styles/logistics.css';

export function RouteHistoryPage() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState('2026-10-20');
  const [dateTo, setDateTo] = useState('2026-10-27');
  const [truckId, setTruckId] = useState('all');
  const [warehouseId, setWarehouseId] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const history = useMemo(() => (state ? buildRouteHistory(state) : []), [state]);
  const filtered = useMemo(
    () =>
      history.filter((h) => {
        if (h.date < dateFrom || h.date > dateTo) return false;
        if (truckId !== 'all' && h.truckId !== truckId) return false;
        if (warehouseId !== 'all' && h.warehouseId !== warehouseId) return false;
        return true;
      }),
    [history, dateFrom, dateTo, truckId, warehouseId],
  );

  if (!state) return null;

  const selected = filtered.find((h) => h.id === selectedId) ?? filtered[0] ?? null;

  const totalKm = filtered.reduce((n, h) => n + h.km, 0);
  const totalCost = filtered.reduce((n, h) => n + h.cost, 0);
  const totalDelivered = filtered.reduce((n, h) => n + h.delivered, 0);

  return (
    <div className="log-page log-history-page">
      <PageHead
        eyebrow="Logística"
        title="Historial de rutas"
        desc="Consulta rutas anteriores por fecha, camión o bodega de origen."
        actions={
          <>
            <Btn icon="route" onClick={() => navigate('/logistica/rutas')}>
              Ver rutas activas
            </Btn>
            <Btn icon="truck" onClick={() => navigate('/logistica')}>
              Distribución
            </Btn>
          </>
        }
      />

      <section className="log-metrics" aria-label="Resumen del historial">
        <article className="log-metric">
          <div className="log-metric-label">
            Rutas filtradas <Icon name="route" />
          </div>
          <strong>{filtered.length}</strong>
          <span>en el periodo</span>
        </article>
        <article className="log-metric">
          <div className="log-metric-label">
            Entregas <Icon name="check" />
          </div>
          <strong>{totalDelivered}</strong>
          <span>confirmadas</span>
        </article>
        <article className="log-metric">
          <div className="log-metric-label">
            Distancia <Icon name="map" />
          </div>
          <strong>
            {totalKm}
            <small>km</small>
          </strong>
          <span>recorridos</span>
        </article>
        <article className="log-metric">
          <div className="log-metric-label">
            Costo <Icon name="spark" />
          </div>
          <strong>{money(totalCost)}</strong>
          <span>estimado del periodo</span>
        </article>
      </section>

      <section className="log-panel log-history-filters">
        <div className="log-filter-grid">
          <label>
            Desde
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label>
            Camión
            <select value={truckId} onChange={(e) => setTruckId(e.target.value)}>
              <option value="all">Todos los camiones</option>
              {FLEET.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} · {t.city}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bodega
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="all">Todas las bodegas</option>
              {state.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.city}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <div className="log-history-layout">
        <section className="log-panel">
          <header>
            <h2>Rutas del periodo</h2>
            <p>Camiones anteriores y despachos cerrados</p>
          </header>
          {filtered.length ? (
            <ul className="log-history-list">
              {filtered.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className={`log-history-item ${selected?.id === h.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedId(h.id)}
                  >
                    <span className={`log-history-dot ${h.status === 'Completada' ? 'ok' : h.status === 'Parcial' ? 'partial' : 'issue'}`} />
                    <span>
                      <strong>
                        {h.label} · {h.city}
                      </strong>
                      <small>
                        {h.date} · {h.warehouseName} · {h.stops} paradas
                      </small>
                    </span>
                    <span className="log-history-meta">
                      <Badge
                        text={h.status}
                        color={h.status === 'Completada' ? 'green' : h.status === 'Parcial' ? 'amber' : 'red'}
                      />
                      <em>{money(h.cost)}</em>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="log-empty">No hay rutas con esos filtros.</p>
          )}
        </section>

        <section className="log-panel">
          <header>
            <h2>Detalle de ruta</h2>
            <p>{selected ? `${selected.id} · ${selected.plate}` : 'Selecciona una ruta'}</p>
          </header>
          {selected ? (
            <div className="log-history-detail">
              <dl className="log-detail-grid">
                <div>
                  <dt>Fecha</dt>
                  <dd>{selected.date}</dd>
                </div>
                <div>
                  <dt>Camión</dt>
                  <dd>
                    {selected.label} · {selected.plate}
                  </dd>
                </div>
                <div>
                  <dt>Ciudad</dt>
                  <dd>{selected.city}</dd>
                </div>
                <div>
                  <dt>Bodega origen</dt>
                  <dd>{selected.warehouseName}</dd>
                </div>
                <div>
                  <dt>Paradas</dt>
                  <dd>
                    {selected.delivered}/{selected.stops} entregadas
                  </dd>
                </div>
                <div>
                  <dt>Carga</dt>
                  <dd>{selected.kg.toLocaleString('es-EC')} kg</dd>
                </div>
                <div>
                  <dt>Distancia</dt>
                  <dd>{selected.km} km</dd>
                </div>
                <div>
                  <dt>Tiempo / costo</dt>
                  <dd>
                    {fmtHours(selected.etaHours)} · {money(selected.cost)}
                  </dd>
                </div>
              </dl>
              <div className="log-history-detail-actions">
                <Btn
                  variant="primary"
                  icon="route"
                  onClick={() => navigate('/logistica/rutas', { state: { truckId: selected.truckId } })}
                >
                  Ver camión actual
                </Btn>
                <Btn icon="truck" onClick={() => navigate('/logistica')}>
                  Ir a distribución
                </Btn>
              </div>
            </div>
          ) : (
            <p className="log-empty">Elige una ruta del listado para ver el detalle.</p>
          )}
        </section>
      </div>
    </div>
  );
}
