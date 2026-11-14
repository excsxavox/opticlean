import { locations } from './warehouse.js';
import type { AppState } from './types.js';
import { DEFAULT_WAREHOUSE_ID } from './warehouse-admin.service.js';
import { DEFAULT_LAYOUT, toDelanteraLocId } from './warehouse-layout.js';
import { defaultFamilies } from './families.service.js';

const QUITO_LAYOUT = { ...DEFAULT_LAYOUT, depthFaces: 2 as const };

/** Pedidos entregados históricos para alimentar la previsión adaptativa. */
function buildDemandHistory(): AppState['orders'] {
  const catalog = [
    ['P001', 10],
    ['P015', 8],
    ['P005', 6],
    ['P018', 7],
    ['P008', 12],
    ['P052', 9],
    ['P032', 5],
    ['P045', 8],
    ['P061', 4],
    ['P025', 6],
  ] as const;
  const clients = ['CL001', 'CL002', 'CL003', 'CL004'] as const;
  const orders: AppState['orders'] = [];
  const anchor = new Date('2026-10-27T12:00:00Z');
  for (let week = 1; week <= 8; week++) {
    for (let i = 0; i < 3; i++) {
      const idx = (week * 3 + i) % catalog.length;
      const [productId, baseQty] = catalog[idx];
      const d = new Date(anchor);
      d.setUTCDate(d.getUTCDate() - week * 7 - i * 2);
      const date = d.toISOString().slice(0, 10);
      const id = `PED-H${week}${i}`;
      orders.push({
        id,
        clientId: clients[(week + i) % clients.length],
        status: 'Entregado',
        date,
        lines: [{ productId, qty: baseQty + ((week + i) % 4) }],
        priority: 'Normal',
        deliveredAt: `${date}T16:${String(10 + i * 7).padStart(2, '0')}:00Z`,
        deliveredTo: 'Recepción cliente',
      });
    }
  }
  return orders;
}

function buildDispatchHistory(): AppState['events'] {
  return buildDemandHistory().map((o, i) => ({
    id: `ev-h-${i}`,
    type: 'Despacho' as const,
    productId: o.lines[0].productId,
    qty: o.lines[0].qty,
    from: 'PICK',
    to: o.id,
    at: o.deliveredAt ?? `${o.date}T16:00:00Z`,
    ref: o.id,
    by: 'Elena R.',
  }));
}

