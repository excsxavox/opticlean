import type { AppState, Product, WarehouseFamily } from './types.js';

export const defaultFamilies = (): WarehouseFamily[] => [
  {
    id: 'FAM-HOG',
    code: 'HOG',
    name: 'Familia Hogar',
    productCategories: ['Hogar'],
    rackIds: ['A', 'B'],
    fragilePreferred: false,
    color: '#7b4fc4',
    notes: 'Productos de limpieza doméstica',
  },
  {
    id: 'FAM-IND',
    code: 'IND',
    name: 'Familia Industrial',
    productCategories: ['Industrial'],
    rackIds: ['C'],
    fragilePreferred: false,
    color: '#2f6eb5',
    notes: 'Desengrasantes y detergentes pesados',
  },
  {
    id: 'FAM-INS',
    code: 'INS',
    name: 'Familia Institucional',
    productCategories: ['Institucional'],
    rackIds: ['D', 'E'],
    fragilePreferred: false,
    color: '#1f8a6e',
    notes: 'Papel, toallas y fundas',
  },
  {
    id: 'FAM-HOS',
    code: 'HOS',
    name: 'Familia Hospitalaria',
    productCategories: ['Hospitalaria'],
    rackIds: ['F'],
    fragilePreferred: true,
    color: '#1a8fa8',
    notes: 'Higiene, desinfectantes y protección · zona preferente frágil',
  },
  {
    id: 'FAM-MP',
    code: 'MP',
    name: 'Familia Insumos',
    productCategories: ['Insumos'],
    rackIds: ['C', 'F'],
    fragilePreferred: true,
    color: '#5f7388',
    notes: 'Materia prima y concentrados',
  },
];

export function familyOf(s: AppState, product: Product): WarehouseFamily | undefined {
  const families = s.families?.length ? s.families : defaultFamilies();
  if (product.familyId) {
    const byId = families.find((f) => f.id === product.familyId);
    if (byId) return byId;
  }
  return families.find((f) => f.productCategories.includes(product.category));
}

export function validateFamily(f: WarehouseFamily) {
  if (!f.id?.trim() || !f.code?.trim() || !f.name?.trim()) {
    throw new Error('Cada familia necesita código, id y nombre.');
  }
  if (!Array.isArray(f.productCategories) || !f.productCategories.length) {
    throw new Error('Asigna al menos una línea de producto a la familia.');
  }
  if (!Array.isArray(f.rackIds) || !f.rackIds.length) {
    throw new Error('Asigna al menos un rack a la familia.');
  }
}

export function upsertFamily(s: AppState, family: WarehouseFamily) {
  validateFamily(family);
  if (!s.families) s.families = defaultFamilies();
  const normalized: WarehouseFamily = {
    ...family,
    id: family.id.trim().toUpperCase(),
    code: family.code.trim().toUpperCase(),
    name: family.name.trim(),
    productCategories: [...new Set(family.productCategories.map((c) => c.trim()).filter(Boolean))],
    rackIds: [...new Set(family.rackIds.map((r) => r.trim().toUpperCase()).filter(Boolean))],
    fragilePreferred: !!family.fragilePreferred,
    color: family.color || '#467fc2',
    notes: family.notes?.trim() || undefined,
  };
  const idx = s.families.findIndex((f) => f.id === normalized.id);
  if (idx >= 0) s.families[idx] = normalized;
  else s.families.push(normalized);
  return normalized;
}

export function deleteFamily(s: AppState, id: string) {
  if (!s.families?.length) return;
  if (s.products.some((p) => p.familyId === id)) {
    throw new Error('Hay productos asignados a esta familia. Cámbialos antes de eliminarla.');
  }
  s.families = s.families.filter((f) => f.id !== id);
}

export function ensureFamilies(s: AppState) {
  if (!Array.isArray(s.families) || !s.families.length) {
    s.families = defaultFamilies();
  }
}
