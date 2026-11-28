export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  supplier: string;
  price: number;
  min: number;
  weight?: number;
  volume?: number;
  fragile?: boolean;
  familyId?: string;
  kind?: 'finished' | 'raw';
};

export type Lot = {
  id: string;
  productId: string;
  loc: string;
  qty: number;
  batch: string;
  expiry: string;
  warehouseId?: string;
  receivedAt?: string;
};

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

export type Client = {
  id: string;
  name: string;
  contact: string;
  address: string;
  email: string;
  type: string;
  city?: string;
  sector?: string;
  creditLimit?: number;
};

export type OrderLine = { productId: string; qty: number };

export type Order = {
  id: string;
  clientId: string;
  status: string;
  date: string;
  lines: OrderLine[];
  priority: string;
  vehicle?: string;
  stagedPlate?: string;
  stopOrder?: number;
  loadNote?: string;
  packing?: { closedAt: string; closedBy?: string };
  packCounts?: Record<string, number>;
  picks?: Array<{ productId: string; qty: number; batch?: string; loc?: string }>;
  deliveredTo?: string;
  deliveredAt?: string;
  assignedToUserId?: string;
  assignedToName?: string;
  assignedAt?: string;
};

export type Parcel = {
  id: string;
  orderId: string;
  weightKg: number;
  volumeM3: number;
  contents?: Array<{ productId: string; batch: string; qty: number }>;
  weightNote?: string;
};

export type Receipt = {
  id: string;
  supplier: string;
  date: string;
  productId: string;
  qty: number;
  loc: string;
  batch: string;
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

export type Purchase = {
  id: string;
  productId: string;
  qty: number;
  date: string;
  received?: number;
  status?: 'Abierta' | 'Parcial' | 'Recibida' | 'Cancelada';
};

export type AppState = {
  products: Product[];
  lots: Lot[];
  clients: Client[];
  orders: Order[];
  purchases?: Purchase[];
  receipts: Receipt[];
  events: TraceEvent[];
  families?: WarehouseFamily[];
  parcels?: Parcel[];
  vehicles?: Array<{
    id: string;
    plate: string;
    label: string;
    city: string;
    driver: string;
    maxKg: number;
    maxM3: number;
    costPerKm: number;
    active: boolean;
  }>;
  settings: {
    company: string;
    warehouse: string;
    operator: string;
    activeWarehouseId?: string;
    packingBoxes?: Array<{ code: string; label: string; dims: { l: number; w: number; h: number }; tareKg: number }>;
  };
};

export type PlacementOption = {
  id: string;
  rack: string;
  level: number;
  pos: number;
  capacity: number;
  category: string;
  face?: string;
  score: number;
  free: number;
  reasons: string[];
  familyMatch: boolean;
  fragileSafe: boolean;
  isEmpty: boolean;
  consolidates: boolean;
};

export type PlacementResponse = {
  productId: string;
  qty: number;
  best: PlacementOption | null;
  options: PlacementOption[];
  guidance: string;
  product: { id: string; name: string; category: string; fragile: boolean; familyId?: string } | null;
};

export type PickStep = {
  id?: string;
  productId: string;
  qty: number;
  loc?: string;
  batch?: string;
  expiry?: string;
  receivedAt?: string;
};
