import { useId, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../shared/components/Icon';
import { money, num } from '../../shared/lib/inventory';
import { childrenStatus, isRaw, parentsOf } from '../../shared/lib/bom';
import { faceLabel } from '../../shared/lib/warehouseLayout';
import type { AppState } from '../../shared/types';
import { inventoryStatusLabels, type InventoryRow } from './inventoryModel';
import '../../styles/inventory-detail.css';

type InventoryDetailPanelProps = {
  state: AppState;
  row: InventoryRow;
  onClose: () => void;
  onEdit: () => void;
  onReceive: () => void;
  onLocate: (loc?: string) => void;
  onTrace: () => void;
  onSelectRelated: (id: string) => void;
};

type DetailTab = 'locations' | 'lots';

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

export function InventoryDetailPanel({
  state, row, onClose, onEdit, onReceive, onLocate, onTrace, onSelectRelated,
}: InventoryDetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>('locations');
  const id = useId();
  const { product, stock, reserved, available, status, shortage } = row;
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
  const lots = [...row.lots].sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
  const today = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Guayaquil',
  }).format(new Date());

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === 'Home' ? 'locations' : event.key === 'End' ? 'lots' : tab === 'locations' ? 'lots' : 'locations';
    setTab(nextTab);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextTab === 'locations' ? 0 : 1]?.focus();
  }

  return (
    <aside className={`inv-detail inv-detail--${status}`} aria-labelledby={`${id}-title`}>
      <div className="inv-detail-heading">
        <span><Icon name="box" /> Detalle del producto</span>
        <button type="button" className="inv-detail-close" aria-label="Cerrar detalle del producto" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="inv-detail-product">
        <div className="inv-detail-product-meta">
          <span className="inv-detail-category">{product.category}</span>
          {isRaw(product) && <span className="inv-detail-category inv-detail-kind">Insumo</span>}
          <span className="inv-detail-status"><span aria-hidden="true" />{inventoryStatusLabels[status]}</span>
        </div>
        <h2 id={`${id}-title`}>{product.name}</h2>
        <div className="inv-detail-sku">SKU <strong>{product.sku || product.id}</strong></div>
        <p className="inv-detail-supplier"><Icon name="building" />{product.supplier || 'Sin proveedor registrado'}</p>
      </div>

      {bomChildren.length > 0 && (
        <section className="inv-detail-bom" aria-label="Estructura de insumos">
          <header>
            <strong>Insumos del producto</strong>
            <span>{bomChildren.length}</span>
          </header>
          <ul>
            {bomChildren.map((child) => (
              <li key={child.product.id}>
                <button type="button" onClick={() => onSelectRelated(child.product.id)}>
                  <span>
                    <strong>{child.product.name}</strong>
                    <small>{child.qtyPerUnit} uds. / unidad · alc. {num(child.buildable)}</small>
                  </span>
                  <em className={`inv-pill inv-pill-${child.status}`}>
                    {child.status === 'ok' ? 'OK' : child.status === 'low' ? 'Bajo' : 'Crítico'}
                  </em>
                </button>
                <div className="inv-detail-bom-meter"><span style={{ width: `${Math.max(4, child.coverage)}%` }} className={child.status} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {usedBy.length > 0 && (
        <section className="inv-detail-bom inv-detail-parents" aria-label="Productos que usan este insumo">
          <header>
            <strong>Usado por</strong>
            <span>{usedBy.length}</span>
          </header>
          <ul>
            {usedBy.map((parent) => (
              <li key={parent.id}>
                <button type="button" onClick={() => onSelectRelated(parent.id)}>
                  <span>
                    <strong>{parent.name}</strong>
                    <small>{parent.id} · {parent.category}</small>
                  </span>
                  <Icon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="inv-detail-stock">
        <dl className="inv-detail-quantities">
          <div><dt>Físico</dt><dd>{num(stock)}</dd></div>
          <div><dt>Reservado</dt><dd>{num(reserved)}</dd></div>
          <div className="inv-detail-available"><dt>Disponible</dt><dd>{num(available)}</dd></div>
        </dl>
        <p className="inv-detail-formula">Disponible = físico − reservado en pedidos.</p>

        <div className="inv-detail-minimum">
          <div className="inv-detail-minimum-heading"><span>Mínimo operativo</span><strong>{num(minimum)} uds.</strong></div>
          {minimum > 0 && (
            <div
              className="inv-detail-meter"
              role="meter"
              aria-label="Disponible respecto al mínimo operativo"
              aria-valuemin={0}
              aria-valuemax={minimum}
              aria-valuenow={Math.max(0, Math.min(minimum, available))}
              aria-valuetext={`${num(available)} unidades disponibles; mínimo ${num(minimum)} unidades`}
            ><span style={{ width: `${coverage}%` }} /></div>
          )}
          <p className="inv-detail-coverage">
            <Icon name={status === 'healthy' ? 'check' : 'alert'} />
            <span>{shortage > 0
              ? <>Faltan <strong>{num(shortage)} uds.</strong> para alcanzar el mínimo.</>
              : available <= 0
                ? 'Sin unidades disponibles para nuevos pedidos.'
                : minimum > 0
                  ? available === minimum ? 'Disponible justo en el mínimo.' : <><strong>{num(available - minimum)} uds.</strong> por encima del mínimo.</>
                  : 'Sin mínimo de stock configurado.'}</span>
          </p>
        </div>
      </div>

      <div className="inv-detail-actions">
        <button type="button" className="inv-detail-action inv-detail-action-primary" onClick={onReceive}><Icon name="receive" />Recibir stock</button>
        <button type="button" className="inv-detail-action" onClick={() => onLocate()} disabled={locations.length === 0}><Icon name="map" />Ver en bodega</button>
      </div>

      <div className="inv-detail-tabs" role="tablist" aria-label="Existencias del producto">
        <button type="button" id={`${id}-locations-tab`} role="tab" aria-selected={tab === 'locations'} aria-controls={`${id}-locations`} tabIndex={tab === 'locations' ? 0 : -1} onClick={() => setTab('locations')} onKeyDown={navigateTabs}>
          Ubicaciones <span>{locations.length}</span>
        </button>
        <button type="button" id={`${id}-lots-tab`} role="tab" aria-selected={tab === 'lots'} aria-controls={`${id}-lots`} tabIndex={tab === 'lots' ? 0 : -1} onClick={() => setTab('lots')} onKeyDown={navigateTabs}>
          Lotes <span>{lots.length}</span>
        </button>
      </div>

      <div id={`${id}-locations`} className="inv-detail-tab-content" role="tabpanel" aria-labelledby={`${id}-locations-tab`} hidden={tab !== 'locations'} tabIndex={0}>
        {locations.length > 0 ? (
          <>
            <p className="inv-detail-section-note">Stock físico en la bodega seleccionada.</p>
            <ul className="inv-detail-locations">
              {locations.map(([location, totals]) => (
                <li key={location}>
                  <button type="button" className="inv-detail-location" onClick={() => onLocate(location)} aria-label={`Ver ubicación ${location}, ${num(totals.qty)} unidades, en bodega`}>
                    <span className="inv-detail-location-icon"><Icon name="pin" /></span>
                    <span className="inv-detail-location-copy"><strong>{location}</strong><small>{locationDescription(location)}</small><small>{totals.lots} {totals.lots === 1 ? 'lote' : 'lotes'}</small></span>
                    <span className="inv-detail-location-qty"><strong>{num(totals.qty)}</strong><small>uds.</small></span>
                    <Icon name="chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : <div className="inv-detail-empty"><Icon name="warehouse" /><strong>Aún no hay existencias</strong><p>Recibe stock para asignar una ubicación en esta bodega.</p></div>}
      </div>

      <div id={`${id}-lots`} className="inv-detail-tab-content" role="tabpanel" aria-labelledby={`${id}-lots-tab`} hidden={tab !== 'lots'} tabIndex={0}>
        {lots.length > 0 ? (
          <>
            <p className="inv-detail-section-note">Ordenados por fecha de vencimiento.</p>
            <ul className="inv-detail-lots">
              {lots.map((lot) => {
                const expired = Boolean(lot.expiry && /^\d{4}-\d{2}-\d{2}/.test(lot.expiry) && lot.expiry.slice(0, 10) < today);
                return (
                  <li key={lot.id} className="inv-detail-lot">
                    <div className="inv-detail-lot-heading"><strong>{lot.batch || 'Sin lote registrado'}</strong><span>{num(lot.qty)} uds.</span></div>
                    <div className={`inv-detail-expiry${expired ? ' inv-detail-expiry--expired' : ''}`}><Icon name={expired ? 'alert' : 'calendar'} /><span>{lot.expiry ? `${expired ? 'Vencido' : 'Vence'}: ` : ''}{expiryLabel(lot.expiry)}</span></div>
                    <button type="button" className="inv-detail-lot-location" onClick={() => onLocate(lot.loc)} aria-label={`Ver lote ${lot.batch || lot.id} en ubicación ${lot.loc}`}><Icon name="pin" />{lot.loc}<Icon name="arrow" /></button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : <div className="inv-detail-empty"><Icon name="layers" /><strong>No hay lotes con stock</strong><p>Los lotes aparecerán al registrar una recepción en esta bodega.</p></div>}
      </div>

      <dl className="inv-detail-values">
        <div><dt>Precio unitario</dt><dd>{money(product.price)}</dd></div>
        <div><dt>Valor del stock físico</dt><dd>{money(row.stockValue)}</dd></div>
      </dl>
      <div className="inv-detail-footer">
        <button type="button" onClick={onEdit}><Icon name="edit" />Editar ficha</button>
        <button type="button" onClick={onTrace}><Icon name="history" />Trazabilidad</button>
      </div>
    </aside>
  );
}
