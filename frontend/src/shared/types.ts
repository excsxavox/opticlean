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

export type ProductPack = { code: string; label: string; units: number };

export type Product = {
  barcode?: string;
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
  familyId?: string;
  fragile?: boolean;
  hazardClass?: HazardClass;
  stockUnit?: string;
  packs?: ProductPack[];
  minShelfLifeDays?: number;
  /** false = no caduca (papel, fundas). Si falta, el lote necesita fecha. */
  perishable?: boolean;
  /** Exige notificación ARCSA vigente para vender. */
  requiresSanitary?: boolean;
  supplierId?: string;
  avgCost?: number;
  sanitaryRegistration?: string;
  sanitaryExpires?: string;
  /** Tarifa de IVA (0 o 0.15). Vacío = tarifa general. */
  ivaRate?: number;
  /** Recibir siempre a inspección de calidad. */
  inspectOnReceipt?: boolean;
  attributes?: ProductAttribute[];
  presentations?: string[];
};

export type ProductAttribute = { name: string; value: string };
export type SalesChannel = 'portal' | 'ejecutivo' | 'reposicion';

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
  purchaseId?: string;
  receiptId?: string;
  /** Fecha/hora de ingreso a bodega. Desempata el FEFO cuando dos lotes vencen igual. */
  receivedAt?: string;
  /** Retenido en inspección de calidad. */
  onHold?: boolean;
};

export type LocationFace = 'D' | 'T';

export type RackPosition = { rackId: string; column: number; row: number };

export type WarehouseLayout = {
  rackCount: number;
  levels: number;
  positionsPerLevel: number;
  capacityPerCell: number;
  depthFaces: 1 | 2;
  /** Litros útiles por casilla (vacío = sin límite por volumen). */
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
  province?: string;
  city?: string;
  sector?: string;
  neighborhood?: string;
  /** Límite de crédito autorizado (USD) */
  creditLimit?: number;
  paymentTermsDays?: number;
  /**
   * Margen % sobre costo para cotizar a este cliente.
   * Si está definido, la cotización prioriza costo×(1+margen%) frente al PVP del producto.
   */
  marginPct?: number;
  /** RUC del cliente, 13 dígitos. Hace falta para facturar. */
  taxId?: string;
  phone?: string;
  reorderEveryDays?: number;
  lat?: number;
  lng?: number;
};

export type OrderLine = { productId: string; qty: number; unitPrice?: number };
export type OrderKit = { bundleId: string; qty: number };
export type OrderPick = OrderLine & { batch?: string; loc?: string; expiry?: string; purchaseId?: string };
export type OrderShortage = { productId: string; qty: number };

export type Order = {
  /** Unidades contadas al empacar, por `producto|lote`. */
  packCounts?: Record<string, number>;
  /** Empaque cerrado: todas las unidades están en bultos pesados. */
  packing?: { closedAt: string; closedBy?: string };
  loadNote?: string;
  id: string;
  clientId: string;
  status: string;
  date: string;
  lines: OrderLine[];
  kits?: OrderKit[];
  priority: string;
  vehicle?: string;
  stagedPlate?: string;
  picks?: OrderPick[];
  incident?: string;
  notes?: string;
  deliveredTo?: string;
  deliveryNotes?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  assignedToUserId?: string;
  assignedToName?: string;
  assignedAt?: string;
  shortages?: OrderShortage[];
  purchaseIds?: string[];
  createdBy?: string;
  channel?: SalesChannel;
  quoteId?: string;
  deliveryCode?: string;
  deliveryKey?: string;
  stopOrder?: number;
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

export const RECEIPT_REASONS = ['Devolución de cliente', 'Muestra', 'Donación', 'Inventario inicial'] as const;

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
  reason?: string;
  receivedAt?: string;
  by?: string;
  lotId?: string;
  inspection?: 'Pendiente' | 'Liberado' | 'Rechazado';
};

export type PurchaseStatus = 'Abierta' | 'Parcial' | 'Recibida' | 'Cancelada' | 'Cerrada';

export type PurchaseLine = {
  productId: string;
  qty: number;
  packCode: string;
  unitsPerPack: number;
  unitPrice: number;
  receivedUnits?: number;
  batch?: string;
  expiry?: string;
};

export type Purchase = {
  id: string;
  supplierId?: string;
  productId: string;
  qty: number;
  date: string;
  expectedDate?: string;
  notes?: string;
  received?: number;
  status?: PurchaseStatus;
  lines?: PurchaseLine[];
  orderIds?: string[];
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
  kmPerUnit?: number;
  fuelPrice?: number;
};

