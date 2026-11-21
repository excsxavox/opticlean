import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Select } from '../../shared/components/Select';
import { api } from '../../shared/api/client';
import { Icon } from '../../shared/components/Icon';
import { useAppState } from '../../shared/hooks/AppStateProvider';
import { useAuth } from '../../shared/hooks/AuthProvider';
import type { HazardClass, Product, ProductComponent, ProductKind } from '../../shared/types';
import { HAZARD_OPTIONS } from '../../shared/lib/wholesale';
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

type StepKey = 'identity' | 'stock' | 'logistics' | 'bom';
type StepDef = { key: StepKey; title: string; subtitle: string; fields: FieldName[] };

const STEPS: StepDef[] = [
  { key: 'identity', title: 'Identidad', subtitle: 'Tipo, código y nombre', fields: ['id', 'category', 'name', 'supplier'] },
  { key: 'stock', title: 'Inventario', subtitle: 'Precio, mínimo y seguridad', fields: ['price', 'min'] },
  { key: 'logistics', title: 'Empaque', subtitle: 'Peso, volumen y presentaciones', fields: ['weight', 'volume'] },
  { key: 'bom', title: 'Insumos', subtitle: 'Estructura padre → hijo', fields: [] },
];

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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  /** Precio, costo e IVA de un producto existente: solo administración. */
  const lockMoney = !!product && !isAdmin;
  const [avgCostDraft, setAvgCostDraft] = useState(product?.avgCost != null ? String(product.avgCost) : '');
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [kind, setKind] = useState<ProductKind>(product?.kind === 'raw' ? 'raw' : 'finished');
  const [hazardClass, setHazardClass] = useState<HazardClass>(product?.hazardClass ?? 'none');
  const [minShelfLifeDays, setMinShelfLifeDays] = useState(product?.minShelfLifeDays ?? 0);
  const [sanitaryRegistration, setSanitaryRegistration] = useState(product?.sanitaryRegistration ?? '');
  const [sanitaryExpires, setSanitaryExpires] = useState(product?.sanitaryExpires ?? '');
  const [ivaRate, setIvaRate] = useState(product?.ivaRate != null ? String(product.ivaRate) : '0.15');
  const [inspectOnReceipt, setInspectOnReceipt] = useState(!!product?.inspectOnReceipt);
  const [perishable, setPerishable] = useState(product?.perishable !== false);
  const [requiresSanitary, setRequiresSanitary] = useState(!!product?.requiresSanitary);
  const [labelText, setLabelText] = useState('');
  const [attributes, setAttributes] = useState(product?.attributes ?? []);
  const [presentations, setPresentations] = useState((product?.presentations ?? []).join(', '));
  const [packUnits, setPackUnits] = useState({
    paquete: product?.packs?.find((pack) => pack.code === 'paquete')?.units ?? 6,
    caja: product?.packs?.find((pack) => pack.code === 'caja')?.units ?? 12,
    bulto: product?.packs?.find((pack) => pack.code === 'bulto')?.units ?? 48,
  });
  const [components, setComponents] = useState<ProductComponent[]>(
    () => (product?.components ?? []).map((c) => ({ productId: c.productId, qty: c.qty })),
  );
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(product ? STEPS.length - 1 : 0);
  const focusOnStepRef = useRef<FieldName | 'first' | null>(null);
  const stepPanelRef = useRef<HTMLDivElement>(null);
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
  const steps = kind === 'raw' ? STEPS.filter((item) => item.key !== 'bom') : STEPS;
  const currentStep = steps[Math.min(step, steps.length - 1)];
  const isLastStep = step >= steps.length - 1;
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

  useEffect(() => {
    const target = focusOnStepRef.current;
    if (!target) return;
    focusOnStepRef.current = null;
    const named = target !== 'first' ? formRef.current?.elements.namedItem(target) : null;
    const element = named instanceof HTMLElement
      ? named
      : stepPanelRef.current?.querySelector<HTMLElement>('input:not([readonly]), select, button[aria-haspopup], .inv-kind-card');
    element?.focus();
  }, [step]);

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

  /** Valida los campos de los pasos indicados y devuelve el índice del primer paso con errores (o -1). */
  const validateSteps = (indexes: number[]): number => {
    const nextErrors: FormErrors = {};
    let firstInvalid = -1;
    let firstField: FieldName | null = null;
    for (const index of indexes) {
      const def = steps[index];
      for (const name of def.fields) {
        const error = validateField(name, values[name]);
        if (error) {
          nextErrors[name] = error;
          if (firstInvalid === -1) { firstInvalid = index; firstField = name; }
        }
      }
      if (def.key === 'bom') {
        const componentError = validateComponents();
        if (componentError) {
          nextErrors.components = componentError;
          if (firstInvalid === -1) firstInvalid = index;
        }
      }
    }
    setErrors((current) => ({ ...current, ...Object.fromEntries(indexes.flatMap((i) => [...steps[i].fields, ...(steps[i].key === 'bom' ? ['components'] : [])]).map((name) => [name, undefined])), ...nextErrors }));
    if (firstInvalid !== -1) {
      if (firstInvalid !== step) {
        focusOnStepRef.current = firstField ?? 'first';
        setStep(firstInvalid);
      } else if (firstField) {
        const field = formRef.current?.elements.namedItem(firstField);
        if (field instanceof HTMLElement) field.focus();
      }
    }
    return firstInvalid;
  };

  const goToStep = (target: number) => {
    if (target === step || target < 0 || target >= steps.length) return;
    if (target > step) {
      const range = Array.from({ length: target - step }, (_, i) => step + i);
      if (validateSteps(range) !== -1) return;
      if (!formRef.current?.reportValidity()) return;
    }
    setServerError('');
    focusOnStepRef.current = 'first';
    setStep(target);
    setMaxReached((current) => Math.max(current, target));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;
    // Enter en un paso intermedio (creación) avanza en lugar de guardar.
    if (!product && !isLastStep) {
      goToStep(step + 1);
      return;
    }
    if (validateSteps(steps.map((_, i) => i)) !== -1) return;
    if (requiresSanitary && !sanitaryRegistration.trim()) {
      setServerError('Indica el registro sanitario.');
      pendingRef.current = false;
      setPending(false);
      return;
    }
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
        hazardClass,
        minShelfLifeDays: Number(minShelfLifeDays) || 0,
        perishable,
        requiresSanitary,
        sanitaryRegistration: sanitaryRegistration.trim() || undefined,
        sanitaryExpires: sanitaryExpires || undefined,
        ivaRate: Number(ivaRate),
        inspectOnReceipt,
        ...(isAdmin && avgCostDraft.trim() !== '' && Number.isFinite(Number(avgCostDraft))
          ? { avgCost: Number(avgCostDraft) }
          : {}),
        stockUnit: 'unidad',
        packs: [
          { code: 'unidad', label: 'Unidad', units: 1 },
          { code: 'paquete', label: 'Paquete', units: Math.max(1, Number(packUnits.paquete) || 1) },
          { code: 'caja', label: 'Caja', units: Math.max(1, Number(packUnits.caja) || 1) },
          { code: 'bulto', label: 'Bulto', units: Math.max(1, Number(packUnits.bulto) || 1) },
        ],
        components: kind === 'raw' ? [] : components.filter((c) => c.productId).map((c) => ({
          productId: c.productId,
          qty: Number(c.qty),
        })),
        attributes,
        presentations: presentations.split(',').map((item) => item.trim()).filter(Boolean),
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

  const packRows = [
    { code: 'paquete' as const, label: 'Paquete' },
    { code: 'caja' as const, label: 'Caja' },
    { code: 'bulto' as const, label: 'Bulto' },
  ];
  const unitWeight = Number(values.weight) || 0;
  const unitVolume = Number(values.volume) || 0;
  const formatQty = (value: number) => value.toLocaleString('es', { maximumFractionDigits: 2 });

  const selectKind = (next: ProductKind) => {
    if (next === kind) return;
    setKind(next);
    if (next === 'raw') {
      setComponents([]);
      if (!values.category || values.category === categories[0]) updateField('category', 'Insumos');
    }
  };

  return (
    <div className="modal-backdrop inv-product-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className="modal inv-product-modal" role="dialog" aria-modal="true" aria-labelledby={`${uniqueId}-title`} aria-describedby={`${uniqueId}-description`} tabIndex={-1}>
        <div className="modal-header inv-product-header">
          <span className="inv-product-symbol" aria-hidden="true"><Icon name={kind === 'raw' ? 'flask' : 'box'} /></span>
          <div>
            <h2 id={`${uniqueId}-title`}>{product ? 'Editar ficha' : 'Crear producto'}</h2>
            <p id={`${uniqueId}-description`}>
              {values.name.trim()
                ? <>{values.id.trim().toUpperCase() || 'Sin código'} · {values.name.trim()}</>
                : product ? 'Actualiza datos, tipo e insumos vinculados.' : 'Completa la ficha en pocos pasos.'}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={close} disabled={pending} aria-label="Cerrar formulario"><Icon name="close" /></button>
        </div>

        <nav className="inv-stepper" aria-label="Pasos del formulario">
          <ol style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
            {steps.map((item, index) => {
              const state = index === step ? 'current' : index <= maxReached ? 'done' : 'todo';
              const hasError = item.fields.some((name) => errors[name]) || (item.key === 'bom' && !!errors.components);
              const reachable = !!product || index <= maxReached + 1;
              return (
                <li key={item.key} className={`inv-step is-${state}${hasError ? ' has-error' : ''}`}>
                  <button
                    type="button"
                    onClick={() => goToStep(index)}
                    disabled={pending || !reachable}
                    aria-current={index === step ? 'step' : undefined}
                  >
                    <span className="inv-step-dot" aria-hidden="true">
                      {hasError ? '!' : state === 'done' ? <Icon name="check" /> : index + 1}
                    </span>
                    <span className="inv-step-text">
                      <strong>{item.title}</strong>
                      <small>{item.subtitle}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="modal-body inv-product-body">
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
              <div ref={stepPanelRef} className="inv-step-panel" key={currentStep.key} role="group" aria-label={`Paso ${step + 1} de ${steps.length}: ${currentStep.title}`}>
                {currentStep.key === 'identity' && (
                  <>
                    <div className="inv-kind-picker" role="radiogroup" aria-label="Tipo de ficha">
                      {([
                        ['finished', 'box', 'Producto terminado', 'Se vende y puede llevar insumos'],
                        ['raw', 'flask', 'Materia prima', 'Insumo para fabricar otros productos'],
                      ] as const).map(([value, icon, title, desc]) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={kind === value}
                          className={`inv-kind-card${kind === value ? ' is-active' : ''}`}
                          onClick={() => selectKind(value)}
                        >
                          <span className="inv-kind-icon" aria-hidden="true"><Icon name={icon} /></span>
                          <span className="inv-kind-text">
                            <strong>{title}</strong>
                            <small>{desc}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="form-grid">
                      <div className="field">
                        <label htmlFor={fieldId('id')}>Código</label>
                        <input {...fieldProps('id')} readOnly={!!product} placeholder="Ej. P025" autoComplete="off" spellCheck={false} />
                        <small id={`${fieldId('id')}-hint`}>{product ? 'No se puede editar.' : 'Único, se guarda en mayúsculas.'}</small>
                        {fieldError('id')}
                      </div>
                      <div className="field">
                        <label htmlFor={fieldId('category')}>Línea</label>
                        <Select {...fieldProps('category')}>
                          <option value="" disabled>Seleccionar línea</option>
                          {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                        </Select>
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
                  </>
                )}

                {currentStep.key === 'stock' && (
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor={fieldId('price')}>Precio por unidad</label>
                      <div className="inv-input-affix">
                        <span aria-hidden="true">USD</span>
                        <input {...fieldProps('price')} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" readOnly={lockMoney} />
                      </div>
                      {fieldError('price')}
                      {lockMoney ? <small>Solo administración cambia el precio.</small> : null}
                    </div>
                    <div className="field">
                      <label htmlFor={fieldId('min')}>Stock mínimo</label>
                      <div className="inv-input-affix is-suffix">
                        <input {...fieldProps('min')} type="number" min="0" step="1" inputMode="numeric" />
                        <span aria-hidden="true">u.</span>
                      </div>
                      <small id={`${fieldId('min')}-hint`}>Te avisamos si el disponible baja de aquí.</small>
                      {fieldError('min')}
                    </div>
                    <div className="field">
                      <label htmlFor={`${uniqueId}-hazard`}>Clase química</label>
                      <Select id={`${uniqueId}-hazard`} value={hazardClass} onChange={(event) => setHazardClass(event.target.value as HazardClass)}>
                        {HAZARD_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </Select>
                      <small>Ácidos, clorados e inflamables no comparten rack.</small>
                    </div>
                    <div className="field">
                      <label htmlFor={`${uniqueId}-shelf`}>Vida útil mínima</label>
                      <div className="inv-input-affix is-suffix">
                        <input id={`${uniqueId}-shelf`} type="number" min={0} step={1} value={minShelfLifeDays} onChange={(event) => setMinShelfLifeDays(Number(event.target.value))} />
                        <span aria-hidden="true">días</span>
                      </div>
                      <small>No se vende un lote que vence antes. Si el producto no caduca, desmarca la casilla.</small>
                    </div>
                    <div className="field full">
                      <label htmlFor={`${uniqueId}-label`}>Texto de la etiqueta</label>
                      <textarea id={`${uniqueId}-label`} value={labelText} onChange={(event) => setLabelText(event.target.value)} placeholder="Pega nombre, presentación y advertencias" />
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          void api.readLabel(labelText).then((reading) => {
                            if (reading.name) setValues((current) => ({ ...current, name: reading.name }));
                            setPresentations(reading.presentations.join(', '));
                            setAttributes(reading.attributes);
                          }).catch((err) => setServerError(err instanceof Error ? err.message : 'No se pudo leer la etiqueta.'));
                        }}
                      >
                        Leer etiqueta
                      </button>
                    </div>
                    <div className="field">
                      <label htmlFor={`${uniqueId}-presentations`}>Presentaciones</label>
                      <input id={`${uniqueId}-presentations`} value={presentations} onChange={(event) => setPresentations(event.target.value)} placeholder="Caja, Galón" />
                    </div>
                    <div className="field full">
                      <label>Atributos</label>
                      {attributes.map((attribute, index) => (
                        <div key={`${attribute.name}-${index}`} className="form-grid">
                          <input
                            aria-label={`Atributo ${index + 1}`}
                            value={attribute.name}
                            onChange={(event) => setAttributes(attributes.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))}
                          />
                          <input
                            aria-label={`Valor ${index + 1}`}
                            value={attribute.value}
                            onChange={(event) => setAttributes(attributes.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))}
                          />
                        </div>
                      ))}
                      <button type="button" className="btn" onClick={() => setAttributes([...attributes, { name: '', value: '' }])}>
                        Atributo
                      </button>
                    </div>
                    <div className="field">
                      <label htmlFor={`${uniqueId}-perishable`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input id={`${uniqueId}-perishable`} type="checkbox" checked={perishable} onChange={(event) => setPerishable(event.target.checked)} />
                        Este producto caduca
                      </label>
                    </div>
                    <div className="field">
                      <label htmlFor={`${uniqueId}-requires-sanitary`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          id={`${uniqueId}-requires-sanitary`}
                          type="checkbox"
                          checked={requiresSanitary}
                          onChange={(event) => setRequiresSanitary(event.target.checked)}
                        />
                        Exige registro sanitario
                      </label>
                    </div>
                    <div className="field">
                      <label htmlFor={`${uniqueId}-sanitary`}>Registro sanitario</label>
                      <input id={`${uniqueId}-sanitary`} value={sanitaryRegistration} onChange={(event) => setSanitaryRegistration(event.target.value)} placeholder="Notificación ARCSA" />
                    </div>
                    <div className="field">
                      <label htmlFor={`${uniqueId}-sanitary-exp`}>Vence el registro</label>
                      <input id={`${uniqueId}-sanitary-exp`} type="date" value={sanitaryExpires} onChange={(event) => setSanitaryExpires(event.target.value)} />
                      <small>Si esta fecha ya pasó, el producto no se puede vender.</small>
                    </div>
                    <div className="field">
                      <label htmlFor={`${uniqueId}-iva`}>Tarifa de IVA</label>
                      <Select id={`${uniqueId}-iva`} value={ivaRate} disabled={lockMoney} onChange={(event) => setIvaRate(event.target.value)}>
                        <option value="0.15">15 %</option>
                        <option value="0">0 %</option>
                      </Select>
                      <small>Se aplica en la factura de venta y al validar la factura del proveedor.</small>
                    </div>
                    <div className="field">
                      <label htmlFor={`${uniqueId}-inspect`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input id={`${uniqueId}-inspect`} type="checkbox" checked={inspectOnReceipt} onChange={(event) => setInspectOnReceipt(event.target.checked)} />
                        Recibir siempre a inspección
                      </label>
                      <small>Cada recepción queda retenida hasta que se revise etiqueta, sello y hoja de seguridad.</small>
                    </div>
                    {isAdmin || product?.avgCost != null ? (
                      <div className="field">
                        <label htmlFor={`${uniqueId}-cost`}>Costo promedio</label>
                        <input
                          id={`${uniqueId}-cost`}
                          type="number"
                          min="0"
                          step="0.0001"
                          value={avgCostDraft}
                          readOnly={!isAdmin}
                          placeholder="Sin costo"
                          onChange={(event) => setAvgCostDraft(event.target.value)}
                        />
                        <small>
                          Se actualiza al recibir contra una orden de compra.
                          {isAdmin ? ' Un cambio manual queda en el historial de cambios.' : ''}
                        </small>
                      </div>
                    ) : null}
                  </div>
                )}

                {currentStep.key === 'logistics' && (
                  <>
                    <div className="form-grid">
                      <div className="field">
                        <label htmlFor={fieldId('weight')}>Peso por unidad</label>
                        <div className="inv-input-affix is-suffix">
                          <input {...fieldProps('weight')} type="number" min="0" step="0.01" inputMode="decimal" />
                          <span aria-hidden="true">kg</span>
                        </div>
                        {fieldError('weight')}
                      </div>
                      <div className="field">
                        <label htmlFor={fieldId('volume')}>Volumen por unidad</label>
                        <div className="inv-input-affix is-suffix">
                          <input {...fieldProps('volume')} type="number" min="0" step="0.01" inputMode="decimal" />
                          <span aria-hidden="true">L</span>
                        </div>
                        {fieldError('volume')}
                      </div>
                    </div>
                    <div className="inv-pack-table" role="group" aria-labelledby={`${uniqueId}-packs`}>
                      <div className="inv-pack-head">
                        <span id={`${uniqueId}-packs`}>Presentación</span>
                        <span>Unidades</span>
                        <span>Total</span>
                      </div>
                      {packRows.map(({ code, label }) => {
                        const units = Math.max(0, Number(packUnits[code]) || 0);
                        return (
                          <div className="inv-pack-row" key={code}>
                            <label htmlFor={`${uniqueId}-pack-${code}`}>{label}</label>
                            <input
                              id={`${uniqueId}-pack-${code}`}
                              type="number"
                              min={1}
                              step={1}
                              value={packUnits[code]}
                              onChange={(event) => setPackUnits((current) => ({ ...current, [code]: Number(event.target.value) }))}
                            />
                            <span className="inv-pack-derived">
                              {formatQty(units * unitWeight)} kg · {formatQty(units * unitVolume)} L
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {currentStep.key === 'bom' && (
                  <>
                    <p className="inv-bom-help">¿Qué insumos lleva cada unidad? Te avisaremos cuando la materia prima bloquee la reposición. <strong>Es opcional.</strong></p>
                    <div className="inv-bom-editor">
                      {components.length ? (
                        <>
                          <div className="inv-bom-editor-head" aria-hidden="true">
                            <span>Insumo</span>
                            <span>Cant. / u.</span>
                          </div>
                          {components.map((row, index) => (
                            <div className="inv-bom-editor-row" key={`${index}-${row.productId || 'new'}`}>
                              <label className="field">
                                <span className="inv-sr-only">Insumo</span>
                                <Select
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
                                </Select>
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
                              <button type="button" className="icon-btn" aria-label={`Quitar insumo ${index + 1}`} onClick={() => removeComponent(index)}>
                                <Icon name="trash" />
                              </button>
                            </div>
                          ))}
                        </>
                      ) : (
                        <div className="inv-bom-empty">
                          <span className="inv-bom-empty-icon" aria-hidden="true"><Icon name="layers" /></span>
                          <strong>Sin insumos vinculados</strong>
                          <small>Puedes añadirlos ahora o más adelante.</small>
                        </div>
                      )}
                      <button type="button" className="btn inv-bom-add" onClick={addComponent}>
                        <Icon name="plus" /> Añadir insumo
                      </button>
                      {errors.components ? <span className="inv-product-field-error">{errors.components}</span> : null}
                    </div>
                  </>
                )}
              </div>
            </fieldset>
            {serverError ? <div ref={errorRef} className="inv-product-save-error" role="alert" tabIndex={-1}><Icon name="alert" /><span>{serverError}</span></div> : null}
          </form>
        </div>

        <div className="modal-footer inv-product-footer">
          <span role="status" className="inv-product-status">
            {pending
              ? 'Guardando…'
              : isLastStep && !product
                ? <><Icon name="info" /> Crear la ficha no añade existencias.</>
                : `Paso ${step + 1} de ${steps.length}`}
          </span>
          <div>
            {step > 0
              ? <button type="button" className="btn" onClick={() => goToStep(step - 1)} disabled={pending}><Icon name="chevron-left" /> Atrás</button>
              : <button type="button" className="btn" onClick={close} disabled={pending}>Cancelar</button>}
            {product && !isLastStep ? (
              <button type="button" className="btn" onClick={() => goToStep(step + 1)} disabled={pending}>
                Siguiente <Icon name="chevron" />
              </button>
            ) : null}
            <button type="submit" form={formId} className="btn primary" disabled={pending}>
              {isLastStep || product ? (
                <>
                  <Icon name={pending ? 'refresh' : 'save'} />
                  {pending ? 'Guardando…' : product ? 'Guardar cambios' : 'Crear ficha'}
                </>
              ) : (
                <>Siguiente <Icon name="chevron" /></>
              )}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
