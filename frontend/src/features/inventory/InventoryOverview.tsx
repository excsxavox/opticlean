import { Icon } from '../../shared/components/Icon';
import { num } from '../../shared/lib/inventory';
import { childrenStatus, isRaw, summarizeByLine } from '../../shared/lib/bom';
import type { AppState } from '../../shared/types';
import type { InventoryRow } from './inventoryModel';

const lineTone = (category: string) => {
  const map: Record<string, string> = {
    Hogar: 'violet',
    Industrial: 'blue',
    Institucional: 'teal',
    Hospitalaria: 'cyan',
    Insumos: 'slate',
  };
  return map[category] ?? 'blue';
};

const lineIcon = (category: string) => {
  const map: Record<string, string> = {
    Hogar: 'droplet',
    Industrial: 'factory',
    Institucional: 'landmark',
    Hospitalaria: 'hospital',
    Insumos: 'flask',
  };
  return map[category] ?? 'box';
};

type Props = {
  state: AppState;
  rows: InventoryRow[];
  category: string;
  focusAttention?: boolean;
  onSelectCategory: (category: string) => void;
  onSelectProduct: (id: string) => void;
  onFilterAttention: (kind: 'finished' | 'raw') => void;
  onReceive: (id: string) => void;
  onPurchase: (id: string, shortage: number) => void;
};

export function InventoryOverview({
  state,
  rows,
  category,
  focusAttention = false,
  onSelectCategory,
  onSelectProduct,
  onFilterAttention,
  onReceive,
  onPurchase,
}: Props) {
  const lines = summarizeByLine(state, rows);
  const finishedCritical = rows
    .filter((r) => !isRaw(r.product) && r.status !== 'healthy')
    .sort((a, b) => a.available - b.available)
    .slice(0, 6);
  const rawCritical = rows
    .filter((r) => isRaw(r.product) && r.status !== 'healthy')
    .sort((a, b) => a.available - b.available)
    .slice(0, 6);
  const blockedParents = rows.filter((r) => {
    if (isRaw(r.product)) return false;
    return childrenStatus(state, r.product).some((c) => c.status !== 'ok');
  }).length;

  const renderCriticalItem = (row: InventoryRow, raw = false) => {
    const coverage = row.product.min > 0
      ? Math.max(4, Math.min(100, (row.available / row.product.min) * 100))
      : 0;
    const children = raw ? [] : childrenStatus(state, row.product);
    const blocked = children.some((c) => c.status !== 'ok');
    const gap = Math.max(row.shortage, row.product.min - row.available, 0);
    return (
      <li key={row.product.id}>
        <button type="button" className="inv-critical-item" onClick={() => onSelectProduct(row.product.id)}>
          <div>
            <strong>{row.product.name}</strong>
            <small>
              {num(row.available)} / mín. {num(row.product.min)}
              {blocked ? ' · Insumo bloquea reposición' : children.length ? ` · ${children.length} insumos` : raw ? ' uds.' : ''}
            </small>
          </div>
          <em className={`inv-pill inv-pill-${row.status === 'unavailable' ? 'critical' : 'low'}`}>
            {row.status === 'unavailable' ? 'Crítico' : 'Bajo'}
          </em>
        </button>
        <div className="inv-critical-meter" role="presentation"><span style={{ width: `${coverage}%` }} /></div>
        <div className="inv-critical-actions">
          <button type="button" onClick={() => onReceive(row.product.id)}>
            <Icon name="receive" /> Recibir
          </button>
          <button type="button" onClick={() => onPurchase(row.product.id, gap || row.product.min || 12)}>
            <Icon name="cart" /> Comprar
          </button>
          <button type="button" onClick={() => onSelectProduct(row.product.id)}>
            Detalle <Icon name="arrow" />
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className={`inv-overview ${focusAttention ? 'inv-overview--attention' : ''}`}>
      {!focusAttention && (
        <section className="inv-line-grid" aria-label="Líneas de producto">
          {lines.map((line) => (
            <button
              type="button"
              key={line.category}
              className={`inv-line-card inv-tone-${lineTone(line.category)} ${category === line.category ? 'is-active' : ''}`}
              aria-pressed={category === line.category}
              onClick={() => onSelectCategory(category === line.category ? '' : line.category)}
            >
              <header>
                <span className="inv-line-icon"><Icon name={lineIcon(line.category)} /></span>
                <div>
                  <strong>Línea {line.category}</strong>
                  <span>{line.total} productos · {line.low ? `${line.low} con alerta` : 'en nivel'}</span>
                </div>
              </header>
              <ul>
                {line.samples.map((sample) => (
                  <li key={sample.id}>
                    <button type="button" onClick={(event) => { event.stopPropagation(); onSelectProduct(sample.id); }}>
                      <span>{sample.name}</span>
                      <em className={`inv-pill inv-pill-${sample.status}`}>{sample.status === 'ok' ? 'OK' : sample.status === 'low' ? 'Bajo' : 'Crítico'}</em>
                    </button>
                    <div className="inv-mini-meter" aria-hidden="true">
                      <span style={{ width: `${Math.max(8, Math.min(100, sample.available > 0 ? 40 + sample.available : 8))}%` }} className={sample.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </section>
      )}

      <section className="inv-critical-grid" aria-label="Alertas críticas">
        <article className="inv-critical-card">
          <header>
            <div>
              <span className="inv-critical-kicker">Reposición</span>
              <h3>Productos críticos <strong>{finishedCritical.length}</strong></h3>
            </div>
            <button type="button" className="inv-text-button" onClick={() => onFilterAttention('finished')}>
              Ver todos <Icon name="arrow" />
            </button>
          </header>
          {finishedCritical.length ? (
            <ul>{finishedCritical.map((row) => renderCriticalItem(row))}</ul>
          ) : (
            <p className="inv-critical-empty">Ningún producto terminado bajo mínimo.</p>
          )}
        </article>

        <article className="inv-critical-card inv-critical-raw">
          <header>
            <div>
              <span className="inv-critical-kicker">Materia prima</span>
              <h3>Insumos críticos <strong>{rawCritical.length}</strong></h3>
            </div>
            <button type="button" className="inv-text-button" onClick={() => onFilterAttention('raw')}>
              Ver todos <Icon name="arrow" />
            </button>
          </header>
          {rawCritical.length ? (
            <ul>{rawCritical.map((row) => renderCriticalItem(row, true))}</ul>
          ) : (
            <p className="inv-critical-empty">Insumos en nivel operativo.</p>
          )}
          {blockedParents > 0 && (
            <p className="inv-critical-foot">
              <Icon name="alert" />
              {blockedParents} productos padre con al menos un insumo bajo mínimo.
            </p>
          )}
        </article>
      </section>
    </div>
  );
}
