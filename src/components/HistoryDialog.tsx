import { History, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getMonthHistory, type EmployeeRateMap, type MonthRecord } from "../db";
import { formatSavedAt } from "../hooks/useMonthLifecycle";
import { describeChanges } from "../monthDiff";
import { buildMonthSheets } from "../monthSheets";
import { calendarDaysForMonth } from "../months";
import { hydrateSavedMonth } from "../roster";
import { currency } from "../salary";
import { calculateMonthTotals } from "../totals";
import styles from "./HistoryDialog.module.css";

const SHOWN_CHANGES = 6;

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; records: MonthRecord[] };

function netOf(record: MonthRecord, rates: EmployeeRateMap): number {
  const days = calendarDaysForMonth(record.monthLabel);
  const { salaryRows, officialRows } = buildMonthSheets(
    hydrateSavedMonth(record.employees, days, rates),
    days,
    record.monthLabel,
  );
  return calculateMonthTotals("reference", salaryRows, officialRows).net;
}

export function HistoryDialog({
  company,
  monthLabel,
  rates,
  onRestore,
  onClose,
}: {
  company: string;
  monthLabel: string;
  rates: EmployeeRateMap;
  onRestore: (record: MonthRecord) => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [confirming, setConfirming] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMonthHistory(company, monthLabel).then((history) => {
      if (cancelled) return;
      setLoaded(history.ok ? { kind: "ready", records: history.records } : { kind: "error", error: history.error });
    });
    return () => {
      cancelled = true;
    };
  }, [company, monthLabel]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${styles.historyModal}`} onClick={(event) => event.stopPropagation()}>
        <div className={styles.head}>
          <div>
            <span className="modal-eyebrow">
              {company} · {monthLabel}
            </span>
            <h2>Saved versions</h2>
            <p className={styles.hint}>
              Every save keeps the copy it replaced (last 40). Restore puts an old copy back; the current
              one stays here, so a restore can be undone too.
            </p>
          </div>
          <button className="close-modal" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {loaded.kind === "loading" && <p className={styles.hint}>Loading…</p>}
        {loaded.kind === "error" && <p className={styles.error}>Could not read history: {loaded.error}</p>}
        {loaded.kind === "ready" && loaded.records.length === 0 && (
          <p className={styles.hint}>Nothing saved for this month yet.</p>
        )}
        {loaded.kind === "ready" && loaded.records.length > 0 && (
          <ol className={styles.list}>
            {loaded.records.map((record, index) => {
              const older = loaded.records[index + 1];
              const changes = older ? describeChanges(older.employees, record.employees) : [];
              const isCurrent = index === 0;
              return (
                <li key={`${record.version}-${record.updatedAt}`} className={isCurrent ? styles.current : undefined}>
                  <div className={styles.row}>
                    <div className={styles.when}>
                      <strong>{formatSavedAt(record.updatedAt)}</strong>
                      {isCurrent && <span className={styles.badge}>Now</span>}
                      <span className={styles.meta}>{record.device ?? "Device not recorded"}</span>
                    </div>
                    <div className={styles.figures}>
                      <span>{record.employees.length} people</span>
                      <strong>{currency(netOf(record, rates))}</strong>
                    </div>
                    {!isCurrent && (
                      <button
                        type="button"
                        className={confirming === index ? "primary-button" : "quiet-button"}
                        onClick={() => (confirming === index ? onRestore(record) : setConfirming(index))}
                      >
                        <RotateCcw size={15} />
                        {confirming === index ? "Tap again to restore" : "Restore"}
                      </button>
                    )}
                  </div>
                  {older ? (
                    <ul className={styles.changes}>
                      {changes.length === 0 && <li>No change in the data</li>}
                      {changes.slice(0, SHOWN_CHANGES).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                      {changes.length > SHOWN_CHANGES && (
                        <li>
                          <details>
                            <summary>{changes.length - SHOWN_CHANGES} more</summary>
                            <ul>
                              {changes.slice(SHOWN_CHANGES).map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </details>
                        </li>
                      )}
                    </ul>
                  ) : (
                    <p className={styles.meta}>
                      <History size={13} aria-hidden="true" /> Oldest kept copy
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
