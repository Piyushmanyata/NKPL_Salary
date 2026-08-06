export type SortDirection = "asc" | "desc";

function compareValues(a: unknown, b: unknown): number {
  const left = a === undefined || a === null ? 0 : a;
  const right = b === undefined || b === null ? 0 : b;
  if (typeof left === "string") return left.localeCompare(String(right));
  return Number(left) - Number(right);
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
