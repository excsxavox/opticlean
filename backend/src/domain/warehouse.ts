import type { Location, Rack } from './types.js';

export const categories = ['Hogar', 'Industrial', 'Institucional', 'Hospitalaria'] as const;

export const racks: Rack[] = [
  { id: 'A', name: 'Limpieza y hogar', category: 'Hogar', x: 1, y: 1 },
  { id: 'B', name: 'Cuidado del hogar', category: 'Hogar', x: 1, y: 3.4 },
  { id: 'C', name: 'Limpieza industrial', category: 'Industrial', x: 1, y: 5.8 },
  { id: 'D', name: 'Papel e institucional', category: 'Institucional', x: 6, y: 1 },
  { id: 'E', name: 'Institucional', category: 'Institucional', x: 6, y: 3.4 },
  { id: 'F', name: 'Higiene y protección', category: 'Hospitalaria', x: 6, y: 5.8 },
];

export const locations: Location[] = racks.flatMap((r) =>
  [1, 2, 3].flatMap((level) =>
    [1, 2, 3, 4].map((pos) => ({
      id: `${r.id}-${String(level).padStart(2, '0')}-${String(pos).padStart(2, '0')}`,
      rack: r.id,
      level,
      pos,
      capacity: 60,
      category: r.category,
    })),
  ),
);
