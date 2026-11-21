/** Componente / materia prima requerida por unidad del producto padre. */
export type ProductComponent = {
  productId: string;
  qty: number;
};

export type ProductKind = 'finished' | 'raw';

export type HazardClass =
  | 'none'
  | 'acid'
  | 'base'
  | 'oxidizer'
  | 'flammable'
  | 'chlorinated'
  | 'aerosol';

/** Empaque de compra. `units` son unidades de stock que entran por cada empaque. */
export type ProductPack = {
  code: string;
  label: string;
  units: number;
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  supplier: string;
  price: number;
  min: number;
  weight: number;
  volume: number;
  /** finished = producto de venta; raw = insumo / materia prima */
  kind?: ProductKind;
  /** Hijos (insumos) necesarios para reponer / fabricar este producto */
  components?: ProductComponent[];
  /** Familia de bodega asignada (opcional; si falta se infiere por categoría) */
  familyId?: string;
  /** Producto frágil: prioriza zonas bajas y racks de familia frágil */
  fragile?: boolean;
  /** Clase química. `none` se puede mezclar con cualquiera. */
  hazardClass?: HazardClass;
  /** Nombre de la unidad en la que se cuenta el stock y se vende. */
  stockUnit?: string;
  packs?: ProductPack[];
  /** Días mínimos de vida útil para poder vender el lote. */
  minShelfLifeDays?: number;
  /** false = no caduca (papel, fundas). Si falta, el lote necesita fecha. */
  perishable?: boolean;
  /** Exige notificación ARCSA vigente para vender. */
  requiresSanitary?: boolean;
  supplierId?: string;
  /** Costo promedio por unidad de stock. */
  avgCost?: number;
  /** Registro o notificación sanitaria (ARCSA). */
  sanitaryRegistration?: string;
  /** Vencimiento del registro sanitario (YYYY-MM-DD). */
  sanitaryExpires?: string;
  /** Tarifa de IVA (0 o 0.15). Si falta se usa la general. */
  ivaRate?: number;
  /** Recibir a inspección: el lote queda retenido hasta liberarlo. */
  inspectOnReceipt?: boolean;
  /** Atributos leídos de la etiqueta o cargados a mano. */
  attributes?: ProductAttribute[];
  /** Presentaciones en las que se compra o vende (caja, galón, saco). */
  presentations?: string[];
};

/** Familia operativa de bodega: agrupa líneas y racks para ubicación inteligente. */
export type WarehouseFamily = {
  id: string;
  code: string;
  name: string;
  productCategories: string[];
  rackIds: string[];
  fragilePreferred: boolean;
  color: string;
  notes?: string;
};

export type Lot = {
  id: string;
  productId: string;
  loc: string;
  qty: number;
  batch: string;
  expiry: string;
  warehouseId?: string;
  /** Orden de compra de origen. */
  purchaseId?: string;
  /** Recepción que lo ingresó. */
  receiptId?: string;
  /** Fecha/hora de ingreso a bodega. Desempata el FEFO cuando dos lotes vencen igual. */
  receivedAt?: string;
  /** Retenido en inspección de calidad: no se vende hasta liberarlo. */
  onHold?: boolean;
};

export type LocationFace = 'D' | 'T';

export type RackPosition = { rackId: string; column: number; row: number };

export type WarehouseLayout = {
  rackCount: number;
  levels: number;
  positionsPerLevel: number;
  capacityPerCell: number;
  /** 1 = una cara; 2 = delantera y trasera por casilla */
  depthFaces: 1 | 2;
  /** Volumen útil por casilla en litros (0 o vacío = sin límite por volumen). */
  cellVolumeL?: number;
  rackPositions?: RackPosition[];
};

export type WarehouseSite = {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
  status: 'Operativa' | 'Inactiva';
  racks: number;
  layout: WarehouseLayout;
  notes?: string;
};

export type Client = {
  id: string;
  name: string;
  contact: string;
  address: string;
  email: string;
  type: string;
  /** Ciudad de entrega para agrupación logística */
  city?: string;
  /** Sector / barrio de entrega */
  sector?: string;
  /** Límite de crédito autorizado (USD) */
  creditLimit?: number;
  /** Días de plazo para pagar una factura antes de bloquear pedidos. */
  paymentTermsDays?: number;
  /** RUC del cliente, 13 dígitos. Hace falta para facturar. */
  taxId?: string;
  phone?: string;
  /** Cada cuántos días suele reponer. Sirve para el pronóstico por cliente. */
  reorderEveryDays?: number;
  lat?: number;
  lng?: number;
};

