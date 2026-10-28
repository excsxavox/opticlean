import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { product } from '../../shared/lib/inventory';
import { Btn, PageHead } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { dateShort } from '../../shared/lib/inventory';
import type { Location } from '../../shared/types';

export function ReceptionPage() {
  const { state, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state as { loc?: string; productId?: string } | null) ?? {};
  const prefillLoc = routeState.loc;
  const [productId, setProductId] = useState(routeState.productId ?? state?.products[0]?.id ?? '');
  const [qty, setQty] = useState(12);
  const [suggestions, setSuggestions] = useState<Location[]>([]);
  const [selectedLoc, setSelectedLoc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    void api.suggest(productId, qty).then((opts) => {
      setSuggestions(opts);
      const pick = prefillLoc && opts.some((l) => l.id === prefillLoc) ? prefillLoc : opts[0]?.id ?? '';
      setSelectedLoc(pick);
    });
  }, [productId, qty, prefillLoc]);

  if (!state) return null;

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      applyResponse(
        await api.receive({
          productId,
          qty: Number(data.qty),
          loc: selectedLoc,
          batch: data.batch,
          expiry: data.expiry,
          supplier: data.supplier,
        }),
      );
      toast('Recepción registrada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <>
      <PageHead
        eyebrow="Ingreso de mercadería"
        title="Registrar recepción"
        desc="Registra el lote y asigna su posición desde el primer momento."
        actions={<Btn icon="arrow" onClick={() => navigate('/inventario')}>Ver inventario</Btn>}
      />
      <div className="receipt-layout">
        <form className="panel" id="receive-form" onSubmit={onSubmit}>
          <div className="form-section">
            <h3>
              <Icon name="box" />
              Información del ingreso
            </h3>
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="rec-product">Producto</label>
                <select
                  id="rec-product"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  {state.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} / {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="rec-supplier">Proveedor</label>
                <input id="rec-supplier" name="supplier" defaultValue={product(state, productId)?.supplier} required />
              </div>
              <div className="field">
                <label htmlFor="rec-qty">Cantidad</label>
                <input
                  id="rec-qty"
                  name="qty"
                  type="number"
                  min={1}
                  max={60}
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value))}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="rec-batch">Lote</label>
                <input id="rec-batch" name="batch" placeholder="Ej. LT-261027" required />
              </div>
              <div className="field">
                <label htmlFor="rec-expiry">Vencimiento</label>
                <input id="rec-expiry" name="expiry" type="date" min={new Date().toISOString().slice(0, 10)} required />
              </div>
            </div>
          </div>
          <div className="form-section">
            <h3>
              <Icon name="pin" />
              Ubicación en bodega
            </h3>
            <div className="field full">
              <label htmlFor="rec-loc">Rack / nivel / posición</label>
              <select id="rec-loc" value={selectedLoc} onChange={(e) => setSelectedLoc(e.target.value)} required>
                {suggestions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id} · {l.category}
                  </option>
                ))}
              </select>
            </div>
            {suggestions[0] ? (
              <div className="quick-rack">
                <Icon name="spark" />
                <div>
                  <strong>Ubicación sugerida: {suggestions[0].id}</strong>
                  <small>Compatibilidad de producto, línea y nivel.</small>
                </div>
              </div>
            ) : null}
            {error ? (
              <div className="form-error visible" role="alert">
                {error}
              </div>
            ) : null}
          </div>
          <div className="form-footer">
            <p>El ingreso actualiza inventario y trazabilidad.</p>
            <button type="submit" className="btn primary">
              <Icon name="check" />
              Confirmar recepción
            </button>
          </div>
        </form>
        <section className="panel">
          <div className="receipt-preview">
            <Icon name="scan" />
            <h3>El control comienza al recibir.</h3>
          </div>
          <div className="panel-body">
            <div className="mini-overline">Últimas recepciones</div>
            {state.receipts.slice(0, 4).map((r) => (
              <div className="task-item" key={r.id} style={{ padding: '15px 0' }}>
                <span className="product-icon">
                  <Icon name="receive" />
                </span>
                <div className="task-info">
                  <strong>{r.id}</strong>
                  <small>{product(state, r.productId)?.name}</small>
                  <div className="subtle" style={{ fontSize: 9 }}>
                    {r.qty} u. · {r.loc} · {dateShort(r.date)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
