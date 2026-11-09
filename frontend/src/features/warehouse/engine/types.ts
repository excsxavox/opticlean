export type VisualLayout = {
  version: number;
  seq: number;
  floors: VisualFloor[];
};

export type VisualFloor = {
  id: string;
  name: string;
  kind: string;
  elevation: number;
  height: number;
  outline: Array<{ x: number; y: number; r?: number }>;
  racks: VisualRack[];
  sections: VisualSection[];
  docks?: Array<{ id: string; x: number; y: number; w: number; d: number; label: string }>;
  connectors?: Array<{ kind: string; x: number; y: number; w: number; d: number; to: string }>;
};

export type VisualRack = {
  id: string;
  name: string;
  category: string;
  x: number;
  y: number;
  rot: 0 | 90;
  cols: number;
  levels: number;
  capacity: number;
  levelHeight?: number;
};

export type VisualSection = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type VisualLocation = {
  id: string;
  rack: string;
  level: number;
  pos: number;
  floor: string;
  capacity: number;
  category: string;
};

export type MapMode = 'plan' | '3d' | 'front';
export type MapLayer = 'occ' | 'exp' | 'pick';
