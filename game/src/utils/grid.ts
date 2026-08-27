// Shared world-position <-> grid-cell conversions used by the building/placement
// system and by zone lookups.
export const GRID_CELL_SIZE = 1;

export interface Cell {
  x: number;
  z: number;
}

export function worldToCell(x: number, z: number): Cell {
  return {
    x: Math.round(x / GRID_CELL_SIZE),
    z: Math.round(z / GRID_CELL_SIZE),
  };
}

export function cellToWorld(cell: Cell): { x: number; z: number } {
  return { x: cell.x * GRID_CELL_SIZE, z: cell.z * GRID_CELL_SIZE };
}

export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.z}`;
}
