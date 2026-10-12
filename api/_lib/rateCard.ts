type Fields = Record<string, unknown>;

/** Per employee id, their whole new entry and the fields that changed; a card that lacks the id takes the whole entry. */
export type RateCardPatch = Record<string, { entry: Fields; changed: string[] }>;

export const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isRateCardPatch = (value: unknown): value is RateCardPatch =>
  isRecord(value) &&
  Object.values(value).every(
    (change) =>
      isRecord(change) &&
      isRecord(change.entry) &&
      Array.isArray(change.changed) &&
      change.changed.every((key) => typeof key === "string"),
  );

export function rateCardPatch(
  before: Record<string, object>,
  after: Record<string, object>,
): RateCardPatch {
  const patch: RateCardPatch = {};
  for (const [id, entry] of Object.entries(after)) {
    const previous = new Map(Object.entries(before[id] ?? {}));
    const next = new Map(Object.entries(entry));
    const changed = [...new Set([...previous.keys(), ...next.keys()])].filter(
      (key) => JSON.stringify(previous.get(key)) !== JSON.stringify(next.get(key)),
    );
    if (changed.length) patch[id] = { entry: Object.fromEntries(next), changed };
  }
  return patch;
}

export function applyRateCardPatch<T extends object>(
  card: Record<string, T>,
  patch: RateCardPatch,
): Record<string, T> {
  const entries = Object.entries(patch).map(([id, { entry, changed }]) => {
    if (!Object.prototype.hasOwnProperty.call(card, id)) return [id, entry];
    const kept = Object.entries(card[id]).filter(([key]) => !changed.includes(key));
    const updated = Object.entries(entry).filter(([key]) => changed.includes(key));
    return [id, Object.fromEntries([...kept, ...updated])];
  });
  return { ...card, ...Object.fromEntries(entries) };
}
