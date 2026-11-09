import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../../shared/api/client';
import { Icon } from '../../shared/components/Icon';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import type { Product, ProductComponent, ProductKind } from '../../shared/types';
import './inventory-product-form.css';

type ProductFormProps = {
  product?: Product;
  categories: string[];
  products: Product[];
  onClose: () => void;
  onSaved: (productId: string) => void;
};

type FieldName = 'id' | 'category' | 'name' | 'supplier' | 'price' | 'min' | 'weight' | 'volume';
type FormValues = Record<FieldName, string>;
type FormErrors = Partial<Record<FieldName | 'components', string>>;

const fieldOrder: FieldName[] = ['id', 'category', 'name', 'supplier', 'price', 'min', 'weight', 'volume'];
const numericFields: FieldName[] = ['price', 'min', 'weight', 'volume'];

export function InventoryProductForm({ product, categories, products, onClose, onSaved }: ProductFormProps) {
  const { applyResponse, toast } = useAppState();
  const uniqueId = useId();
  const formId = `${uniqueId}-product-form`;
  const dialogRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const closeRef = useRef(onClose);
  const initialFieldRef = useRef(product ? 'name' : 'id');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [kind, setKind] = useState<ProductKind>(product?.kind === 'raw' ? 'raw' : 'finished');
  const [components, setComponents] = useState<ProductComponent[]>(
    () => (product?.components ?? []).map((c) => ({ productId: c.productId, qty: c.qty })),
  );
  const [values, setValues] = useState<FormValues>(() => ({
    id: product?.id ?? '',
    category: product?.category ?? categories[0] ?? '',
    name: product?.name ?? '',
    supplier: product?.supplier ?? '',
    price: product ? String(product.price) : '',
    min: String(product?.min ?? 20),
    weight: String(product?.weight ?? 1),
    volume: String(product?.volume ?? 1),
  }));
  const categoryOptions = [...new Set([...categories, ...(product?.category ? [product.category] : []), 'Insumos'])];
  const supplierOptions = [...new Set(products.map((item) => item.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const componentOptions = products
    .filter((item) => item.id !== product?.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    mountedRef.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const initialField = formRef.current?.elements.namedItem(initialFieldRef.current);
    if (initialField instanceof HTMLElement) initialField.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!pendingRef.current) closeRef.current();
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
        .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) {
        event.preventDefault();
        dialogRef.current.focus();
      } else if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement as HTMLElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      mountedRef.current = false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (serverError) errorRef.current?.focus();
  }, [serverError]);

  const fieldId = (name: FieldName) => `${uniqueId}-${name}`;
  const close = () => {
    if (!pendingRef.current) onClose();
  };

  const validateField = (name: FieldName, value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
      const requiredMessages: Record<FieldName, string> = {
        id: 'Ingresa un código para identificar el producto.',
        category: 'Selecciona una línea de producto.',
        name: 'Ingresa el nombre del producto.',
        supplier: 'Ingresa el nombre del proveedor.',
        price: 'Ingresa el precio por unidad.',
        min: 'Ingresa el stock mínimo.',
        weight: 'Ingresa el peso por unidad.',
        volume: 'Ingresa el volumen por unidad.',
      };
      return requiredMessages[name];
    }
    if (name === 'id' && products.some((item) => item.id !== product?.id && item.id.trim().toUpperCase() === trimmed.toUpperCase())) {
      return 'Este código ya pertenece a otro producto. Usa uno diferente.';
    }
    if (numericFields.includes(name)) {
      const number = Number(trimmed);
      if (!Number.isFinite(number) || number < 0) return 'Ingresa un número igual o mayor que 0.';
      if (name === 'min' && !Number.isInteger(number)) return 'El stock mínimo debe ser un número entero.';
    }
    return '';
  };

  const validateComponents = (): string => {
    if (kind === 'raw') return '';
    const seen = new Set<string>();
    for (const row of components) {
      if (!row.productId) return 'Selecciona el insumo en cada fila de componentes.';
      if (!Number.isFinite(row.qty) || row.qty <= 0) return 'La cantidad de cada componente debe ser mayor que 0.';
      if (seen.has(row.productId)) return 'No repitas el mismo insumo en la estructura.';
      seen.add(row.productId);
    }
    return '';
  };

  const updateField = (name: FieldName, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setServerError('');
  };

  const checkField = (name: FieldName) => {
    const value = name === 'id' && !product ? values.id.trim().toUpperCase() : values[name];
    if (value !== values[name]) setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: validateField(name, value) || undefined }));
  };

  const fieldProps = (name: FieldName) => ({
    id: fieldId(name),
    name,
    required: true,
    value: values[name],
    'aria-invalid': !!errors[name],
    'aria-describedby': [errors[name] ? `${fieldId(name)}-error` : '', ['id', 'min', 'weight', 'volume'].includes(name) ? `${fieldId(name)}-hint` : ''].filter(Boolean).join(' ') || undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => updateField(name, event.target.value),
    onBlur: () => checkField(name),
  });

  const fieldError = (name: FieldName) => errors[name] ? <span id={`${fieldId(name)}-error`} className="inv-product-field-error">{errors[name]}</span> : null;

  const addComponent = () => {
    setComponents((current) => [...current, { productId: '', qty: 1 }]);
    setErrors((current) => ({ ...current, components: undefined }));
  };

  const updateComponent = (index: number, patch: Partial<ProductComponent>) => {
    setComponents((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setErrors((current) => ({ ...current, components: undefined }));
  };

  const removeComponent = (index: number) => {
    setComponents((current) => current.filter((_, i) => i !== index));
    setErrors((current) => ({ ...current, components: undefined }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;
    const nextErrors: FormErrors = {};
    for (const name of fieldOrder) {
      const error = validateField(name, values[name]);
      if (error) nextErrors[name] = error;
    }
    const componentError = validateComponents();
    if (componentError) nextErrors.components = componentError;
    setErrors(nextErrors);
    const firstError = fieldOrder.find((name) => nextErrors[name]);
    if (firstError) {
      const field = formRef.current?.elements.namedItem(firstError);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    if (componentError) return;
    if (!event.currentTarget.reportValidity()) return;

    pendingRef.current = true;
    setPending(true);
    setServerError('');
    const productId = product?.id ?? values.id.trim().toUpperCase();
    try {
      const response = await api.saveProduct({
        id: productId,
        sku: product?.sku ?? productId,
        originalId: product?.id,
        name: values.name.trim(),
        category: kind === 'raw' && !values.category ? 'Insumos' : values.category,
        supplier: values.supplier.trim(),
        price: Number(values.price),
        min: Number(values.min),
        weight: Number(values.weight),
        volume: Number(values.volume),
        kind,
        components: kind === 'raw' ? [] : components.filter((c) => c.productId).map((c) => ({
          productId: c.productId,
          qty: Number(c.qty),
        })),
      });
      applyResponse(response);
      toast(product ? 'Producto actualizado.' : 'Producto creado. Registra una recepción para añadir existencias.');
      if (mountedRef.current) onSaved(productId);
    } catch (error) {
      if (mountedRef.current) setServerError(error instanceof Error ? error.message : 'No pudimos guardar el producto. Inténtalo de nuevo.');
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  };

  return (
    <div className="modal-backdrop inv-product-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className="modal inv-product-modal" role="dialog" aria-modal="true" aria-labelledby={`${uniqueId}-title`} aria-describedby={`${uniqueId}-description`} tabIndex={-1}>
        <div className="modal-header inv-product-header">
          <span className="inv-product-symbol" aria-hidden="true"><Icon name="box" /></span>
          <div>
            <h2 id={`${uniqueId}-title`}>{product ? 'Editar ficha' : 'Crear producto'}</h2>
            <p id={`${uniqueId}-description`}>
              {product
                ? 'Actualiza datos, tipo e insumos vinculados.'
                : 'Define si es producto terminado o materia prima.'}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={close} disabled={pending} aria-label="Cerrar formulario"><Icon name="close" /></button>
        </div>
        <div className="modal-body inv-product-body">
          {!product ? <p className="inv-product-notice"><Icon name="info" /><span>Crear ficha no añade existencias; registra una recepción.</span></p> : null}
          <form
            ref={formRef}
            id={formId}
            className="inv-product-form"
            onSubmit={save}
            aria-busy={pending}
            onInvalid={(event) => {
              const field = event.target as HTMLInputElement | HTMLSelectElement;
              const name = field.name as FieldName;
              if (!fieldOrder.includes(name)) return;
              const error = validateField(name, field.value) || (field.validity.stepMismatch ? 'Usa hasta dos decimales.' : 'Revisa el valor de este campo.');
              setErrors((current) => ({ ...current, [name]: error }));
            }}
          >
            <fieldset className="inv-product-fields" disabled={pending}>
              <section className="inv-product-section" aria-labelledby={`${uniqueId}-identity`}>
                <h3 id={`${uniqueId}-identity`}><span>01</span> Identidad</h3>
                <div className="inv-kind-picker" role="group" aria-label="Tipo de ficha">
                  <button type="button" className={kind === 'finished' ? 'is-active' : ''} aria-pressed={kind === 'finished'} onClick={() => setKind('finished')}>
                    Producto terminado
                  </button>
                  <button
                    type="button"
                    className={kind === 'raw' ? 'is-active' : ''}
                    aria-pressed={kind === 'raw'}
                    onClick={() => {
                      setKind('raw');
                      setComponents([]);
                      if (!values.category || values.category === categories[0]) updateField('category', 'Insumos');
                    }}
                  >
                    Materia prima / Insumo
                  </button>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor={fieldId('id')}>Código</label>
                    <input {...fieldProps('id')} readOnly={!!product} placeholder="Ej. P025" autoComplete="off" spellCheck={false} />
                    <small id={`${fieldId('id')}-hint`}>{product ? 'El código identifica sus movimientos y no se puede editar.' : 'Código único. Se guardará en mayúsculas.'}</small>
                    {fieldError('id')}
                  </div>
                  <div className="field">
                    <label htmlFor={fieldId('category')}>Línea</label>
                    <select {...fieldProps('category')}>
                      <option value="" disabled>Seleccionar línea</option>
                      {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                    {fieldError('category')}
                  </div>
                  <div className="field full">
                    <label htmlFor={fieldId('name')}>Nombre</label>
                    <input {...fieldProps('name')} placeholder="Ej. Limpiador multiusos 1 L" autoComplete="off" />
                    {fieldError('name')}
                  </div>
                  <div className="field full">
                    <label htmlFor={fieldId('supplier')}>Proveedor</label>
                    <input {...fieldProps('supplier')} list={`${uniqueId}-suppliers`} placeholder="Escribe o selecciona un proveedor" autoComplete="off" />
                    <datalist id={`${uniqueId}-suppliers`}>{supplierOptions.map((supplier) => <option key={supplier} value={supplier} />)}</datalist>
                    {fieldError('supplier')}
                  </div>
                </div>
              </section>

              <section className="inv-product-section" aria-labelledby={`${uniqueId}-inventory`}>
                <h3 id={`${uniqueId}-inventory`}><span>02</span> Control de inventario</h3>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor={fieldId('price')}>Precio por unidad (USD)</label>
                    <input {...fieldProps('price')} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" />
                    {fieldError('price')}
                  </div>
                  <div className="field">
                    <label htmlFor={fieldId('min')}>Stock mínimo (unidades)</label>
                    <input {...fieldProps('min')} type="number" min="0" step="1" inputMode="numeric" />
                    <small id={`${fieldId('min')}-hint`}>Te avisamos cuando el disponible esté por debajo de este valor.</small>
                    {fieldError('min')}
                  </div>
                </div>
              </section>

              <section className="inv-product-section" aria-labelledby={`${uniqueId}-unit`}>
                <h3 id={`${uniqueId}-unit`}><span>03</span> Datos por unidad</h3>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor={fieldId('weight')}>Peso (kg)</label>
                    <input {...fieldProps('weight')} type="number" min="0" step="0.01" inputMode="decimal" />
                    <small id={`${fieldId('weight')}-hint`}>Peso de una unidad.</small>
                    {fieldError('weight')}
                  </div>
                  <div className="field">
                    <label htmlFor={fieldId('volume')}>Volumen (L)</label>
                    <input {...fieldProps('volume')} type="number" min="0" step="0.01" inputMode="decimal" />
                    <small id={`${fieldId('volume')}-hint`}>Volumen de una unidad.</small>
                    {fieldError('volume')}
                  </div>
                </div>
              </section>

              {kind === 'finished' && (
                <section className="inv-product-section" aria-labelledby={`${uniqueId}-bom`}>
                  <h3 id={`${uniqueId}-bom`}><span>04</span> Estructura padre → hijo</h3>
                  <p className="inv-bom-help">Indica qué insumos se necesitan por cada unidad del producto. Así verás alertas cuando la materia prima bloquee la reposición.</p>
                  <div className="inv-bom-editor">
                    {components.length ? components.map((row, index) => (
                      <div className="inv-bom-editor-row" key={`${index}-${row.productId || 'new'}`}>
                        <label className="field">
                          <span className="inv-sr-only">Insumo</span>
                          <select
                            value={row.productId}
                            onChange={(event) => updateComponent(index, { productId: event.target.value })}
                            aria-label={`Insumo ${index + 1}`}
                          >
                            <option value="">Seleccionar insumo…</option>
                            {componentOptions.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.kind === 'raw' ? 'MP · ' : ''}{item.name} ({item.id})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field inv-bom-qty">
                          <span className="inv-sr-only">Cantidad</span>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={row.qty}
                            onChange={(event) => updateComponent(index, { qty: Number(event.target.value) })}
                            aria-label={`Cantidad del insumo ${index + 1}`}
                          />
                        </label>
                        <button type="button" className="icon-btn" aria-label="Quitar componente" onClick={() => removeComponent(index)}>
                          <Icon name="close" />
                        </button>
                      </div>
                    )) : (
                      <p className="inv-bom-empty">Sin insumos vinculados. Puedes añadirlos ahora o más adelante.</p>
                    )}
                    <button type="button" className="btn" onClick={addComponent}>
                      <Icon name="plus" /> Añadir insumo
                    </button>
                    {errors.components ? <span className="inv-product-field-error">{errors.components}</span> : null}
                  </div>
                </section>
              )}
            </fieldset>
            {serverError ? <div ref={errorRef} className="inv-product-save-error" role="alert" tabIndex={-1}><Icon name="alert" /><span>{serverError}</span></div> : null}
          </form>
        </div>
        <div className="modal-footer inv-product-footer">
          <span role="status">{pending ? 'Guardando…' : kind === 'finished' ? 'Los insumos son opcionales.' : 'Ficha de materia prima.'}</span>
          <div>
            <button type="button" className="btn" onClick={close} disabled={pending}>Cancelar</button>
            <button type="submit" form={formId} className="btn primary" disabled={pending}>
              <Icon name={pending ? 'refresh' : 'save'} />
              {pending ? 'Guardando…' : product ? 'Guardar cambios' : 'Crear ficha'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