export function seed(): AppState {
  const warehouses: AppState['warehouses'] = [
    {
      id: 'WH-QT-01',
      code: 'BOD-QTO',
      name: 'Bodega principal',
      city: 'Quito',
      address: 'Av. Galo Plaza Lasso, Quito',
      status: 'Operativa',
      racks: QUITO_LAYOUT.rackCount,
      layout: { ...QUITO_LAYOUT },
      notes: 'Layout 3D con doble profundidad (144 posiciones).',
    },
    {
      id: 'WH-GYQ-01',
      code: 'BOD-GYE',
      name: 'Bodega Guayaquil',
      city: 'Guayaquil',
      address: 'Vía a la Costa, Guayaquil',
      status: 'Operativa',
      racks: 4,
      layout: { rackCount: 4, levels: 3, positionsPerLevel: 4, capacityPerCell: 60, depthFaces: 1 },
      notes: 'Sin stock inicial · lista para recepciones.',
    },
    {
      id: 'WH-CUE-01',
      code: 'BOD-CUE',
      name: 'Centro de distribución Cuenca',
      city: 'Cuenca',
      address: 'Parque industrial, Cuenca',
      status: 'Inactiva',
      racks: 2,
      layout: { rackCount: 2, levels: 2, positionsPerLevel: 3, capacityPerCell: 50, depthFaces: 1 },
      notes: 'En acondicionamiento.',
    },
  ];
  // Productos terminados + insumos (materia prima). Los insumos alimentan la reposición a tiempo.
  const finished = (
    [
      ['P001', 'Limpiador multiusos 1 L', 'Hogar', 'Química Andina', 2.5, 30, 1.05, 1.2],
      ['P005', 'Desengrasante industrial 5 L', 'Industrial', 'Química Andina', 12.5, 24, 5.2, 6],
      ['P008', 'Desinfectante 1 L', 'Hospitalaria', 'Higiene Pro', 3.1, 25, 1.05, 1.2],
      ['P012', 'Papel higiénico institucional', 'Institucional', 'Papelera del Ecuador', 18.9, 20, 3, 18],
      ['P015', 'Limpiavidrios 5 L', 'Hogar', 'Química Andina', 6.75, 20, 5.1, 6],
      ['P018', 'Cloro 5 L', 'Industrial', 'Química Andina', 4.75, 25, 5.4, 6],
      ['P025', 'Toallas de papel · paquete', 'Institucional', 'Papelera del Ecuador', 9.8, 18, 1.8, 10],
      ['P032', 'Limpiador de pisos 5 L', 'Hogar', 'Limpieza Total', 8.5, 20, 5.1, 6],
      ['P045', 'Jabón líquido 1 L', 'Hospitalaria', 'Higiene Pro', 4.2, 25, 1.1, 1.2],
      ['P052', 'Guantes de nitrilo · caja', 'Hospitalaria', 'Higiene Pro', 7.5, 12, 0.5, 2],
      ['P061', 'Detergente industrial 5 kg', 'Industrial', 'Limpieza Total', 14.9, 20, 5, 7],
      ['P078', 'Fundas de basura · paquete', 'Institucional', 'EcoSuministros', 3.8, 20, 1, 3],
    ] as const
  ).map(([id, name, category, supplier, price, min, weight, volume]) => ({
    id,
    sku: id,
    name,
    category,
    supplier,
    price,
    min,
    weight,
    volume,
    kind: 'finished' as const,
    fragile: category === 'Hospitalaria',
    components: [] as { productId: string; qty: number }[],
  }));

  const rawMaterials = (
    [
      ['MP-BASE', 'Base concentrada limpieza', 'Insumos', 'Química Andina', 1.2, 80, 1, 1],
      ['MP-FRAG', 'Fragancia cítrica', 'Insumos', 'Aromas del Valle', 0.8, 40, 0.2, 0.3],
      ['MP-CLORO', 'Hipoclorito concentrado', 'Insumos', 'Química Andina', 0.9, 60, 1.1, 1],
      ['MP-TENSIO', 'Tensioactivo industrial', 'Insumos', 'Limpieza Total', 1.5, 35, 0.8, 0.9],
      ['MP-GEL', 'Gel carbómero', 'Insumos', 'Higiene Pro', 1.1, 30, 0.5, 0.6],
      ['MP-NITRILO', 'Lámina nitrilo (insumo)', 'Insumos', 'Higiene Pro', 0.6, 50, 0.1, 0.2],
    ] as const
  ).map(([id, name, category, supplier, price, min, weight, volume]) => ({
    id,
    sku: id,
    name,
    category,
    supplier,
    price,
    min,
    weight,
    volume,
    kind: 'raw' as const,
    fragile: true,
    components: [] as { productId: string; qty: number }[],
  }));

  const bom: Record<string, { productId: string; qty: number }[]> = {
    P001: [{ productId: 'MP-BASE', qty: 1 }, { productId: 'MP-FRAG', qty: 1 }],
    P015: [{ productId: 'MP-BASE', qty: 2 }, { productId: 'MP-FRAG', qty: 1 }],
    P032: [{ productId: 'MP-BASE', qty: 2 }, { productId: 'MP-TENSIO', qty: 1 }],
    P005: [{ productId: 'MP-TENSIO', qty: 2 }, { productId: 'MP-BASE', qty: 1 }],
    P018: [{ productId: 'MP-CLORO', qty: 3 }],
    P008: [{ productId: 'MP-CLORO', qty: 1 }, { productId: 'MP-GEL', qty: 1 }],
    P045: [{ productId: 'MP-GEL', qty: 1 }, { productId: 'MP-FRAG', qty: 1 }],
    P052: [{ productId: 'MP-NITRILO', qty: 2 }],
    P061: [{ productId: 'MP-TENSIO', qty: 2 }, { productId: 'MP-BASE', qty: 1 }],
  };

  const products = [
    ...finished.map((p) => ({ ...p, components: bom[p.id] ?? [] })),
    ...rawMaterials,
  ];

  const lots: AppState['lots'] = [];
  const finishedOnly = products.filter((p) => p.kind !== 'raw');
  for (const [i, loc] of locations.entries()) {
    if (i % 4 === 3 || i % 11 === 0) continue;
    const options = finishedOnly.filter((p) => p.category === loc.category && p.id !== 'P015');
    if (!options.length) continue;
    const p = options[(i + Math.floor(i / 4)) % options.length];
    lots.push({
      id: `lot-${i}`,
      productId: p.id,
      loc: toDelanteraLocId(loc.id),
      qty: 12 + ((i * 7) % 33),
      batch: `LT-26${String(i + 1).padStart(3, '0')}`,
      expiry: `2027-${String(2 + (i % 9)).padStart(2, '0')}-28`,
      warehouseId: DEFAULT_WAREHOUSE_ID,
    });
  }
  lots.push({
    id: 'lot-limpiavidrios',
    productId: 'P015',
    loc: 'A-01-01-D',
    qty: 8,
    batch: 'LT-26018',
    expiry: '2027-02-18',
    warehouseId: DEFAULT_WAREHOUSE_ID,
  });

  // Stock bajo a propósito en algunos insumos para demostrar alertas padre→hijo
  const rawStock: Array<[string, number, string]> = [
    ['MP-BASE', 18, 'F-01-01-D'],
    ['MP-FRAG', 9, 'F-01-02-D'],
    ['MP-CLORO', 22, 'F-01-03-D'],
    ['MP-TENSIO', 12, 'F-02-01-D'],
    ['MP-GEL', 8, 'F-02-02-D'],
    ['MP-NITRILO', 15, 'F-02-03-D'],
  ];
  rawStock.forEach(([productId, qty, loc], i) => {
    lots.push({
      id: `lot-raw-${i}`,
      productId,
      loc,
      qty,
      batch: `MP-26${String(i + 1).padStart(2, '0')}`,
      expiry: '2027-12-31',
      warehouseId: DEFAULT_WAREHOUSE_ID,
    });
  });

  const clients: AppState['clients'] = [
    {
      id: 'CL001',
      name: 'Hotel Alameda',
      contact: 'María Torres',
      address: 'Av. Amazonas N24-03',
      email: 'compras@alameda.example',
      type: 'Hotelería',
      city: 'Quito',
      sector: 'Centro Histórico',
    },
    {
      id: 'CL002',
      name: 'Clínica del Norte',
      contact: 'Andrés Molina',
      address: 'Av. 6 de Diciembre N34-20',
      email: 'compras@clinicanorte.example',
      type: 'Salud',
      city: 'Quito',
      sector: 'La Mariscal',
    },
    {
      id: 'CL003',
      name: 'Corporación Horizonte',
      contact: 'Carolina Ruiz',
      address: 'Calle de los Shyris E9-40',
      email: 'compras@horizonte.example',
      type: 'Corporativo',
      city: 'Quito',
      sector: 'Cumbayá',
    },
    {
      id: 'CL004',
      name: 'Restaurante La Terraza',
      contact: 'Diego Salazar',
      address: 'Calle Madrid E12-45',
      email: 'compras@laterraza.example',
      type: 'Restauración',
      city: 'Quito',
      sector: 'Tumbaco',
    },
    {
      id: 'CL005',
      name: 'Hospital Metropolitano',
      contact: 'Lucía Pérez',
      address: 'Av. Mariana de Jesús Oe7',
      email: 'abastecimiento@hmetro.example',
      type: 'Salud',
      city: 'Quito',
      sector: 'Carcelén',
    },
    {
      id: 'CL006',
      name: 'Universidad Andina',
      contact: 'Pedro Vásquez',
      address: 'Toledo N22-80',
      email: 'compras@uandina.example',
      type: 'Institucional',
      city: 'Quito',
      sector: 'La Floresta',
    },
    {
      id: 'CL007',
      name: 'Hotel Pacífico',
      contact: 'Andrea León',
      address: 'Av. 9 de Octubre 1230',
      email: 'compras@pacifico.example',
      type: 'Hotelería',
      city: 'Guayaquil',
      sector: 'Centro',
    },
    {
      id: 'CL008',
      name: 'Clínica Kennedy',
      contact: 'Marco Rivas',
      address: 'Av. San Jorge y Av. del Periodista',
      email: 'compras@kennedy.example',
      type: 'Salud',
      city: 'Guayaquil',
      sector: 'Urdesa',
    },
    {
      id: 'CL009',
      name: 'Mall del Pacífico',
      contact: 'Sofía Vera',
      address: 'Av. Francisco de Orellana',
      email: 'facility@mallpacifico.example',
      type: 'Retail',
      city: 'Guayaquil',
      sector: 'Norte',
    },
    {
      id: 'CL010',
      name: 'Hotel El Dorado',
      contact: 'Ricardo Peña',
      address: 'Gran Colombia 10-54',
      email: 'compras@eldorado.example',
      type: 'Hotelería',
      city: 'Cuenca',
      sector: 'El Centro',
    },
    {
      id: 'CL011',
      name: 'Universidad del Azuay',
      contact: 'Elena Cabrera',
      address: 'Av. 24 de Mayo 7-77',
      email: 'compras@uazuay.example',
      type: 'Institucional',
      city: 'Cuenca',
      sector: 'Yanuncay',
    },
  ];

  const orders: AppState['orders'] = [
    // Quito · Camión 01 (GBA-2041)
    {
      id: 'PED-001',
      clientId: 'CL001',
      status: 'Preparado',
      date: '2026-10-27',
      lines: [
        { productId: 'P001', qty: 12 },
        { productId: 'P025', qty: 8 },
      ],
      priority: 'Alta',
      picks: [
        { productId: 'P001', qty: 12, batch: 'L-MUL-01', loc: 'A-02-01-D' },
        { productId: 'P025', qty: 8, batch: 'L-TOA-01', loc: 'D-01-02-D' },
      ],
    },
    {
      id: 'PED-002',
      clientId: 'CL002',
      status: 'Preparado',
      date: '2026-10-27',
      lines: [{ productId: 'P008', qty: 10 }],
      priority: 'Normal',
      picks: [{ productId: 'P008', qty: 10, batch: 'L-DES-01', loc: 'B-01-01-D' }],
    },
    {
      id: 'PED-003',
      clientId: 'CL003',
      status: 'En ruta',
      date: '2026-10-27',
      lines: [{ productId: 'P012', qty: 16 }],
      priority: 'Normal',
      vehicle: 'GBA-2041',
    },
    {
      id: 'PED-004',
      clientId: 'CL004',
      status: 'En ruta',
      date: '2026-10-27',
      lines: [
        { productId: 'P005', qty: 4 },
        { productId: 'P018', qty: 6 },
        { productId: 'P032', qty: 5 },
      ],
      priority: 'Normal',
      vehicle: 'GBA-2041',
    },
    {
      id: 'PED-005',
      clientId: 'CL005',
      status: 'Preparado',
      date: '2026-10-27',
      lines: [
        { productId: 'P008', qty: 14 },
        { productId: 'P052', qty: 8 },
      ],
      priority: 'Alta',
      picks: [
        { productId: 'P008', qty: 14, batch: 'L-DES-02', loc: 'B-01-01-D' },
        { productId: 'P052', qty: 8, batch: 'L-GUA-01', loc: 'B-02-01-D' },
      ],
    },
    // Guayaquil · Camión 02 (GYE-1188)
    {
      id: 'PED-006',
      clientId: 'CL007',
      status: 'En ruta',
      date: '2026-10-27',
      lines: [
        { productId: 'P001', qty: 20 },
        { productId: 'P015', qty: 8 },
      ],
      priority: 'Alta',
      vehicle: 'GYE-1188',
    },
    {
      id: 'PED-007',
      clientId: 'CL008',
      status: 'Preparado',
      date: '2026-10-27',
      lines: [
        { productId: 'P045', qty: 18 },
        { productId: 'P052', qty: 12 },
      ],
      priority: 'Normal',
      picks: [
        { productId: 'P045', qty: 18, batch: 'L-JAB-01', loc: 'B-01-02-D' },
        { productId: 'P052', qty: 12, batch: 'L-GUA-02', loc: 'B-02-01-D' },
      ],
    },
    {
      id: 'PED-008',
      clientId: 'CL009',
      status: 'En ruta',
      date: '2026-10-27',
      lines: [
        { productId: 'P061', qty: 10 },
        { productId: 'P078', qty: 15 },
        { productId: 'P018', qty: 8 },
      ],
      priority: 'Normal',
      vehicle: 'GYE-1188',
    },
    // Cuenca · Camión 03 (CUE-3301) — casi lleno
    {
      id: 'PED-009',
      clientId: 'CL010',
      status: 'En ruta',
      date: '2026-10-27',
      lines: [
        { productId: 'P012', qty: 50 },
        { productId: 'P025', qty: 40 },
        { productId: 'P078', qty: 20 },
      ],
      priority: 'Alta',
      vehicle: 'CUE-3301',
    },
    {
      id: 'PED-010',
      clientId: 'CL011',
      status: 'En ruta',
      date: '2026-10-27',
      lines: [
        { productId: 'P005', qty: 30 },
        { productId: 'P061', qty: 25 },
        { productId: 'P018', qty: 20 },
      ],
      priority: 'Normal',
      vehicle: 'CUE-3301',
    },
    // Pendientes sin camión
    {
      id: 'PED-011',
      clientId: 'CL006',
      status: 'Preparado',
      date: '2026-10-27',
      lines: [
        { productId: 'P012', qty: 12 },
        { productId: 'P025', qty: 10 },
      ],
      priority: 'Normal',
      picks: [
        { productId: 'P012', qty: 12, batch: 'L-PAP-01', loc: 'D-01-01-D' },
        { productId: 'P025', qty: 10, batch: 'L-TOA-01', loc: 'D-01-02-D' },
      ],
    },
    {
      id: 'PED-012',
      clientId: 'CL002',
      status: 'Por preparar',
      date: '2026-10-27',
      lines: [
        { productId: 'P008', qty: 8 },
        { productId: 'P045', qty: 6 },
      ],
      priority: 'Normal',
    },
    {
      id: 'PED-000',
      clientId: 'CL001',
      status: 'Entregado',
      date: '2026-10-26',
      lines: [
        { productId: 'P001', qty: 10 },
        { productId: 'P025', qty: 6 },
      ],
      priority: 'Normal',
      deliveredAt: '2026-10-26T18:10:00Z',
      deliveredTo: 'María Torres',
    },
    // Historial para que el modelo de previsión aprenda demanda real
    ...buildDemandHistory(),
  ];

  const events: AppState['events'] = [
    {
      id: 'ev-3',
      type: 'Recepción',
      productId: 'P001',
      qty: 24,
      from: 'Química Andina',
      to: 'A-02-01-D',
      at: '2026-10-27T13:42:00Z',
      ref: 'REC-0083',
      by: 'Elena R.',
    },
    {
      id: 'ev-2',
      type: 'Traslado',
      productId: 'P008',
      qty: 12,
      from: 'F-03-02-D',
      to: 'F-01-01-D',
      at: '2026-10-27T13:18:00Z',
      ref: 'MOV-0032',
      by: 'Elena R.',
    },
    {
      id: 'ev-1',
      type: 'Despacho',
      productId: 'P005',
      qty: 4,
      from: 'C-01-01-D',
      to: 'PED-1045',
      at: '2026-10-27T12:50:00Z',
      ref: 'PED-1045',
      by: 'Elena R.',
    },
    ...buildDispatchHistory(),
  ];

  return {
    version: 2,
    products,
    lots,
    warehouses,
    clients,
    orders,
    events,
    purchases: [],
    families: defaultFamilies(),
    receipts: [
      {
        id: 'REC-0083',
        supplier: 'Química Andina',
        date: '2026-10-27',
        productId: 'P001',
        qty: 24,
        loc: 'A-02-01-D',
        batch: 'LT-26025',
      },
    ],
    settings: {
      company: 'OPTICLEAN AI',
      warehouse: 'Bodega principal · Quito',
      operator: 'Elena R.',
      activeWarehouseId: DEFAULT_WAREHOUSE_ID,
    },
  };
}
