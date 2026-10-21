export interface CellRef {
  rowId: string;
  columnId: string;
}

export interface ColumnLock {
  columnIds: string[];
  values: string[];
}

export interface Rectangle {
  rowIds: string[];
  columnIds: string[];
}

export function rectangle(
  rowIds: string[],
  columnIds: string[],
  anchor: CellRef,
  focus: CellRef,
): Rectangle | null {
  const startRow = rowIds.indexOf(anchor.rowId);
  const endRow = rowIds.indexOf(focus.rowId);
  const startColumn = columnIds.indexOf(anchor.columnId);
  const endColumn = columnIds.indexOf(focus.columnId);
  if (startRow < 0 || endRow < 0 || startColumn < 0 || endColumn < 0) return null;
  return {
    rowIds: rowIds.slice(Math.min(startRow, endRow), Math.max(startRow, endRow) + 1),
    columnIds: columnIds.slice(Math.min(startColumn, endColumn), Math.max(startColumn, endColumn) + 1),
  };
}

export function lockedRectangle(
  rowIds: string[],
  anchor: CellRef,
  focus: CellRef,
  lock: ColumnLock,
): Rectangle | null {
  const startRow = rowIds.indexOf(anchor.rowId);
  const endRow = rowIds.indexOf(focus.rowId);
  if (startRow < 0 || endRow < 0) return null;
  return {
    rowIds: rowIds.slice(Math.min(startRow, endRow), Math.max(startRow, endRow) + 1),
    columnIds: [...lock.columnIds],
  };
}

export function canCopy(rect: Rectangle | null): boolean {
  return Boolean(rect && rect.rowIds.length === 1 && rect.columnIds.length > 0);
}

export function pasteAssignments(
  lock: ColumnLock,
  rowIds: string[],
): Array<{ rowId: string; columnId: string; value: string }> {
  const assignments: Array<{ rowId: string; columnId: string; value: string }> = [];
  for (const rowId of rowIds) {
    lock.columnIds.forEach((columnId, index) => {
      assignments.push({ rowId, columnId, value: lock.values[index] ?? "" });
    });
  }
  return assignments;
}

export function cellsIn(rect: Rectangle | null): CellRef[] {
  if (!rect) return [];
  const cells: CellRef[] = [];
  for (const rowId of rect.rowIds) {
    for (const columnId of rect.columnIds) cells.push({ rowId, columnId });
  }
  return cells;
}
