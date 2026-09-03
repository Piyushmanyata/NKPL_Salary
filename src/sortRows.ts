export type SortDirection = "asc" | "desc";

function compareValues(a: unknown, b: unknown): number {
  const left = a === undefined || a === null ? 0 : a;
  const right = b === undefined || b === null ? 0 : b;
  // Either side being a string forces a string comparison; comparing a string
  // numerically yields NaN, which makes the comparator non-total and leaves
  // the sort order undefined.
  if (typeof left === "string" || typeof right === "string") {
    return String(left).localeCompare(String(right));
  }
  const difference = Number(left) - Number(right);
  return Number.isNaN(difference) ? 0 : difference;
}

export function sortRows<T extends { id: string }>(
  rows: readonly T[],
  field: keyof T,
  direction: SortDirection,
  newlyAddedId: string | null,
): T[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (a.id === newlyAddedId) return -1;
    if (b.id === newlyAddedId) return 1;
    const result = compareValues(a[field], b[field]);
    return direction === "asc" ? result : -result;
  });
  return sorted;
}
