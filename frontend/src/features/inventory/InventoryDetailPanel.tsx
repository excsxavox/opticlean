import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../../shared/components/Icon';
import { Modal } from '../../shared/components/Modal';
import { dateShort, daysUntil, expiryTone, fefoCompare, isLotSellable, money, num } from '../../shared/lib/inventory';
import { childrenStatus, isRaw, parentsOf } from '../../shared/lib/bom';
import { faceLabel } from '../../shared/lib/warehouseLayout';
import type { AppState } from '../../shared/types';
import { inventoryStatusLabels, type InventoryRow } from './inventoryModel';
import '../../styles/inventory-detail.css';

type InventoryDetailPanelProps = {
  state: AppState;
  row: InventoryRow;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onReceive: () => void;
  onPurchase: () => void;
  onLocate: (loc?: string) => void;
  onTrace: () => void;
  onSelectRelated: (id: string) => void;
  onOpenPurchase?: (purchaseId: string) => void;
};

type DetailTab = 'locations' | 'lots' | 'entries' | 'bom' | 'usedBy';

function locationDescription(location: string) {
  const match = /^(.+)-(\d+)-(\d+)(?:-([DT]))?$/.exec(location);
  if (!match) return 'Ubicación en bodega';
  const [, rack, level, position, face] = match;
  return [
    `Rack ${rack}`,
    `nivel ${Number(level)}`,
    `posición ${Number(position)}`,
    faceLabel(face === 'D' || face === 'T' ? face : undefined),
  ].filter(Boolean).join(' · ');
}

function expiryLabel(expiry: string) {
  if (!expiry) return 'Sin vencimiento registrado';
  const date = new Date(expiry.length === 10 ? `${expiry}T12:00:00` : expiry);
  if (!Number.isFinite(date.getTime())) return 'Fecha no disponible';
  return date.toLocaleDateString('es-EC', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil',
  });
}

/**
 * Detalle de un producto del inventario, en modal de dos columnas:
 * resumen fijo (stock, acciones, valores) a la izquierda y pestañas a la derecha.
 */
