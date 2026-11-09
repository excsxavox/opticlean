import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, findProduct } from '../api';
import { Icon } from '../components/Icon';
import { PlacementCard } from '../components/PlacementCard';
import { QrScanner } from '../components/QrScanner';
import type { AppState, PlacementOption, Product } from '../types';

export function ReceivePage({
  state,
  onRefresh,
}: {
  state: AppState;
  onRefresh: () => Promise<void>;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [scanOpen, setScanOpen] = useState(params.get('scan') === '1');
  const [query, setQuery] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState(12);
  const [batch, setBatch] = useState(() => `LT-${Date.now().toString().slice(-6)}`);
  const [expiry, setExpiry] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 12);
    return d.toISOString().slice(0, 10);
  });
  const [options, setOptions] = useState<PlacementOption[]>([]);
  const [guidance, setGuidance] = useState('');
  const [selectedLoc, setSelectedLoc] = useState('');
  const [loadingPlace, setLoadingPlace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ loc: string; qty: number; name: string } | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.products.slice(0, 8);
    return state.products
      .filter((p) => `${p.id} ${p.sku} ${p.name} ${p.category}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [query, state.products]);

  const selectProduct = (p: Product) => {
    setProduct(p);
    setQuery('');
    setScanOpen(false);
    setError('');
    setDone(null);
  };

  const onScan = (code: string) => {
    const found = findProduct(state.products, code);
    if (!found) {
      setError(`No se encontró producto para “${code}”.`);
      setScanOpen(false);
      return;
    }
    selectProduct(found);
  };

  useEffect(() => {
    if (!product || !Number.isInteger(qty) || qty <= 0) {
      setOptions([]);
      setGuidance('');
      setSelectedLoc('');
      return;
    }
    let cancelled = false;
    setLoadingPlace(true);
    void api
      .placement(product.id, qty)
      .then((res) => {
        if (cancelled) return;
        setOptions(res.options);
        setGuidance(res.guidance);
        setSelectedLoc(res.best?.id ?? '');
        setLoadingPlace(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOptions([]);
        setGuidance('');
        setLoadingPlace(false);
        setError(err instanceof Error ? err.message : 'No se pudo calcular ubicación');
      });
    return () => {
      cancelled = true;
    };
  }, [product, qty]);

  const confirm = async () => {
    if (!product || !selectedLoc || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.receive({
        productId: product.id,
        qty,
        loc: selectedLoc,
        batch,
        expiry,
        supplier: product.supplier,
      });
      await onRefresh();
      setDone({ loc: selectedLoc, qty, name: product.name });
      setProduct(null);
      setOptions([]);
      setGuidance('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar');
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="page">
        <section className="success-panel">
          <Icon name="check" />
          <strong>Ingreso registrado</strong>
          <p>
            {done.qty} u. de <b>{done.name}</b> en <b className="code-label">{done.loc}</b>
          </p>
          <div className="button-row">
            <button type="button" className="btn primary" onClick={() => setDone(null)}>
              Otro ingreso
            </button>
            <button type="button" className="btn" onClick={() => navigate('/')}>
              Ir al inicio
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">Recepción</div>
        <h1>Recibir producto</h1>
        <p>La guía IA usa familia, vacíos y frágil para indicar la ubicación.</p>
      </header>

      {!product ? (
        <section className="panel">
          <div className="panel-body form-stack">
            <label className="field">
              <span>Buscar producto</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nombre, código o SKU"
                autoFocus
              />
            </label>
            <button type="button" className="btn primary full" onClick={() => setScanOpen(true)}>
              <Icon name="scan" /> Abrir escáner QR
            </button>
          </div>
          <ul className="product-list">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => selectProduct(p)}>
                  <div className="product-icon">
                    <Icon name="box" />
                  </div>
                  <div>
                    <strong>{p.name}</strong>
                    <span>
                      {p.id} · {p.category}
                      {p.fragile ? ' · Frágil' : ''}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <section className="panel product-selected">
            <div className="product-icon">
              <Icon name="box" />
            </div>
            <div>
              <strong>{product.name}</strong>
              <span>
                {product.id} · {product.category}
                {product.fragile ? ' · Frágil' : ''}
              </span>
            </div>
            <button type="button" className="btn ghost small" onClick={() => setProduct(null)}>
              Cambiar
            </button>
          </section>

          <section className="panel">
            <div className="panel-body form-stack">
              <label className="field">
                <span>Cantidad</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value))}
                  inputMode="numeric"
                />
              </label>
              <div className="form-grid">
                <label className="field">
                  <span>Lote</span>
                  <input value={batch} onChange={(e) => setBatch(e.target.value)} />
                </label>
                <label className="field">
                  <span>Vence</span>
                  <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                </label>
              </div>
            </div>
          </section>

          <section className="panel suggestion">
            <div className="panel-head">
              <span className="panel-title">
                <Icon name="spark" /> Guía de ubicación
              </span>
              {loadingPlace ? <span className="busy">Calculando…</span> : null}
            </div>
            {guidance ? <p className="guidance">{guidance}</p> : null}
            <div className="place-list">
              {options.map((opt) => (
                <PlacementCard
                  key={opt.id}
                  option={opt}
                  selected={selectedLoc === opt.id}
                  onSelect={() => setSelectedLoc(opt.id)}
                />
              ))}
            </div>
            {!loadingPlace && !options.length ? (
              <p className="empty-copy">No hay ubicación compatible. Reduce la cantidad o libera espacio.</p>
            ) : null}
          </section>

          <button
            type="button"
            className="btn primary full sticky-cta"
            disabled={!selectedLoc || saving || !batch || !expiry}
            onClick={() => void confirm()}
          >
            {saving ? 'Guardando…' : `Confirmar en ${selectedLoc || '…'}`}
          </button>
        </>
      )}

      {error ? <p className="form-error visible">{error}</p> : null}

      {scanOpen ? <QrScanner onClose={() => setScanOpen(false)} onDetect={onScan} /> : null}
    </div>
  );
}
