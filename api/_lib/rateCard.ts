/** Per employee id, the fields to set on that employee's Rate Card entry; `null` removes a field. */
export type RateCardPatch = Record<string, Record<string, unknown>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isRateCardPatch = (value: unknown): value is RateCardPatch =>
  isRecord(value) && Object.values(value).every(isRecord);

export function rateCardPatch(
  before: Record<string, object>,
  after: Record<string, object>,
): RateCardPatch {
  const patch: RateCardPatch = {};
  for (const [id, entry] of Object.entries(after)) {
    const previous = new Map(Object.entries(before[id] ?? {}));
    const fields = Object.fromEntries([
      ...Object.entries(entry).filter(
        ([key, value]) => JSON.stringify(previous.get(key)) !== JSON.stringify(value),
      ),
      ...[...previous.keys()].filter((key) => !(key in entry)).map((key) => [key, null]),
    ]);
    if (Object.keys(fields).length) patch[id] = fields;
  }
  return patch;
}

export function applyRateCardPatch<T extends object>(
  card: Record<string, T>,
  patch: RateCardPatch,
): Record<string, T> {
  const entries = Object.entries(patch).map(([id, fields]) => [
    id,
    Object.fromEntries(
      Object.entries({ ...card[id], ...fields }).filter(([, value]) => value !== null),
    ),
  ]);
  return { ...card, ...Object.fromEntries(entries) };
}