export function InventoryDetailPanel({
  state, row, onClose, onEdit, onDelete, onReceive, onPurchase, onLocate, onTrace, onSelectRelated, onOpenPurchase,
}: InventoryDetailPanelProps) {
  const id = useId();
  const { product, stock, reserved, available, status, shortage } = row;
  // La pestaña vuelve a Ubicaciones al cambiar de producto (p. ej. desde «Usado en»).
  const [tabState, setTabState] = useState<{ productId: string; tab: DetailTab }>({ productId: product.id, tab: 'locations' });
  const bomChildren = childrenStatus(state, product);
  const usedBy = isRaw(product) ? parentsOf(state, product.id) : [];
  const minimum = Math.max(0, product.min);
  const coverage = minimum > 0 ? Math.max(0, Math.min(100, available / minimum * 100)) : 0;
  const locationTotals = new Map<string, { qty: number; lots: number }>();
  for (const lot of row.lots) {
    const current = locationTotals.get(lot.loc) ?? { qty: 0, lots: 0 };
    locationTotals.set(lot.loc, { qty: current.qty + lot.qty, lots: current.lots + 1 });
  }
  const locations = [...locationTotals.entries()].sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }));
  // Orden de salida FEFO: primero los vendibles (vence antes, entró antes); al final lo que no se puede vender.
  const sellableLots = row.lots.filter((lot) => isLotSellable(state, lot)).sort(fefoCompare);
  const blockedLots = row.lots.filter((lot) => !isLotSellable(state, lot)).sort(fefoCompare);
  const lots = [...sellableLots, ...blockedLots];
  const blockReason = (lot: (typeof row.lots)[number]) => {
    if (lot.onHold) return 'En inspección';
    if (lot.loc === 'CUARENTENA') return 'Cuarentena';
    if (lot.loc === 'TRANSITO') return 'En tránsito';
    const days = daysUntil(lot.expiry);
    if (days == null) return 'Sin fecha de caducidad';
    if (days < 0) return 'Vencido';
    return `Bajo vida útil mínima (${product.minShelfLifeDays ?? 0} días)`;
  };
  // Historial de entradas: cada recepción con su OC, proveedor, lote y cuánto queda hoy.
  const entries = state.receipts
    .filter((r) => r.productId === product.id)
    .map((r) => {
      const left = state.lots
        .filter((lot) => lot.productId === product.id && (lot.receiptId === r.id || (!lot.receiptId && lot.batch === r.batch)))
        .reduce((n, lot) => n + lot.qty, 0);
      return { receipt: r, left };
    });
  const today = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Guayaquil',
  }).format(new Date());

  const tabs: { key: DetailTab; label: string; count: number }[] = [
    { key: 'locations', label: 'Ubicaciones', count: locations.length },
    { key: 'lots', label: 'Lotes', count: lots.length },
    { key: 'entries', label: 'Entradas', count: entries.length },
    ...(bomChildren.length ? [{ key: 'bom' as const, label: 'Insumos', count: bomChildren.length }] : []),
    ...(usedBy.length ? [{ key: 'usedBy' as const, label: 'Usado en', count: usedBy.length }] : []),
  ];
  const requested = tabState.productId === product.id ? tabState.tab : 'locations';
  const tab = tabs.some((t) => t.key === requested) ? requested : 'locations';
  const setTab = (next: DetailTab) => setTabState({ productId: product.id, tab: next });

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((t) => t.key === tab);
    const nextIndex =
      event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
          : event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : (index - 1 + tabs.length) % tabs.length;
    setTab(tabs[nextIndex].key);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIndex]?.focus();
  }

  const kindLabel =
    isRaw(product) && !/insum/i.test(product.category) ? `${product.category} · Insumo` : product.category;

  const header = (
    <div className="invd-title">
      <div className="invd-top">
        <span className="invd-kind">{kindLabel}</span>
        <span className="invd-status"><span aria-hidden="true" />{inventoryStatusLabels[status]}</span>
      </div>
      <h2 id={`${id}-title`}>{product.name}</h2>
      <div className="invd-sub">
        <span className="invd-sku">{product.sku || product.id}</span>
        <span className="invd-dot" aria-hidden="true" />
        <span>{product.supplier || 'Sin proveedor registrado'}</span>
        {usedBy.length > 0 ? (
          <>
            <span className="invd-dot" aria-hidden="true" />
            <button type="button" className="invd-rel" onClick={() => setTab('usedBy')}>
              Usado en {usedBy.length} {usedBy.length === 1 ? 'producto' : 'productos'}
            </button>
          </>
        ) : null}
        {bomChildren.length > 0 ? (
          <>
            <span className="invd-dot" aria-hidden="true" />
            <button type="button" className="invd-rel" onClick={() => setTab('bom')}>
              {bomChildren.length} {bomChildren.length === 1 ? 'insumo' : 'insumos'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );

  const footer = (
    <div className="invd-footer">
      {onEdit ? <button type="button" onClick={onEdit}><Icon name="edit" />Editar ficha</button> : null}
      <button type="button" onClick={onTrace}><Icon name="history" />Trazabilidad</button>
      {onDelete ? <button type="button" className="invd-delete" onClick={onDelete}><Icon name="trash" />Eliminar</button> : null}
    </div>
  );

  const panel = (key: DetailTab, children: ReactNode) => (
    <div
      id={`${id}-${key}`}
      className="invd-tab-content"
      role="tabpanel"
      aria-labelledby={`${id}-${key}-tab`}
      hidden={tab !== key}
      tabIndex={0}
    >
      {children}
    </div>
  );

  return (
    <Modal
      title={`Detalle de ${product.name}`}
      header={header}
      footer={footer}
      className={`inv-detail inv-detail--${status}`}
      bodyClassName="invd-body"
      onClose={onClose}
    >
      <div className="invd-side">
        <div className="invd-stock">
          <div className="invd-available">
            <div>
              <span className="invd-label">Disponible</span>
              <strong className="invd-big">{num(available)}<small>uds.</small></strong>
            </div>
            <div className="invd-minimum">Mínimo<strong>{minimum > 0 ? `${num(minimum)} uds.` : '—'}</strong></div>
          </div>
          {minimum > 0 && (
            <div
              className="invd-meter"
              role="meter"
              aria-label="Disponible respecto al mínimo operativo"
              aria-valuemin={0}
              aria-valuemax={minimum}
              aria-valuenow={Math.max(0, Math.min(minimum, available))}
              aria-valuetext={`${num(available)} unidades disponibles; mínimo ${num(minimum)} unidades`}
            ><span style={{ width: `${coverage}%` }} /></div>
          )}
          <p className="invd-coverage">
            <Icon name={status === 'healthy' ? 'check' : 'alert'} />
            <span>{shortage > 0
              ? <>Faltan <strong>{num(shortage)} uds.</strong> para el mínimo</>
              : available <= 0
                ? 'Sin unidades para nuevos pedidos'
                : minimum > 0
                  ? available === minimum ? 'Justo en el mínimo' : <><strong>{num(available - minimum)} uds.</strong> sobre el mínimo</>
                  : 'Sin mínimo configurado'}</span>
          </p>
          <div className="invd-split">
            <span>Físico <strong>{num(stock)}</strong></span>
            <span>Reservado <strong>{num(reserved)}</strong></span>
            <span
              className="invd-info"
              title="Disponible = físico vendible − reservado en pedidos"
              aria-label="Disponible = físico vendible − reservado en pedidos"
              role="img"
            >
              <Icon name="info" />
            </span>
          </div>
          {row.unsellable > 0 ? (
            <p className="invd-unsellable">
              <strong>{num(row.unsellable)} uds.</strong> no se pueden vender hoy (vencidas, en inspección o con poca vida útil).
            </p>
          ) : null}
        </div>

        <div className="invd-actions">
          <button type="button" className="invd-action invd-action-primary" onClick={onReceive}><Icon name="receive" />Recibir stock</button>
          {status !== 'healthy' && (
            <button type="button" className="invd-action" onClick={onPurchase}><Icon name="cart" />Solicitar compra</button>
          )}
          <button type="button" className="invd-action" onClick={() => onLocate()} disabled={locations.length === 0}><Icon name="map" />Ver en bodega</button>
        </div>

        <section className="invd-values" aria-label="Valores">
          <h3>Valores</h3>
          <dl>
            <div><dt>Precio unitario</dt><dd>{money(product.price)}</dd></div>
            <div><dt>Costo promedio</dt><dd>{product.avgCost ? money(product.avgCost) : 'Sin costo'}</dd></div>
            <div><dt>Valor a costo</dt><dd>{money(row.stockValue)}</dd></div>
          </dl>
        </section>
      </div>

      <div className="invd-main">
        <div className="invd-tabs" role="tablist" aria-label="Existencias del producto">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              id={`${id}-${t.key}-tab`}
              role="tab"
              aria-selected={tab === t.key}
              aria-controls={`${id}-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={navigateTabs}
            >
              {t.label} <span>{t.count}</span>
            </button>
          ))}
        </div>

        {panel('locations', locations.length > 0 ? (
          <>
            <p className="invd-note">Stock físico en la bodega seleccionada.</p>
            <ul className="invd-list">
              {locations.map(([location, totals]) => (
                <li key={location}>
                  <button type="button" className="invd-row" onClick={() => onLocate(location)} aria-label={`Ver ubicación ${location}, ${num(totals.qty)} unidades, en bodega`}>
                    <Icon name="pin" />
                    <span className="invd-row-main">
                      <strong className="invd-mono">{location}</strong>
                      <small>{locationDescription(location)} · {totals.lots} {totals.lots === 1 ? 'lote' : 'lotes'}</small>
                    </span>
                    <span className="invd-qty"><strong>{num(totals.qty)}</strong><small>uds.</small></span>
                    <Icon name="chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : <div className="invd-empty"><Icon name="warehouse" /><strong>Aún no hay existencias</strong><p>Recibe stock para asignar una ubicación en esta bodega.</p></div>)}

        {panel('lots', lots.length > 0 ? (
          <>
            <p className="invd-note">En orden de salida: primero lo que vence antes (FEFO); a igual fecha, lo que entró antes.</p>
            <ul className="invd-list">
              {lots.map((lot) => {
                const sellable = isLotSellable(state, lot);
                const order = sellable ? sellableLots.indexOf(lot) + 1 : 0;
                const days = daysUntil(lot.expiry, today);
                const expired = days != null && days < 0;
                return (
                  <li key={lot.id} className="invd-lot">
                    {sellable
                      ? <span className="fx-order-num" aria-label={`Sale en el puesto ${order}`}>{order}</span>
                      : <span className="invd-lot-blocked" aria-hidden="true"><Icon name="alert" /></span>}
                    <div className="invd-row-main">
                      <strong>
                        {lot.batch || 'Sin lote registrado'}
                        {order === 1 ? <span className="fx-first">Sale 1º</span> : null}
                      </strong>
                      <div className="fx-exit-meta">
                        <span className={expired ? 'invd-expired' : undefined}>
                          {lot.expiry ? `${expired ? 'Vencido' : 'Vence'} ` : ''}{expiryLabel(lot.expiry)}
                        </span>
                        {days != null ? <span className={`fx-chip ${expiryTone(days)}`}>{expired ? `hace ${-days} días` : `${days} días`}</span> : null}
                        {!sellable ? <span className="fx-chip red">{blockReason(lot)}</span> : null}
                        {lot.purchaseId ? (
                          onOpenPurchase ? (
                            <button type="button" className="fx-link" onClick={() => onOpenPurchase(lot.purchaseId!)}>{lot.purchaseId}</button>
                          ) : <span>{lot.purchaseId}</span>
                        ) : null}
                        {lot.receivedAt ? <span>Ingresó {dateShort(lot.receivedAt)}</span> : null}
                      </div>
                    </div>
                    <span className="invd-qty"><strong>{num(lot.qty)}</strong><small>uds.</small></span>
                    <button type="button" className="invd-lot-loc" onClick={() => onLocate(lot.loc)} aria-label={`Ver lote ${lot.batch || lot.id} en ubicación ${lot.loc}`}>
                      <Icon name="pin" />{lot.loc}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : <div className="invd-empty"><Icon name="layers" /><strong>No hay lotes con stock</strong><p>Los lotes aparecerán al registrar una recepción en esta bodega.</p></div>)}

        {panel('entries', entries.length > 0 ? (
          <>
            <p className="invd-note">Cada ingreso con su orden de compra. «Queda» es lo que aún está en bodega de ese ingreso.</p>
            <table className="fx-table invd-entries-table">
              <thead>
                <tr><th>Ingreso</th><th>Orden</th><th>Proveedor</th><th>Lote</th><th>Vence</th><th className="num">Recibido</th><th className="num">Queda</th></tr>
              </thead>
              <tbody>
                {entries.map(({ receipt, left }) => (
                  <tr key={receipt.id}>
                    <td>{dateShort(receipt.receivedAt ?? receipt.date)}<div className="fx-muted">{receipt.id}</div></td>
                    <td>
                      {receipt.purchaseId ? (
                        onOpenPurchase ? <button type="button" className="fx-link" onClick={() => onOpenPurchase(receipt.purchaseId!)}>{receipt.purchaseId}</button> : receipt.purchaseId
                      ) : <span className="fx-chip">{receipt.reason ?? 'Sin orden'}</span>}
                    </td>
                    <td className="invd-ellipsis" title={receipt.supplier || undefined}>{receipt.supplier || '—'}</td>
                    <td>{receipt.batch}</td>
                    <td>{receipt.expiry ? dateShort(receipt.expiry) : '—'}</td>
                    <td className="num">{num(receipt.qty)}</td>
                    <td className="num"><strong>{num(left)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="invd-list invd-entries-list">
              {entries.map(({ receipt, left }) => (
                <li key={receipt.id} className="invd-entry">
                  <div className="invd-row-main">
                    <strong>{receipt.purchaseId ?? receipt.reason ?? 'Sin orden'} · {receipt.batch}</strong>
                    <small>
                      {dateShort(receipt.receivedAt ?? receipt.date)}
                      {receipt.expiry ? ` · vence ${dateShort(receipt.expiry)}` : ''}
                      {receipt.supplier ? ` · ${receipt.supplier}` : ''}
                    </small>
                  </div>
                  <span className="invd-qty"><strong>{num(left)}</strong><small>de {num(receipt.qty)}</small></span>
                </li>
              ))}
            </ul>
          </>
        ) : <div className="invd-empty"><Icon name="receive" /><strong>Sin entradas registradas</strong><p>Las recepciones de este producto aparecerán aquí con su orden de compra.</p></div>)}

        {bomChildren.length > 0 && panel('bom', (
          <>
            <p className="invd-note">Insumos que lleva cada unidad y cuántas unidades alcanzan con el stock de cada uno.</p>
            <ul className="invd-list">
              {bomChildren.map((child) => (
                <li key={child.product.id}>
                  <button type="button" className="invd-row" onClick={() => onSelectRelated(child.product.id)}>
                    <span className="invd-row-main">
                      <strong>{child.product.name}</strong>
                      <small>{child.qtyPerUnit} uds. por unidad · alcanza para {num(child.buildable)}</small>
                      <span className="invd-bom-meter"><span style={{ width: `${Math.max(4, child.coverage)}%` }} className={child.status} /></span>
                    </span>
                    <em className={`invd-pill invd-pill-${child.status}`}>
                      {child.status === 'ok' ? 'OK' : child.status === 'low' ? 'Bajo' : 'Crítico'}
                    </em>
                    <Icon name="chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}

        {usedBy.length > 0 && panel('usedBy', (
          <>
            <p className="invd-note">Productos terminados que llevan este insumo en su receta.</p>
            <ul className="invd-list">
              {usedBy.map((parent) => (
                <li key={parent.id}>
                  <button type="button" className="invd-row" onClick={() => onSelectRelated(parent.id)}>
                    <span className="invd-row-main">
                      <strong>{parent.name}</strong>
                      <small>{parent.id} · {parent.category}</small>
                    </span>
                    <Icon name="chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}
      </div>
    </Modal>
  );
}
