import type { VisualFloor, VisualLayout } from './types';

export function fitPlan(layout: VisualFloor, opts?: { pad?: number; top?: number }): { s: number; ox: number; oy: number; bb: { x: number; y: number; w: number; d: number } };
export function plan2D(layout: VisualFloor, o?: Record<string, unknown>): string;
export function iso3D(root: VisualLayout, o?: Record<string, unknown>): string;
export function frontView(layout: VisualLayout, rackId: string, o?: Record<string, unknown>): string;
