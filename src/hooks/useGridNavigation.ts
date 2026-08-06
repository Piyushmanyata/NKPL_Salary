import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback } from "react";

// Spreadsheet-style column movement. Typing a month means walking one column
// down 51 rows, which with native tab order costs eight keystrokes per
// employee; here it costs one. Cells opt in with data-cell, so the read-only
// currency columns and the open settings panel are skipped for free.
//
// Horizontal movement is deliberately left to Tab: arrow left/right has to
// keep moving the caret inside a text field, and stealing it would break
// ordinary editing to save a keystroke that Tab already provides.
export function useGridNavigation(tableWrapRef: RefObject<HTMLDivElement | null>) {
  const handleGridKey = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const { key } = event;
      if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Enter") {
        return;
      }

      const target = event.target as HTMLElement;
      const cell = target.dataset?.cell;
      if (!cell || !tableWrapRef.current) {
        return;
      }

      // Arrow keys on a number input otherwise increment the value — on a Days
      // Worked field that is a silent data change, so it is always suppressed.
      event.preventDefault();

      const peers = Array.from(
        tableWrapRef.current.querySelectorAll<HTMLElement>(`[data-cell="${cell}"]`),
      );
      const index = peers.indexOf(target);
      const next = peers[index + (key === "ArrowUp" ? -1 : 1)];
      if (index < 0 || !next) {
        return;
      }

      next.focus();
      if (next instanceof HTMLInputElement) {
        next.select();
      }
    },
    [tableWrapRef],
  );

  return { handleGridKey };
}
