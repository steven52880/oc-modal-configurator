import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  canCopy,
  cellsIn,
  lockedRectangle,
  pasteAssignments,
  rectangle,
  type CellRef,
  type ColumnLock,
  type Rectangle,
} from "../selection/machine";

export interface SpreadsheetOptions {
  containerRef: RefObject<HTMLElement | null>;
  rowIds: string[];
  columnIds: string[];
  getValue: (rowId: string, columnId: string) => string;
  setValue: (rowId: string, columnId: string, value: string) => void;
  onIdleEscape?: () => void;
}

/**
 * DOM contract for each data cell:
 * `data-sheet-cell="true"`, `data-row-id`, `data-col-id`.
 * Clicks on input, button, textarea, select, or label do not start a drag.
 */
export function useSpreadsheetSelection(options: SpreadsheetOptions) {
  const [anchor, setAnchor] = useState<CellRef | null>(null);
  const [focus, setFocus] = useState<CellRef | null>(null);
  const [lock, setLock] = useState<ColumnLock | null>(null);
  const [notice, setNotice] = useState<null | "copy-needs-single-row">(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const dragRef = useRef<CellRef | null>(null);
  const armedRef = useRef(false);
  const stateRef = useRef({ anchor, focus, lock });
  stateRef.current = { anchor, focus, lock };

  const rect = useMemo<Rectangle | null>(() => {
    if (!anchor || !focus) return null;
    if (lock) return lockedRectangle(options.rowIds, anchor, focus, lock);
    return rectangle(options.rowIds, options.columnIds, anchor, focus);
  }, [anchor, focus, lock, options.columnIds, options.rowIds]);

  const selected = useMemo(() => {
    const keys = new Set<string>();
    for (const cell of cellsIn(rect)) keys.add(`${cell.rowId}\u0000${cell.columnId}`);
    return keys;
  }, [rect]);

  const isSelected = useCallback(
    (rowId: string, columnId: string) => selected.has(`${rowId}\u0000${columnId}`),
    [selected],
  );
  const isPasteColumn = useCallback(
    (columnId: string) => Boolean(lock?.columnIds.includes(columnId)),
    [lock],
  );

  const clearLock = useCallback(() => {
    setLock(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    const readCell = (node: Element | null, ignoreControls: boolean): CellRef | null => {
      const root = optionsRef.current.containerRef.current;
      if (!root || !node || !root.contains(node)) return null;
      if (ignoreControls && node.closest("input, button, textarea, select, label")) return null;
      const cell = node.closest("[data-sheet-cell='true']");
      if (!cell || !root.contains(cell)) return null;
      const rowId = cell.getAttribute("data-row-id");
      const columnId = cell.getAttribute("data-col-id");
      if (!rowId || !columnId) return null;
      return { rowId, columnId };
    };

    const onPointerDown = (event: PointerEvent) => {
      const root = optionsRef.current.containerRef.current;
      const inside = event.target instanceof Node && Boolean(root?.contains(event.target));
      armedRef.current = inside;
      if (!inside) {
        dragRef.current = null;
        setAnchor(null);
        setFocus(null);
        return;
      }
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const cell = readCell(event.target, true);
      if (!cell) return;
      event.preventDefault();
      dragRef.current = cell;
      setAnchor(cell);
      setFocus(cell);
      setNotice(null);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragRef.current) return;
      const node = document.elementFromPoint(event.clientX, event.clientY);
      const cell = readCell(node, false);
      if (!cell) return;
      setFocus((current) =>
        current?.rowId === cell.rowId && current.columnId === cell.columnId ? current : cell,
      );
    };

    const onPointerUp = () => {
      dragRef.current = null;
    };

    const typingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!armedRef.current || typingTarget(event.target)) return;
      const current = optionsRef.current;
      const state = stateRef.current;
      const active = state.lock
        ? state.anchor && state.focus
          ? lockedRectangle(current.rowIds, state.anchor, state.focus, state.lock)
          : null
        : state.anchor && state.focus
          ? rectangle(current.rowIds, current.columnIds, state.anchor, state.focus)
          : null;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        if (!canCopy(active) || !active) {
          setNotice("copy-needs-single-row");
          return;
        }
        event.preventDefault();
        const rowId = active.rowIds[0];
        setLock({
          columnIds: [...active.columnIds],
          values: active.columnIds.map((columnId) => current.getValue(rowId, columnId)),
        });
        setNotice(null);
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        if (!state.lock || !active) return;
        event.preventDefault();
        for (const assignment of pasteAssignments(state.lock, active.rowIds)) {
          current.setValue(assignment.rowId, assignment.columnId, assignment.value);
        }
      }

      if (event.key === "Escape") {
        if (state.lock) {
          event.preventDefault();
          setLock(null);
          setNotice(null);
          return;
        }
        current.onIdleEscape?.();
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return {
    rect,
    cells: cellsIn(rect),
    lock,
    notice,
    isSelected,
    isPasteColumn,
    clearLock,
    setNotice,
  };
}