export type SalesChannel = 'portal' | 'ejecutivo' | 'reposicion';

export type ProductAttribute = { name: string; value: string };

export type OrderLine = { productId: string; qty: number; unitPrice?: number };

export type OrderKit = { bundleId: string; qty: number };

export type OrderPick = OrderLine & {
  batch?: string;
  loc?: string;
  expiry?: string;
  purchaseId?: string;
};

export type OrderShortage = { productId: string; qty: number };

export type Order = {
  id: string;
  clientId: string;
  status: string;
  date: string;
  lines: OrderLine[];
  /** Paquetes vendidos sin armar: reservan sus componentes. */
  kits?: OrderKit[];
  priority: string;
  vehicle?: string;
  /** Placa del camión donde está cargado, antes de despachar. */
  stagedPlate?: string;
  picks?: OrderPick[];
  incident?: string;
  notes?: string;
  deliveredTo?: string;
  deliveryNotes?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /** Bodeguero (rol ops) asignado para preparar el pedido */
  assignedToUserId?: string;
  assignedToName?: string;
  assignedAt?: string;
  /** Faltante que originó compras (estado Esperando stock). */
  shortages?: OrderShortage[];
  /** Órdenes de compra generadas para cubrir el faltante. */
  purchaseIds?: string[];
  createdBy?: string;
  /** portal, ejecutivo o reposición programada. */
  channel?: SalesChannel;
  /** Cotización que originó el pedido. */
  quoteId?: string;
  /** Código de 6 dígitos que el cliente dicta al recibir. */
  deliveryCode?: string;
  /** Llave del enlace público donde el cliente ve el código. */
  deliveryKey?: string;
  /** Orden de la parada en la ruta (1 = primera). */
  stopOrder?: number;
  /** La parada se omitió y la ruta se reordenó. */
  skipped?: boolean;
};

export type TraceEvent = {
  id: string;
  type: string;
  productId: string;
  qty: number;
  from: string;
  to: string;
  at: string;
  ref: string;
  by: string;
  batch?: string;
};

export const RECEIPT_REASONS = ['Devolución de cliente', 'Muestra', 'Donación', 'Inventario inicial', 'Armado de paquete'] as const;
export type ReceiptReason = (typeof RECEIPT_REASONS)[number];

export type Receipt = {
  id: string;
  supplier: string;
  date: string;
  productId: string;
  qty: number;
  loc: string;
  batch: string;
  expiry?: string;
  purchaseId?: string;
  /** Motivo cuando se recibe sin orden de compra. */
  reason?: string;
  receivedAt?: string;
  by?: string;
  /** Lote creado por esta recepción. */
  lotId?: string;
  /** Recibido a inspección de calidad. */
  inspection?: 'Pendiente' | 'Liberado' | 'Rechazado';
};

export type PurchaseStatus = 'Abierta' | 'Parcial' | 'Recibida' | 'Cancelada' | 'Cerrada';

export type PurchaseLine = {
  productId: string;
  /** Cantidad pedida en el empaque (`packCode`), no en unidades de stock. */
  qty: number;
  packCode: string;
  unitsPerPack: number;
  unitPrice: number;
  /** Unidades de stock ya ingresadas. */
  receivedUnits?: number;
  batch?: string;
  expiry?: string;
};

export type Purchase = {
  id: string;
  supplierId?: string;
  /** Primera línea, para listados y compatibilidad. */
  productId: string;
  /** Total pedido en unidades de stock. */
  qty: number;
  date: string;
  expectedDate?: string;
  notes?: string;
  /** Unidades de stock ya recibidas. */
  received?: number;
  status?: PurchaseStatus;
  lines?: PurchaseLine[];
  /** Pedidos de cliente que esperan esta compra. */
  orderIds?: string[];
  /** Motivo al cerrar con faltante. */
  closeReason?: string;
};

export type Supplier = {
  id: string;
  name: string;
  taxId: string;
  contact: string;
  email: string;
  phone: string;
  leadTimeDays: number;
  terms: string;
  notes?: string;
};

