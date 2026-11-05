import { CircleCheck, Undo2 } from "lucide-react";
import { useState } from "react";
import type { Flag, FlagLevel, FlagReport, FlagSplit, ResolvedEntry, ResolvedFlag } from "../flags";
import type { PreviousMonth, ResolvedState } from "../hooks/useMonthFlags";
import { currency } from "../salary";
import styles from "./FlagsPanel.module.css";

const GROUPS: { level: FlagLevel; label: string; hint: string }[] = [
  { level: "fix", label: "Must fix", hint: "Wrong pay or a broken row" },
  { level: "check", label: "Check", hint: "Unusual against last month or the pay rules" },
  { level: "note", label: "Note", hint: "For your information" },
];

function signed(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${currency(Math.abs(value))}`;
}

const LEVEL_LABEL: Record<FlagLevel, string> = { fix: "Must fix", check: "Check", note: "Note" };

const NOW_LABEL: Record<ResolvedEntry["now"], string> = {
  same: "Same now",
  changed: "Changed since: back in Open",
  gone: "No longer flagged",
};

const WHEN = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : WHEN.format(date);
}

function ChangedSince({ record }: { record: ResolvedFlag | undefined }) {
  if (!record) return null;
  return (
    <span className={styles.meta}>
      Changed since you resolved it on {when(record.resolvedAt)}. It said: {record.detail}
    </span>
  );
}

function ResolvedList({ entries, resolved }: { entries: ResolvedEntry[]; resolved: ResolvedState }) {
  if (!entries.length) {
    return <p className={styles.empty}>Nothing resolved for this month yet. Press Resolve on a flag once you have checked it.</p>;
  }
  return (
    <ul className={styles.list}>
      {entries.map(({ record, now }) => (
        <li key={record.key} className={`${styles.item} ${styles.resolvedItem}`}>
          <div className={styles.itemText}>
            <span className={`${styles.tag} ${styles[record.level]}`}>{LEVEL_LABEL[record.level]}</span>
            <b>{record.name}</b>
            <span className={styles.title}>{record.title}</span>
            <span className={now === "same" ? styles.nowSame : styles.nowOther}>{NOW_LABEL[now]}</span>
            <span className={styles.detail}>{record.detail}</span>
            <span className={styles.meta}>
              Resolved {when(record.resolvedAt)}
              {record.device ? ` · ${record.device}` : ""}
            </span>
          </div>
          <button
            type="button"
            className="ghost-button"
            disabled={resolved.busy}
            onClick={() => resolved.reopen(record.key)}
          >
            <Undo2 size={15} />
            Undo
          </button>
        </li>
      ))}
    </ul>
  );
}

function BlankNameFix({ flag, onRename, onRemove }: { flag: Flag; onRename: (id: string, name: string) => void; onRemove: (id: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form
      className={styles.fixForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && flag.id) onRename(flag.id, name.trim());
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Type the name" aria-label="Name for this row" />
      <button type="submit" className="quiet-button" disabled={!name.trim()}>
        Save name
      </button>
      <button type="button" className="ghost-button" onClick={() => flag.id && onRemove(flag.id)}>
        Remove row
      </button>
    </form>
  );
}

export function FlagsPanel({
  report,
  split,
  previous,
  resolved,
  monthLabel,
  onOpen,
  onRename,
  onRemove,
}: {
  report: FlagReport;
  split: FlagSplit;
  previous: PreviousMonth;
  resolved: ResolvedState;
  monthLabel: string;
  onOpen: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [view, setView] = useState<"open" | "resolved">("open");
  const compared = previous.state === "found" ? previous.label : null;
  return (
    <div className={styles.panel}>
      <div className={styles.summary}>
        {previous.state === "loading" ? (
          <span>Reading last month…</span>
        ) : compared ? (
          <>
            <span>
              <b>{monthLabel}</b> against <b>{compared}</b>
            </span>
            <span>
              Net {currency(report.netBefore ?? 0)} → <b>{currency(report.netAfter)}</b> ({signed(report.netAfter - (report.netBefore ?? 0))})
            </span>
            <span>
              People {report.peopleBefore} → <b>{report.peopleAfter}</b>
            </span>
          </>
        ) : (
          <span>No saved {previous.label ?? "last month"} to compare with. Only this month's own checks are shown.</span>
        )}
      </div>

      <div className={styles.views} role="tablist" aria-label="Open or resolved flags">
        <button
          type="button"
          role="tab"
          aria-selected={view === "open"}
          className={`${styles.viewTab} ${view === "open" ? styles.viewActive : ""}`}
          onClick={() => setView("open")}
        >
          Open <b>{split.open.length}</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "resolved"}
          className={`${styles.viewTab} ${view === "resolved" ? styles.viewActive : ""}`}
          onClick={() => setView("resolved")}
        >
          <CircleCheck size={15} />
          Resolved <b>{resolved.loading ? "…" : split.resolved.length}</b>
        </button>
      </div>

      {resolved.error ? (
        <p className={styles.error} role="alert">
          Could not reach the resolved flags: {resolved.error}. Flags show as open until it works again.
        </p>
      ) : null}

      {view === "resolved" ? (
        <ResolvedList entries={split.resolved} resolved={resolved} />
      ) : report.flags.length === 0 ? (
        <p className={styles.clear}>No flags. This month matches last month and the pay rules.</p>
      ) : split.open.length === 0 ? (
        <p className={styles.clear}>All {report.flags.length} flags are resolved. See them under Resolved.</p>
      ) : (
        GROUPS.map((group) => {
          const flags = split.open.filter((flag) => flag.level === group.level);
          if (!flags.length) return null;
          return (
            <section key={group.level} className={styles.group} aria-label={group.label}>
              <h3 className={styles.groupTitle}>
                <span className={`${styles.tag} ${styles[group.level]}`}>{group.label}</span>
                {flags.length} · <span className={styles.hint}>{group.hint}</span>
              </h3>
              <ul className={styles.list}>
                {flags.map((flag) => (
                  <li key={flag.key} className={`${styles.item} ${styles[`${group.level}Item`]}`}>
                    <div className={styles.itemText}>
                      <b>{flag.name}</b>
                      <span className={styles.title}>{flag.title}</span>
                      <span className={styles.detail}>{flag.detail}</span>
                      <ChangedSince record={split.changedSince.get(flag.key)} />
                    </div>
                    <div className={styles.actions}>
                      {flag.blankName ? (
                        <BlankNameFix flag={flag} onRename={onRename} onRemove={onRemove} />
                      ) : flag.id && !flag.key.includes("|gone:") ? (
                        <button type="button" className="ghost-button" onClick={() => onOpen(flag.name)}>
                          Open
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="quiet-button"
                        disabled={resolved.loading || resolved.busy}
                        onClick={() => resolved.resolve(flag)}
                        title="Checked and fine: move to Resolved"
                      >
                        <CircleCheck size={15} />
                        Resolve
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <section className={styles.group} aria-label="Everyone, last month against this month">
        <h3 className={styles.groupTitle}>Everyone · biggest change first</h3>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Days</th>
                <th>Extra</th>
                <th>Rate</th>
                <th className={styles.num}>Net {compared ?? "last month"}</th>
                <th className={styles.num}>Net now</th>
                <th className={styles.num}>Change</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.key} className={row.flagged ? styles.flaggedRow : undefined}>
                  <td>
                    {row.flagged ? <span className={styles.mark} title="Has a flag">!</span> : null}
                    {row.name}
                    {!row.before && compared ? <span className={styles.badge}>new</span> : null}
                    {!row.after ? <span className={styles.badge}>missing</span> : null}
                  </td>
                  <td>{pair(row.before?.days, row.after?.days)}</td>
                  <td>{pair(row.before?.extra, row.after?.extra)}</td>
                  <td>{pair(row.before?.rate, row.after?.rate)}</td>
                  <td className={styles.num}>{row.before ? currency(row.before.net) : "—"}</td>
                  <td className={styles.num}>{row.after ? currency(row.after.net) : "—"}</td>
                  <td className={`${styles.num} ${row.change < 0 ? styles.down : ""}`}>{compared ? signed(row.change) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function pair(before: number | string | undefined, after: number | string | undefined): string {
  if (before === undefined) return String(after ?? "—");
  if (after === undefined) return `${before} → —`;
  return before === after ? String(after) : `${before} → ${after}`;
}
