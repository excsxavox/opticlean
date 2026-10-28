import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { available, client, money, orderValue, product } from '../../shared/lib/inventory';
import { Btn, Empty, PageHead, ProductCell } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';

type Line = { productId: string; qty: number };

export function NewOrderPage() {
  const { state, meta, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const routeClient = (useLocation().state as { clientId?: string } | null)?.clientId;
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState(routeClient ?? 'CL001');
  const [priority, setPriority] = useState('Normal');
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const [catalogMode, setCatalogMode] = useState<'products' | 'bundles'>('products');
  const [error, setError] = useState('');

  if (!state || !meta) return null;

  const draft = { clientId, lines, priority };

  const productResults = useMemo(
    () => state.products.filter((p) => (p.name + p.id).toLowerCase().includes(search.toLowerCase())),
    [search, state.products],
  );
  const bundleResults = useMemo(
    () => meta.bundles.filter((b) => (b.name + b.id).toLowerCase().includes(search.toLowerCase())),
    [search, meta.bundles],
  );

  const addProduct = (id: string) => {
    const avail = available(state, id);
    const existing = lines.find((l) => l.productId === id);
    if ((existing?.qty ?? 0) >= avail) {
      toast('No hay más unidades disponibles.');
      return;
    }
    if (existing) setLines(lines.map((l) => (l.productId === id ? { ...l, qty: l.qty + 1 } : l)));
    else setLines([...lines, { productId: id, qty: 1 }]);
  };

  const addBundle = (bundleId: string) => {
    const b = meta.bundles.find((x) => x.id === bundleId);
    if (!b) return;
    for (const line of b.lines) {
      const current = lines.find((l) => l.productId === line.productId)?.qty ?? 0;
      if (current + line.qty > available(state, line.productId)) {
        toast('Stock insuficiente para el paquete.');
        return;
      }
    }
    let next = [...lines];
    for (const line of b.lines) {
      const ex = next.find((l) => l.productId === line.productId);
      if (ex) ex.qty += line.qty;
      else next.push({ ...line });
    }
    setLines(next);
    toast(`${b.name} añadido.`);
  };

  const confirm = async () => {
    setError('');
    try {
      applyResponse(await api.createOrder({ clientId, lines, priority }));
      toast('Pedido creado.');
      navigate('/pedidos');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  };

  return (
    <>
      <PageHead
        eyebrow="Gestión de pedidos"
        title="Nuevo pedido"
        desc="Selecciona cliente y productos con disponibilidad real."
        actions={<Btn icon="back" onClick={() => navigate('/pedidos')}>Volver</Btn>}
      />
      <div className="steps">
        {['Cliente', 'Productos', 'Confirmar'].map((s, i) => (
          <span key={s} className={`step ${step >= i + 1 ? 'active' : ''}`}>
            <b>{step > i + 1 ? '✓' : i + 1}</b>
            {s}
          </span>
        ))}
      </div>

      {step === 1 ? (
        <section className="panel" style={{ maxWidth: 800 }}>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="draft-client">Cliente</label>
              <select id="draft-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                {state.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.type}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Punto de entrega</label>
              <input readOnly value={client(state, clientId)?.address ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="draft-priority">Prioridad</label>
              <select id="draft-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option>Normal</option>
                <option>Alta</option>
              </select>
            </div>
          </div>
          <div className="form-footer">
            <Btn variant="primary" icon="arrow" onClick={() => setStep(2)}>
              Seleccionar productos
            </Btn>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <>
          <div className="toolbar" style={{ padding: 0, border: 0 }}>
            <div className="search-input" style={{ maxWidth: 'none' }}>
              <Icon name="search" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…" />
            </div>
            <div className="segmented">
              <button type="button" className={catalogMode === 'products' ? 'active' : ''} onClick={() => setCatalogMode('products')}>
                Productos
              </button>
              <button type="button" className={catalogMode === 'bundles' ? 'active' : ''} onClick={() => setCatalogMode('bundles')}>
                Paquetes
              </button>
            </div>
          </div>
          <div className="suggest-results">
            {catalogMode === 'products'
              ? productResults.map((p) => (
                  <button key={p.id} type="button" className="suggest-product" onClick={() => addProduct(p.id)} disabled={available(state, p.id) <= 0}>
                    <strong>{p.id}</strong>
                    <small>{p.name}</small>
                  </button>
                ))
              : bundleResults.map((b) => (
                  <button key={b.id} type="button" className="suggest-product bundle-card" onClick={() => addBundle(b.id)}>
                    <strong>{b.name}</strong>
                    <small>{b.description}</small>
                  </button>
                ))}
          </div>
          <section className="panel">
            {lines.length ? (
              <div className="table-scroll">
                <table>
                  <tbody>
                    {lines.map((l) => {
                      const p = product(state, l.productId)!;
                      return (
                        <tr key={l.productId}>
                          <td>
                            <ProductCell name={p.name} id={p.id} category={p.category} />
                          </td>
                          <td>{money(p.price * l.qty)}</td>
                          <td>
                            <input
                              type="number"
                              min={1}
                              max={available(state, p.id)}
                              value={l.qty}
                              onChange={(e) =>
                                setLines(
                                  lines.map((x) =>
                                    x.productId === l.productId ? { ...x, qty: Number(e.target.value) } : x,
                                  ),
                                )
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Agrega productos" desc="Usa el buscador superior." />
            )}
          </section>
          <div className="order-summary">
            <strong>{money(orderValue(state, draft))}</strong>
            <Btn variant="primary" icon="arrow" onClick={() => (lines.length ? setStep(3) : toast('Agrega productos.'))}>
              Revisar pedido
            </Btn>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <div className="two-col">
          <section className="panel">
            {lines.map((l) => (
              <div className="invoice-line" key={l.productId}>
                <span>
                  {product(state, l.productId)?.name} × {l.qty}
                </span>
                <strong>{money((product(state, l.productId)?.price ?? 0) * l.qty)}</strong>
              </div>
            ))}
            <div className="invoice-line total">
              <span>Total</span>
              <span>{money(orderValue(state, draft))}</span>
            </div>
            {error ? <div className="form-error visible">{error}</div> : null}
            <Btn variant="primary" icon="check" onClick={() => void confirm()}>
              Confirmar pedido
            </Btn>
          </section>
        </div>
      ) : null}
    </>
  );
}