export type CustomerQuote = {
  id: string;
  number: string;
  clientId: string;
  date: string;
  validUntil: string;
  status: 'Abierta' | 'Ganada' | 'Perdida';
  channel: SalesChannel;
  lines: Array<{ productId: string; qty: number; unitPrice: number }>;
  /** Descuento en USD sobre el subtotal (sin IVA). */
  discount?: number;
  note?: string;
  orderId?: string;
};

export type ParcelContent = { productId: string; batch: string; qty: number };

export type ParcelDims = { l: number; w: number; h: number };

export type Parcel = {
  id: string;
  orderId: string;
  weightKg: number;
  volumeM3: number;
  packedAt: string;
  contents?: ParcelContent[];
  boxCode?: string;
  dims?: ParcelDims;
  packedBy?: string;
  weightNote?: string;
  tareKg?: number;
};

export type PackingBox = { code: string; label: string; dims: ParcelDims; tareKg: number };

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

export type BusinessRules = {
  shippingMinKm: number;
  shippingStopsDivisor: number;
  shippingEtaBaseFactor: number;
  shippingEtaPerStop: number;
  assignCostReference: number;
  assignCostWeight: number;
  assignIdealFillMax: number;
  assignNearFullFill: number;
  creditOkMaxPct: number;
  creditTightMaxPct: number;
  defaultCreditLimit: number;
  separateExpiryLots: boolean;
  packTolerancePct: number;
  loadMinFillPct: number;
  requirePackingBeforeDispatch: boolean;
};

/** Plantilla reutilizable de estimación de km / ETA / costo de envío. */
export type ShippingCostTemplate = {
  id: string;
  name: string;
  shippingMinKm: number;
  shippingStopsDivisor: number;
  shippingEtaBaseFactor: number;
  shippingEtaPerStop: number;
};

export type Settings = {
  packingBoxes?: PackingBox[];
  company: string;
  warehouse: string;
  operator: string;
  activeWarehouseId?: string;
  businessRules?: BusinessRules;
  /** Plantillas de costo de envío aplicables a la flota. */
  shippingTemplates?: ShippingCostTemplate[];
  /** Plantilla por defecto cuando el vehículo no tiene una asignada. */
  defaultShippingTemplateId?: string;
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
  auditLog?: AuditEntry[];
  cycleCounts?: CycleCount[];
  transfers?: WarehouseTransfer[];
  quotes?: CustomerQuote[];
  parcels?: Parcel[];
  offerings?: SupplierOffering[];
  planActions?: PlanAction[];
};

export type SalesInvoice = {
  id: string;
  number: string;
  accessKey: string;
  orderId: string;
  clientId: string;
  date: string;
  status: 'Emitida' | 'Anulada';
  lines: Array<{ productId: string; qty: number; unitPrice: number; ivaRate: number; unitCost?: number; batch?: string; expiry?: string }>;
  kits?: Array<{ bundleId: string; qty: number; unitPrice: number; ivaRate: number }>;
  subtotal: number;
  iva: number;
  total: number;
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
  lines: Array<{ productId: string; qty: number; unitPrice: number; ivaRate: number; batch?: string; expiry?: string; restock?: boolean }>;
  subtotal: number;
  iva: number;
  total: number;
};

export type DeliveryGuide = {
  packages?: { count: number; weightKg: number; parcelIds: string[] };
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

export type CustomerPayment = {
  id: string;
  clientId: string;
  invoiceId: string;
  date: string;
  amount: number;
  method: string;
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
  method: string;
  reference: string;
};

export type PriceList = {
  id: string;
  name: string;
  clientType: string;
  items: Array<{ productId: string; price: number; minQty: number }>;
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

export type StockAdjustment = {
  id: string;
  date: string;
  kind: string;
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

export type CycleCount = {
  id: string;
  date: string;
  warehouseId: string;
  status: 'Borrador' | 'Aplicado';
  lines: Array<{ lotId: string; productId: string; loc: string; batch: string; systemQty: number; countedQty: number }>;
};

export type WarehouseTransfer = {
  id: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  date: string;
  status: 'En tránsito' | 'Recibido' | 'Cancelado';
  lines: Array<{ productId: string; qty: number; batch: string; expiry: string; lotId: string }>;
};

export type Location = {
  id: string;
  rack: string;
  level: number;
  pos: number;
  capacity: number;
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

export type Bundle = {
  id: string;
  name: string;
  description: string;
  lines: OrderLine[];
  price?: number;
};

export type Metrics = {
  occupied: number;
  occupancyPct: number;
  stockValue: number;
  lowCount: number;
  pendingOrders: number;
  /** Valor del stock a precio de venta (referencia). */
  saleValue?: number;
  /** Productos con stock y sin costo registrado. */
  missingCost?: number;
  unsellableUnits?: number;
  waitingOrders?: number;
};

export type Meta = {
  categories: string[];
  racks: Rack[];
  locations: Location[];
  layout: WarehouseLayout;
  bundles: Bundle[];
};
