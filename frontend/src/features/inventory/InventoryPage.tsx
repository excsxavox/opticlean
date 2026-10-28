import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { api } from '../../shared/api/client';
import { available, num, product, stock } from '../../shared/lib/inventory';
import { exportInventory } from '../../shared/lib/csv';
import { Badge, Btn, Empty, PageHead, ProductCell } from '../../shared/components/ui';
import { Icon } from '../../shared/components/Icon';
import { Modal, ModalActions } from '../../shared/components/Modal';

export function InventoryPage() {
  const { state, meta, applyResponse, toast } = useAppState();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [productModal, setProductModal] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  if (!state || !meta) return null;

  const low = state.products.filter((p) => available(state, p.id) < p.min);

  const rows = useMemo(
    () =>
      state.products.filter(
        (p) =>
          (p.name + p.id + p.supplier).toLowerCase().includes(query.toLowerCase()) &&
          (!categoryFilter || p.category === categoryFilter) &&
          (!stockFilter ||
            (stockFilter === 'low' ? available(state, p.id) < p.min : available(state, p.id) >= p.min)),
      ),
    [state, query, categoryFilter, stockFilter],
  );

  const openNew = () => {
    setEditProduct('');
    setFormError('');
  };

  const saveProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const body = {
        id: String(data.id).trim().toUpperCase(),
        sku: String(data.id).trim().toUpperCase(),
        name: String(data.name).trim(),
        category: String(data.category),
        supplier: String(data.supplier).trim(),
        price: Number(data.price),
        min: Number(data.min),
        weight: Number(data.weight),
        volume: Number(data.volume),
        originalId: editProduct || undefined,
      };
      applyResponse(await api.saveProduct(body));
      toast(editProduct ? 'Producto actualizado.' : 'Producto creado.');
      setEditProduct(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error');
    }
  };

  const pDetail = productModal ? product(state, productModal) : null;

  return (
    <>
      <PageHead
        eyebrow="Inventario conectado"
        title="Inventario y disponibilidad"
        desc="Stock por producto, línea y proveedor, con su ubicación exacta."
        actions={
          <>
            <Btn icon="download" onClick={() => { exportInventory(state); toast('Reporte descargado.'); }}>
              Exportar
            </Btn>
            <Btn variant="primary" icon="plus" onClick={openNew}>
              Crear producto
            </Btn>
          </>
        }
      />
      <div className="category-cards">
        {meta.categories.map((c, i) => {
          const ps = state.products.filter((p) => p.category === c);
          const q = ps.reduce((n, p) => n + stock(state, p.id), 0);
          const icons = ['home', 'building', 'box', 'shield'];
          return (
            <button
              type="button"
              key={c}
              className={`category-card ${categoryFilter === c ? 'active' : ''}`}
              onClick={() => setCategoryFilter(categoryFilter === c ? '' : c)}
            >
              <div className="category-top">
                <span className="product-icon">
                  <Icon name={icons[i]} />
                </span>
                <div>
                  <h3>Línea {c}</h3>
                  <p>{ps.length} productos</p>
                </div>
              </div>
              <div className="category-value">
                {num(q)}
                <span>unidades en bodega</span>
              </div>
            </button>
          );
        })}
      </div>
      {low.length ? (
        <div className="callout">
          <Icon name="alert" />
          <span>
            <strong>{low.length} producto(s) bajo el mínimo.</strong> Revisa la reposición.
          </span>
          <Btn variant="ghost" icon="arrow" onClick={() => setStockFilter('low')}>
            Ver productos
          </Btn>
        </div>
      ) : null}
      <section className="panel">
        <div className="toolbar">
          <div className="search-input">
            <Icon name="search" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto o código…" />
          </div>
          <div className="filter-group">
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">Todas las líneas</option>
              {meta.categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
              <option value="">Todos los estados</option>
              <option value="low">Stock bajo</option>
              <option value="ok">Stock suficiente</option>
            </select>
          </div>
        </div>
        {rows.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Proveedor</th>
                    <th>Stock físico</th>
                    <th>Disponible</th>
                    <th>Estado</th>
                    <th>Ubicación</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const locs = [...new Set(state.lots.filter((l) => l.productId === p.id).map((l) => l.loc))];
                    return (
                      <tr key={p.id}>
                        <td>
                          <ProductCell name={p.name} id={p.id} category={p.category} />
                        </td>
                        <td>{p.supplier}</td>
                        <td>
                          <strong>{stock(state, p.id)}</strong>
                        </td>
                        <td>
                          <strong>{available(state, p.id)}</strong>
                        </td>
                        <td>
                          <Badge
                            text={available(state, p.id) < p.min ? 'Bajo mínimo' : 'Disponible'}
                            color={available(state, p.id) < p.min ? 'amber' : 'green'}
                          />
                        </td>
                        <td>
                          {locs[0] ? (
                            <button
                              type="button"
                              className="table-link code-label"
                              onClick={() => navigate('/bodega', { state: { loc: locs[0] } })}
                            >
                              {locs[0]}
                            </button>
                          ) : (
                            'Sin ubicación'
                          )}
                        </td>
                        <td>
                          <button type="button" className="icon-btn" onClick={() => setProductModal(p.id)}>
                            <Icon name="chevron" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>
                {rows.length} productos · {num(rows.reduce((n, p) => n + stock(state, p.id), 0))} unidades
              </span>
            </div>
          </>
        ) : (
          <Empty title="No encontramos productos" desc="Prueba otro filtro." />
        )}
      </section>

      {editProduct !== null ? (
        <Modal
          title={editProduct ? 'Editar producto' : 'Crear producto'}
          subtitle="El catálogo se sincroniza con el servidor."
          onClose={() => setEditProduct(null)}
          footer={<ModalActions onCancel={() => setEditProduct(null)} submitLabel="Guardar producto" formId="product-form" icon="save" />}
        >
          <form id="product-form" onSubmit={saveProduct}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="prod-code">Código / SKU</label>
                <input id="prod-code" name="id" required readOnly={!!editProduct} defaultValue={editProduct || ''} />
              </div>
              <div className="field">
                <label htmlFor="prod-cat">Línea</label>
                <select id="prod-cat" name="category" defaultValue={product(state, editProduct || '')?.category ?? meta.categories[0]}>
                  {meta.categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field full">
                <label htmlFor="prod-name">Nombre</label>
                <input id="prod-name" name="name" required defaultValue={product(state, editProduct || '')?.name ?? ''} />
              </div>
              <div className="field full">
                <label htmlFor="prod-supplier">Proveedor</label>
                <input id="prod-supplier" name="supplier" required defaultValue={product(state, editProduct || '')?.supplier ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="prod-price">Precio (USD)</label>
                <input id="prod-price" name="price" type="number" step="0.01" required defaultValue={product(state, editProduct || '')?.price ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="prod-min">Stock mínimo</label>
                <input id="prod-min" name="min" type="number" required defaultValue={product(state, editProduct || '')?.min ?? 20} />
              </div>
              <div className="field">
                <label htmlFor="prod-weight">Peso (kg)</label>
                <input id="prod-weight" name="weight" type="number" step="0.01" required defaultValue={product(state, editProduct || '')?.weight ?? 1} />
              </div>
              <div className="field">
                <label htmlFor="prod-volume">Volumen (L)</label>
                <input id="prod-volume" name="volume" type="number" step="0.01" required defaultValue={product(state, editProduct || '')?.volume ?? 1} />
              </div>
            </div>
            {formError ? <div className="form-error visible">{formError}</div> : null}
          </form>
        </Modal>
      ) : null}

      {pDetail ? (
        <Modal
          wide
          title={`${pDetail.id} / ${pDetail.name}`}
          subtitle={`${pDetail.category} · ${pDetail.supplier}`}
          onClose={() => setProductModal(null)}
          footer={
            <>
              <Btn icon="edit" onClick={() => { setEditProduct(pDetail.id); setProductModal(null); }}>Editar</Btn>
              <Btn variant="primary" icon="pin" onClick={() => navigate('/bodega', { state: { productId: pDetail.id } })}>
                Localizar
              </Btn>
            </>
          }
        >
          <p className="subtle">Stock físico: {stock(state, pDetail.id)} · Disponible: {available(state, pDetail.id)}</p>
        </Modal>
      ) : null}
    </>
  );
}