export type Bundle = {
  id: string;
  name: string;
  description: string;
  lines: OrderLine[];
  /** Precio de venta del paquete. Si falta, se suma el de sus componentes. */
  price?: number;
};

export type Vehicle = {
  id: string;
  plate: string;
  label: string;
  city: string;
  driver: string;
  maxKg: number;
  maxM3: number;
  costPerKm: number;
  active: boolean;
  fuel?: 'gasolina' | 'diesel' | 'gas' | 'electrico';
  /** Kilómetros por galón o por kWh. */
  kmPerUnit?: number;
  /** Precio del galón o del kWh. */
  fuelPrice?: number;
};

export type CustomerQuoteLine = { productId: string; qty: number; unitPrice: number };

export type CustomerQuote = {
  id: string;
  number: string;
  clientId: string;
  date: string;
  validUntil: string;
  status: 'Abierta' | 'Ganada' | 'Perdida';
  channel: SalesChannel;
  lines: CustomerQuoteLine[];
  note?: string;
  orderId?: string;
};

export type Parcel = {
  id: string;
  orderId: string;
  weightKg: number;
  volumeM3: number;
  packedAt: string;
};

export type SupplierOffering = {
  id: string;
  supplierId: string;
  productId: string;
  supplierSku: string;
  unitCost: number;
  minQty: number;
};

export type PlanAction = {
  id: string;
  kind: 'compra' | 'transferencia';
  status: 'sugerida' | 'ejecutada' | 'descartada' | 'deshecha';
  productId: string;
  qty: number;
  supplierId?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  packCode?: string;
  unitPrice?: number;
  reason: string;
  note?: string;
  purchaseId?: string;
  transferId?: string;
};

/** Parámetros operativos editables (costo envío, asignación, crédito). */
export type BusinessRules = {
  /** Km mínimos cobrados / estimados por ruta */
  shippingMinKm: number;
  /** Divisor en km ≈ routeKm × (paradas / max(divisor, paradas)) */
  shippingStopsDivisor: number;
  /** Factor base del ETA: eta ≈ baseEta × (factor + paradas × porParada) */
  shippingEtaBaseFactor: number;
  shippingEtaPerStop: number;
  /** Score asignación: (referencia − costPerKm) × peso */
  assignCostReference: number;
  assignCostWeight: number;
  /** Umbrales de ocupación útil al asignar (0–1) */
  assignIdealFillMax: number;
  assignNearFullFill: number;
  /** % uso de cupo: ok < tight < full */
  creditOkMaxPct: number;
  creditTightMaxPct: number;
  /** Límite sugerido al crear cliente (USD) */
  defaultCreditLimit: number;
  /** Una casilla no mezcla lotes con distinta caducidad. */
  separateExpiryLots: boolean;
};

export type Settings = {
  company: string;
  warehouse: string;
  operator: string;
  activeWarehouseId?: string;
  businessRules?: BusinessRules;
};

export type AppState = {
  version: 1 | 2;
  /** false = empresa real sin datos de demostración. */
  demo?: boolean;
  products: Product[];
  lots: Lot[];
  warehouses: WarehouseSite[];
  clients: Client[];
  orders: Order[];
  events: TraceEvent[];
  purchases: Purchase[];
  receipts: Receipt[];
  settings: Settings;
  /** Familias de bodega para reglas de ubicación */
  families?: WarehouseFamily[];
  vehicles?: Vehicle[];
  bundles?: Bundle[];
  suppliers?: Supplier[];
  invoices?: SalesInvoice[];
  creditNotes?: CreditNote[];
  guides?: DeliveryGuide[];
  customerPayments?: CustomerPayment[];
  supplierBills?: SupplierBill[];
  supplierPayments?: SupplierPayment[];
  priceLists?: PriceList[];
  clientPrices?: ClientPrice[];
  supplierReturns?: SupplierReturn[];
  adjustments?: StockAdjustment[];
  /** Historial de cambios de precio, costo, IVA, cupo y plazo de crédito. */
  auditLog?: AuditEntry[];
  cycleCounts?: CycleCount[];
  transfers?: WarehouseTransfer[];
  quotes?: CustomerQuote[];
  parcels?: Parcel[];
  offerings?: SupplierOffering[];
  planActions?: PlanAction[];
};

