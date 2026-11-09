import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { money, num } from '../../shared/lib/inventory';
import { exportEvents, exportInventory, exportLocations, exportReport } from '../../shared/lib/csv';
import { Btn, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import {
  buildReportsSnapshot,
  type ReportPeriod,
  type ReportTab,
} from './reportsModel';
import '../../styles/reports.css';

const periods: { value: ReportPeriod; label: string }[] = [
  { value: 7, label: '7 días' },
  { value: 30, label: '30 días' },
  { value: 90, label: '90 días' },
  { value: 'all', label: 'Todo' },
];

const tabs: { id: ReportTab; label: string; icon: string }[] = [
  { id: 'capital', label: 'Capital', icon: 'chart' },
  { id: 'service', label: 'Servicio', icon: 'orders' },
  { id: 'supply', label: 'Abastecimiento', icon: 'cart' },
  { id: 'warehouse', label: 'Bodega', icon: 'warehouse' },
];

export function ReportsPage() {
  const { state, meta, toast } = useAppState();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<ReportPeriod>(30);
  const [tab, setTab] = useState<ReportTab>('capital');

  const snapshot = useMemo(() => {
    if (!state || !meta) return null;
    return buildReportsSnapshot(state, meta.locations, period);
  }, [state, meta, period]);

  if (!state || !meta || !snapshot) return null;

  const { capital, service, supply, warehouse } = snapshot;
  const insight =
    tab === 'capital' ? capital.insight
      : tab === 'service' ? service.insight
        : tab === 'supply' ? supply.insight
          : warehouse.insight;

  const exportActive = () => {
    if (tab === 'capital') {
      exportReport('OPTICLEAN_Reporte_Capital', [
        'Código', 'Producto', 'Línea', 'Tipo', 'Disponible', 'Mínimo', 'Gap', 'Valor en riesgo',
      ], capital.atRisk.map((r) => [
        r.productId, r.name, r.category, r.kind === 'raw' ? 'Insumo' : 'Producto',
        r.available, r.min, r.gap, r.riskValue,
      ]));
    } else if (tab === 'service') {
      exportReport('OPTICLEAN_Reporte_Servicio', [
        'Producto', 'Línea', 'Demanda periodo', 'Disponible', 'Días cobertura', 'Faltante',
      ], service.velocity.map((r) => [
        r.name, r.category, r.qtyOrdered, r.available, r.coverDays ?? '', r.shortfall,
      ]));
    } else if (tab === 'supply') {
      exportReport('OPTICLEAN_Reporte_Abastecimiento', [
        'Insumo', 'Disponible', 'Mínimo', 'Gap', 'Costo reposición', 'Padres bloqueados', 'Padres',
      ], supply.items.map((r) => [
        r.childName, r.available, r.min, r.gap, r.restockCost, r.parentsBlocked, r.parentNames.join(' | '),
      ]));
    } else {
      exportReport('OPTICLEAN_Reporte_Bodega', [
        'Rack', 'Categoría', 'Posiciones', 'Ocupadas', 'Ocupación %', 'Unidades', 'Valor',
      ], warehouse.byRack.map((r) => [
        r.rack, r.category, r.positions, r.occupied, r.occupancyPct, r.units, r.value,
      ]));
    }
    toast('CSV del reporte activo descargado.');
  };

  return (
    <div className="rpt-page">
      <PageHead
        eyebrow="Información para decidir"
        title="Reportes de operación"
        desc="Capital, servicio, abastecimiento y bodega: qué actuar hoy."
        actions={
          <>
            <Btn icon="download" onClick={exportActive}>Exportar activo</Btn>
            <Btn icon="file" onClick={() => window.print()}>Imprimir</Btn>
          </>
        }
      />

      <div className="rpt-toolbar">
        <div className="rpt-period" role="group" aria-label="Periodo del reporte">
          {periods.map((p) => (
            <button
              key={String(p.value)}
              type="button"
              aria-pressed={period === p.value}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="rpt-classic">
          <Btn
            icon="download"
            onClick={() => {
              exportInventory(state);
              toast('Inventario CSV descargado.');
            }}
          >
            Inventario
          </Btn>
          <Btn
            icon="download"
            onClick={() => {
              exportLocations(state, meta.locations);
              toast('Ubicaciones CSV descargado.');
            }}
          >
            Ubicaciones
          </Btn>
          <Btn
            icon="download"
            onClick={() => {
              exportEvents(state);
              toast('Trazabilidad CSV descargado.');
            }}
          >
            Trazabilidad
          </Btn>
        </div>
      </div>

      <section className="rpt-kpis" aria-label="Indicadores de decisión">
        <div className="rpt-kpi rpt-kpi-risk">
          <span>Capital en riesgo</span>
          <strong>{money(capital.atRiskValue)}</strong>
          <small>Gap bajo mínimo × PVP</small>
        </div>
        <div className={`rpt-kpi ${service.fillRate >= 90 ? 'rpt-kpi-ok' : 'rpt-kpi-warn'}`}>
          <span>Fill rate estimado</span>
          <strong>{service.fillRate}%</strong>
          <small>{service.linesCovered}/{service.linesTotal} líneas cubiertas</small>
        </div>
        <div className={`rpt-kpi ${supply.blockers ? 'rpt-kpi-warn' : 'rpt-kpi-ok'}`}>
          <span>Bloqueos BOM</span>
          <strong>{supply.blockers}</strong>
          <small>{supply.parentsAffected} productos padre afectados</small>
        </div>
        <div className="rpt-kpi">
          <span>Ocupación bodega</span>
          <strong>{warehouse.occupancyPct}%</strong>
          <small>{warehouse.free} posiciones libres</small>
        </div>
      </section>

      <div className="rpt-tabs" role="tablist" aria-label="Tipo de reporte">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="rpt-insight" role="status">
        <Icon name="spark" />
        <span><strong>Insight:</strong> {insight}</span>
      </div>

      {tab === 'capital' && (
        <>
          <div className="rpt-grid-2">
            <section className="rpt-panel">
              <div className="rpt-panel-head">
                <div>
                  <h3>Valor por línea</h3>
                  <p>Inventario a PVP · PT {money(capital.finishedValue)} · MP {money(capital.rawValue)}</p>
                </div>
                <div className="rpt-panel-actions">
                  <Btn icon="arrow" onClick={() => navigate('/inventario')}>Inventario</Btn>
                </div>
              </div>
              {capital.byLine.length ? (
                <div className="rpt-table-scroll">
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Línea</th>
                        <th className="num">Unidades</th>
                        <th className="num">Valor</th>
                        <th className="num">En riesgo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {capital.byLine.map((row) => (
                        <tr key={row.category}>
                          <td>
                            <strong>{row.category}</strong>
                            <small>{row.kind === 'raw' ? 'Insumos' : row.kind === 'finished' ? 'Productos' : 'Mixto'}</small>
                          </td>
                          <td className="num">{num(row.units)}</td>
                          <td className="num">{money(row.value)}</td>
                          <td className="num">
                            {money(row.atRiskValue)}
                            <div className={`rpt-meter ${row.atRiskValue > 0 ? 'is-risk' : ''}`} aria-hidden="true">
                              <span style={{ width: `${Math.min(100, capital.atRiskValue ? (row.atRiskValue / capital.atRiskValue) * 100 : 0)}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="rpt-empty">Sin datos de capital.</div>}
            </section>

            <section className="rpt-panel">
              <div className="rpt-panel-head">
                <div>
                  <h3>Ítems bajo mínimo</h3>
                  <p>Capital en riesgo {money(capital.atRiskValue)} · Exceso {money(capital.excessValue)}</p>
                </div>
                <div className="rpt-panel-actions">
                  <Btn icon="cart" onClick={() => navigate('/compras')}>Abastecer</Btn>
                </div>
              </div>
              {capital.atRisk.length ? (
                <div className="rpt-table-scroll">
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Ítem</th>
                        <th className="num">Disp. / mín.</th>
                        <th className="num">Riesgo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {capital.atRisk.slice(0, 10).map((row) => (
                        <tr key={row.productId}>
                          <td>
                            <strong>{row.name}</strong>
                            <small>{row.productId} · {row.kind === 'raw' ? 'Insumo' : 'Producto'}</small>
                          </td>
                          <td className="num">{num(row.available)} / {num(row.min)}</td>
                          <td className="num">
                            <span className="rpt-pill rpt-pill-risk">Gap {num(row.gap)}</span>
                            <small>{money(row.riskValue)}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="rpt-empty">Ningún ítem bajo mínimo.</div>}
            </section>
          </div>

          <section className="rpt-panel">
            <div className="rpt-panel-head">
              <div>
                <h3>Lotes por vencer (≤90 días)</h3>
                <p>Valor expuesto {money(capital.expiringValue90)}</p>
              </div>
            </div>
            {capital.expiring.length ? (
              <div className="rpt-table-scroll">
                <table className="rpt-table">
                  <thead>
                    <tr>
                      <th>Producto / lote</th>
                      <th>Ubicación</th>
                      <th className="num">Cantidad</th>
                      <th>Vence</th>
                      <th className="num">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capital.expiring.map((row) => (
                      <tr key={row.lotId}>
                        <td>
                          <strong>{row.name}</strong>
                          <small>{row.batch || 'Sin lote'}</small>
                        </td>
                        <td>{row.loc}</td>
                        <td className="num">{num(row.qty)}</td>
                        <td>
                          <span className={`rpt-pill ${row.bucket === '30' ? 'rpt-pill-risk' : 'rpt-pill-warn'}`}>
                            {row.daysLeft}d
                          </span>
                          <small>{row.expiry}</small>
                        </td>
                        <td className="num">{money(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="rpt-empty">No hay lotes venciendo en los próximos 90 días.</div>}
          </section>
        </>
      )}

      {tab === 'service' && (
        <>
          <div className="rpt-grid-2">
            <section className="rpt-panel">
              <div className="rpt-panel-head">
                <div>
                  <h3>Pipeline de pedidos</h3>
                  <p>{service.orderCount} pedidos · {money(service.pipelineValue)}</p>
                </div>
                <div className="rpt-panel-actions">
                  <Btn icon="orders" onClick={() => navigate('/pedidos')}>Pedidos</Btn>
                </div>
              </div>
              {service.byStatus.length ? (
                <div className="rpt-table-scroll">
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Estado</th>
                        <th className="num">Pedidos</th>
                        <th className="num">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {service.byStatus.map((row) => (
                        <tr key={row.status}>
                          <td><strong>{row.status}</strong></td>
                          <td className="num">{row.count}</td>
                          <td className="num">{money(row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="rpt-empty">Sin pedidos en el periodo.</div>}
            </section>

            <section className="rpt-panel">
              <div className="rpt-panel-head">
                <div>
                  <h3>Top clientes</h3>
                  <p>Por valor de pedidos en el periodo</p>
                </div>
                <div className="rpt-panel-actions">
                  <Btn icon="users" onClick={() => navigate('/clientes')}>Clientes</Btn>
                </div>
              </div>
              {service.topClients.length ? (
                <div className="rpt-table-scroll">
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th className="num">Pedidos</th>
                        <th className="num">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {service.topClients.map((row) => (
                        <tr key={row.clientId}>
                          <td>
                            <strong>{row.name}</strong>
                            <small>{row.type}</small>
                          </td>
                          <td className="num">{row.orders}</td>
                          <td className="num">{money(row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="rpt-empty">Sin clientes con pedidos en el periodo.</div>}
            </section>
          </div>

          <section className="rpt-panel">
            <div className="rpt-panel-head">
              <div>
                <h3>Velocidad de producto</h3>
                <p>Demanda del periodo vs stock disponible</p>
              </div>
              <div className="rpt-panel-actions">
                <Btn icon="box" onClick={() => navigate('/inventario')}>Ver stock</Btn>
              </div>
            </div>
            {service.velocity.length ? (
              <div className="rpt-table-scroll">
                <table className="rpt-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="num">Demanda</th>
                      <th className="num">Disponible</th>
                      <th className="num">Cobertura</th>
                      <th className="num">Faltante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {service.velocity.map((row) => (
                      <tr key={row.productId}>
                        <td>
                          <strong>{row.name}</strong>
                          <small>{row.category}</small>
                        </td>
                        <td className="num">{num(row.qtyOrdered)}</td>
                        <td className="num">{num(row.available)}</td>
                        <td className="num">
                          {row.coverDays === null ? '—' : `${row.coverDays}d`}
                        </td>
                        <td className="num">
                          {row.shortfall > 0
                            ? <span className="rpt-pill rpt-pill-risk">{num(row.shortfall)}</span>
                            : <span className="rpt-pill rpt-pill-ok">OK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="rpt-empty">Sin demanda registrada en el periodo.</div>}
          </section>
        </>
      )}

      {tab === 'supply' && (
        <>
          <section className="rpt-panel">
            <div className="rpt-panel-head">
              <div>
                <h3>Prioridad de compra (BOM)</h3>
                <p>Costo estimado para llevar insumos al mínimo: {money(supply.restockCost)}</p>
              </div>
              <div className="rpt-panel-actions">
                <Btn variant="primary" icon="plus" onClick={() => navigate('/compras')}>
                  Ir a compras
                </Btn>
              </div>
            </div>
            {supply.items.length ? (
              <div className="rpt-table-scroll">
                <table className="rpt-table">
                  <thead>
                    <tr>
                      <th>Insumo</th>
                      <th className="num">Disp. / mín.</th>
                      <th className="num">Costo rep.</th>
                      <th>Desbloquea</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {supply.items.map((row) => (
                      <tr key={row.childId}>
                        <td>
                          <strong>{row.childName}</strong>
                          <small>{row.childId}</small>
                        </td>
                        <td className="num">
                          {num(row.available)} / {num(row.min)}
                          <div className="rpt-meter is-warn" aria-hidden="true">
                            <span style={{ width: `${Math.max(4, Math.min(100, row.min ? (row.available / row.min) * 100 : 0))}%` }} />
                          </div>
                        </td>
                        <td className="num">{money(row.restockCost)}</td>
                        <td>
                          <span className="rpt-pill rpt-pill-info">{row.parentsBlocked} padres</span>
                          <small>{row.parentNames.slice(0, 2).join(', ')}{row.parentNames.length > 2 ? '…' : ''}</small>
                        </td>
                        <td>
                          <Btn
                            variant="small"
                            icon="plus"
                            onClick={() => navigate('/compras')}
                          >
                            Solicitar
                          </Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="rpt-empty">Sin bloqueos de materia prima.</div>}
          </section>

          <section className="rpt-panel">
            <div className="rpt-panel-head">
              <div>
                <h3>Productos padre afectados</h3>
                <p>Alcance de fabricación limitado por insumos bajos</p>
              </div>
              <div className="rpt-panel-actions">
                <Btn icon="layers" onClick={() => navigate('/inventario?tipo=finished&estado=attention')}>
                  Ver productos
                </Btn>
              </div>
            </div>
            {supply.parentGaps.length ? (
              <div className="rpt-table-scroll">
                <table className="rpt-table">
                  <thead>
                    <tr>
                      <th>Producto padre</th>
                      <th>Insumo bloqueante</th>
                      <th className="num">Stock padre</th>
                      <th className="num">Fabricables</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supply.parentGaps.map((row) => (
                      <tr key={`${row.parentId}-${row.blockingChildId}`}>
                        <td>
                          <strong>{row.parentName}</strong>
                          <small>{row.parentId}</small>
                        </td>
                        <td>{row.blockingChildName}</td>
                        <td className="num">{num(row.parentAvailable)} / mín. {num(row.parentMin)}</td>
                        <td className="num">
                          <span className={`rpt-pill ${row.buildable < row.parentMin ? 'rpt-pill-warn' : 'rpt-pill-ok'}`}>
                            {num(row.buildable)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="rpt-empty">Todos los padres tienen insumos en nivel.</div>}
          </section>
        </>
      )}

      {tab === 'warehouse' && (
        <>
          <div className="rpt-grid-2">
            <section className="rpt-panel">
              <div className="rpt-panel-head">
                <div>
                  <h3>Densidad por rack</h3>
                  <p>{warehouse.occupied}/{warehouse.totalPositions} posiciones · {money(warehouse.totalValue)}</p>
                </div>
                <div className="rpt-panel-actions">
                  <Btn icon="map" onClick={() => navigate('/bodega')}>Mapa</Btn>
                </div>
              </div>
              {warehouse.byRack.length ? (
                <div className="rpt-table-scroll">
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Rack</th>
                        <th className="num">Ocupación</th>
                        <th className="num">Unidades</th>
                        <th className="num">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {warehouse.byRack.slice(0, 12).map((row) => (
                        <tr key={row.rack}>
                          <td>
                            <strong>{row.rack}</strong>
                            <small>{row.category}</small>
                          </td>
                          <td className="num">
                            {row.occupancyPct}%
                            <div className="rpt-meter" aria-hidden="true">
                              <span style={{ width: `${row.occupancyPct}%` }} />
                            </div>
                          </td>
                          <td className="num">{num(row.units)}</td>
                          <td className="num">{money(row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="rpt-empty">Sin geometría de bodega.</div>}
            </section>

            <section className="rpt-panel">
              <div className="rpt-panel-head">
                <div>
                  <h3>Mayor valor por ubicación</h3>
                  <p>Concentración de capital en posiciones</p>
                </div>
              </div>
              {warehouse.topValue.length ? (
                <div className="rpt-table-scroll">
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Ubicación</th>
                        <th className="num">Uds.</th>
                        <th className="num">SKUs</th>
                        <th className="num">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {warehouse.topValue.map((row) => (
                        <tr key={row.loc}>
                          <td>
                            <strong>{row.loc}</strong>
                            <small>Rack {row.rack}</small>
                          </td>
                          <td className="num">{num(row.units)}</td>
                          <td className="num">{row.products}</td>
                          <td className="num">{money(row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="rpt-empty">Sin stock ubicado.</div>}
            </section>
          </div>

          <section className="rpt-panel">
            <div className="rpt-panel-head">
              <div>
                <h3>Ubicaciones con poco movimiento</h3>
                <p>Proxy: sin eventos recientes (≥14 días) o sin historial</p>
              </div>
              <div className="rpt-panel-actions">
                <Btn icon="history" onClick={() => navigate('/trazabilidad')}>Trazabilidad</Btn>
              </div>
            </div>
            {warehouse.idle.length ? (
              <div className="rpt-table-scroll">
                <table className="rpt-table">
                  <thead>
                    <tr>
                      <th>Ubicación</th>
                      <th className="num">Unidades</th>
                      <th className="num">Valor</th>
                      <th>Último movimiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warehouse.idle.map((row) => (
                      <tr key={row.loc}>
                        <td>
                          <strong>{row.loc}</strong>
                          <small>Rack {row.rack}</small>
                        </td>
                        <td className="num">{num(row.units)}</td>
                        <td className="num">{money(row.value)}</td>
                        <td>
                          {row.daysIdle === null
                            ? <span className="rpt-pill rpt-pill-warn">Sin historial</span>
                            : <span className="rpt-pill rpt-pill-info">{row.daysIdle}d idle</span>}
                          {row.lastMoveAt && <small>{row.lastMoveAt.slice(0, 16).replace('T', ' ')}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="rpt-empty">Todas las ubicaciones con stock han tenido movimiento reciente.</div>}
          </section>
        </>
      )}
    </div>
  );
}
