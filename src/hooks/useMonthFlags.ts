import { useCallback, useEffect, useMemo, useState } from "react";
import { getMonthData, type MonthRecord } from "../db";
import { compareMonths, newWarnings, previousMonthLabel, type Flag, type FlagReport } from "../flags";
import { calendarDaysForMonth } from "../months";
import { hydrateSavedMonth } from "../roster";
import type { EmployeeInput } from "../types";

export type PreviousMonth =
  | { state: "loading" }
  | { state: "none"; label: string | null }
  | { state: "found"; label: string };

export type MonthFlags = {
  report: FlagReport;
  previous: PreviousMonth;
  unsavedWarnings: Flag[];
  acceptWarnings: () => void;
};

type Fetched = { scope: string; record: MonthRecord | null };

export function useMonthFlags(
  company: string,
  monthLabel: string,
  monthDays: number,
  employees: EmployeeInput[],
  loading: boolean,
): MonthFlags {
  const previousLabel = previousMonthLabel(monthLabel);
  const previousScope = `${company}|${previousLabel}`;
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [accepted, setAccepted] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!previousLabel) return;
    let cancelled = false;
    void getMonthData(company, previousLabel).then((result) => {
      if (!cancelled) setFetched({ scope: previousScope, record: result.kind === "found" ? result.record : null });
    });
    return () => {
      cancelled = true;
    };
  }, [company, previousLabel, previousScope]);

  const record = fetched?.scope === previousScope ? fetched.record : null;
  const previousReady = !previousLabel || fetched?.scope === previousScope;

  const previousSide = useMemo(
    () =>
      record && previousLabel
        ? {
            label: previousLabel,
            days: calendarDaysForMonth(previousLabel),
            employees: hydrateSavedMonth(record.employees, calendarDaysForMonth(previousLabel), {}),
          }
        : null,
    [previousLabel, record],
  );

  const report = useMemo(
    () => compareMonths({ label: monthLabel, days: monthDays, employees }, previousSide),
    [employees, monthDays, monthLabel, previousSide],
  );

  useEffect(() => {
    setAccepted(null);
  }, [company, monthLabel]);

  useEffect(() => {
    if (loading) {
      setAccepted(null);
    } else if (previousReady && accepted === null) {
      setAccepted(new Set(report.flags.map((flag) => flag.key)));
    }
  }, [accepted, loading, previousReady, report]);

  const unsavedWarnings = useMemo(() => newWarnings(report.flags, accepted), [accepted, report]);

  const acceptWarnings = useCallback(() => {
    setAccepted((current) => new Set([...(current ?? []), ...unsavedWarnings.map((flag) => flag.key)]));
  }, [unsavedWarnings]);

  const previous: PreviousMonth = !previousReady
    ? { state: "loading" }
    : record && previousLabel
      ? { state: "found", label: previousLabel }
      : { state: "none", label: previousLabel };

  return { report, previous, unsavedWarnings, acceptWarnings };
}