export type SalesInvoiceLine = {
  productId: string;
  qty: number;
  unitPrice: number;
  ivaRate: number;
  /** Costo promedio unitario al facturar (para margen). */
  unitCost?: number;
  /** Lote que salió en el picking. */
  batch?: string;
  expiry?: string;
};

export type SalesInvoiceKit = {
  bundleId: string;
  qty: number;
  unitPrice: number;
  ivaRate: number;
};

export type SalesInvoice = {
  id: string;
  number: string;
  accessKey: string;
  orderId: string;
  clientId: string;
  date: string;
  status: 'Emitida' | 'Anulada';
  lines: SalesInvoiceLine[];
  kits?: SalesInvoiceKit[];
  subtotal: number;
  iva: number;
  total: number;
};

export type CreditNoteLine = {
  productId: string;
  qty: number;
  unitPrice: number;
  ivaRate: number;
  batch?: string;
  expiry?: string;
  restock?: boolean;
};

export type CreditNote = {
  id: string;
  number: string;
  accessKey: string;
  invoiceId: string;
  clientId: string;
  date: string;
  reason: string;
  status: 'Emitida' | 'Anulada';
  lines: CreditNoteLine[];
  subtotal: number;
  iva: number;
  total: number;
};

export type DeliveryGuide = {
  id: string;
  number: string;
  accessKey: string;
  date: string;
  kind: 'Venta' | 'Traslado';
  orderId?: string;
  transferId?: string;
  invoiceId?: string;
  origin: string;
  destination: string;
  plate?: string;
  driver?: string;
  lines: Array<{ productId: string; qty: number; batch?: string }>;
  status: 'Emitida' | 'Anulada';
};

export type PayMethod = 'Transferencia' | 'Efectivo' | 'Cheque' | 'Retención';

export type CustomerPayment = {
  id: string;
  clientId: string;
  invoiceId: string;
  date: string;
  amount: number;
  method: PayMethod;
  reference: string;
};

export type SupplierBill = {
  id: string;
  supplierId: string;
  purchaseId: string;
  number: string;
  date: string;
  total: number;
};

export type SupplierPayment = {
  id: string;
  supplierId: string;
  billId: string;
  date: string;
  amount: number;
  method: PayMethod;
  reference: string;
};

export type PriceListItem = { productId: string; price: number; minQty: number };

export type PriceList = {
  id: string;
  name: string;
  clientType: string;
  items: PriceListItem[];
};

export type ClientPrice = { clientId: string; productId: string; price: number };

export type SupplierReturn = {
  id: string;
  supplierId: string;
  purchaseId?: string;
  date: string;
  productId: string;
  lotId: string;
  qty: number;
  batch: string;
  reason: string;
};

export type AdjustmentKind = 'Merma' | 'Daño' | 'Vencimiento' | 'Conteo' | 'Cuarentena';

export type StockAdjustment = {
  id: string;
  date: string;
  kind: AdjustmentKind;
  lotId: string;
  productId: string;
  qty: number;
  direction: 'Salida' | 'Entrada';
  reason: string;
  status: 'Pendiente' | 'Aplicado';
  warehouseId: string;
  requestedBy?: string;
  approvedBy?: string;
};

export type CycleCountLine = {
  lotId: string;
  productId: string;
  loc: string;
  batch: string;
  systemQty: number;
  countedQty: number;
};

export type CycleCount = {
  id: string;
  date: string;
  warehouseId: string;
  status: 'Borrador' | 'Aplicado';
  lines: CycleCountLine[];
};

export type WarehouseTransfer = {
  id: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  date: string;
  status: 'En tránsito' | 'Recibido' | 'Cancelado';
  lines: Array<{
    productId: string;
    qty: number;
    batch: string;
    expiry: string;
    lotId: string;
    purchaseId?: string;
    receiptId?: string;
    receivedAt?: string;
  }>;
};

export type Location = {
  id: string;
  rack: string;
  level: number;
  pos: number;
  capacity: number;
  /** Volumen útil en litros, si la bodega lo define. */
  volumeL?: number;
  category: string;
  face?: LocationFace;
};

export type Rack = {
  id: string;
  name: string;
  category: string;
  x: number;
  y: number;
};

export type AuditEntry = {
  id: string;
  at: string;
  by: string;
  entity: 'Producto' | 'Cliente';
  entityId: string;
  entityName: string;
  field: string;
  from: string;
  to: string;
};
