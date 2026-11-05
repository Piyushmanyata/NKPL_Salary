import { UserPlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { buildMonthSheets } from "../monthSheets";
import {
  emptyNewEmployeeForm,
  employeeFromForm,
  esiChecked,
  esiDefaultOn,
  newEmployeeErrors,
  salaryModeFor,
  withEsiChoice,
  type NewEmployeeForm,
} from "../newEmployee";
import { currency, ESI_GROSS_LIMIT, isSpecialCategory, PF_BASIC_LIMIT } from "../salary";
import type { Category, EmployeeInput } from "../types";
import { NumberInput } from "./NumberInput";
import styles from "./NewEmployeeDialog.module.css";

const CATEGORY_HINTS: Record<Category, string> = {
  Unskilled: "Paid per day",
  "Semi-skilled": "Paid per month",
  Skilled: "Paid per month",
  Special: "Fixed pay, no PF/ESI",
};

export function NewEmployeeDialog({
  company,
  monthLabel,
  monthDays,
  existingNames,
  onAdd,
  onClose,
}: {
  company: string;
  monthLabel: string;
  monthDays: number;
  existingNames: string[];
  onAdd: (employee: EmployeeInput) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<NewEmployeeForm>(() => emptyNewEmployeeForm(monthDays));
  const [tried, setTried] = useState(false);
  const set = <K extends keyof NewEmployeeForm>(key: K, value: NewEmployeeForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const special = isSpecialCategory(form.category);
  const perDay = salaryModeFor(form.category) === "perDay";
  const errors = newEmployeeErrors(form, monthDays, existingNames);
  const blocking = Boolean(errors.name || errors.salary || errors.daysWorked);
  const preview = buildMonthSheets(
    [employeeFromForm({ ...form, name: form.name.trim() || "New" }, monthDays)],
    monthDays,
    monthLabel,
  ).salaryRows[0];
  const esiDefault = esiDefaultOn(form, monthDays);
  const esiOn = esiChecked(form, monthDays);
  const pfBlocked = Boolean(preview && preview.monthlySalary * (preview.basicPercent / 100) > PF_BASIC_LIMIT);
  const touched = JSON.stringify(form) !== JSON.stringify(emptyNewEmployeeForm(monthDays));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (blocking) return;
    onAdd(employeeFromForm(form, monthDays));
  };

  const showError = (key: keyof typeof errors) =>
    tried && errors[key] ? (
      <small role="alert" className={styles.error}>
        {errors[key]}
      </small>
    ) : null;

  return (
    <div className="modal-overlay">
      <form
        className={`modal ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-employee-title"
        noValidate
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !touched) onClose();
        }}
      >
        <div className={styles.head}>
          <div>
            <span className="modal-eyebrow">
              {company} · {monthLabel}
            </span>
            <h2 id="new-employee-title">New employee</h2>
          </div>
          <button className="close-modal" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          <label className={styles.field}>
            <span>Name</span>
            <input
              className={styles.input}
              autoFocus
              autoComplete="off"
              value={form.name}
              placeholder="Full name"
              onChange={(event) => set("name", event.target.value)}
            />
            {showError("name")}
            {errors.duplicate ? (
              <small role="status" className={styles.warning}>
                {errors.duplicate}
              </small>
            ) : null}
          </label>

          <fieldset className={styles.field}>
            <legend>Category</legend>
            <div className={styles.segments}>
              {(Object.keys(CATEGORY_HINTS) as Category[]).map((category) => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={form.category === category}
                  className={`${styles.segment} ${form.category === category ? styles.segmentOn : ""}`}
                  onClick={() => set("category", category)}
                >
                  <strong>{category}</strong>
                  <small>{CATEGORY_HINTS[category]}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <div className={styles.pair}>
            <label className={styles.field}>
              <span>{perDay ? "Salary per day (₹)" : special ? "Fixed pay per month (₹)" : "Salary per month (₹)"}</span>
              <NumberInput
                className={styles.input}
                value={form.salary || undefined}
                allowBlank
                min={0}
                onChange={(value) => set("salary", value ?? 0)}
              />
              {showError("salary")}
            </label>
            {special ? null : (
              <label className={styles.field}>
                <span>{perDay ? "Bonus per day (₹)" : "Travelling per month (₹)"}</span>
                <NumberInput
                  className={styles.input}
                  value={form.extra || undefined}
                  allowBlank
                  min={0}
                  onChange={(value) => set("extra", value ?? 0)}
                />
                <small className={styles.hint}>Leave blank if none</small>
              </label>
            )}
          </div>

          {special ? (
            <p className={styles.hint}>Special is paid the full month with no PF or ESI.</p>
          ) : (
            <>
              <div className={styles.pair}>
                <label className={styles.field}>
                  <span>Days worked in {monthLabel.split(" ")[0]}</span>
                  <NumberInput
                    className={styles.input}
                    value={form.daysWorked}
                    min={0}
                    max={monthDays}
                    onChange={(value) => set("daysWorked", value ?? 0)}
                  />
                  {showError("daysWorked") ?? <small className={styles.hint}>Out of {monthDays}. Lower it if they joined mid-month.</small>}
                </label>
                <label className={styles.field}>
                  <span>Extra days</span>
                  <NumberInput
                    className={styles.input}
                    value={form.extraDays}
                    min={0}
                    onChange={(value) => set("extraDays", value ?? 0)}
                  />
                </label>
              </div>
              <div className={styles.checks}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={form.pfOptIn && !pfBlocked}
                    disabled={pfBlocked}
                    onChange={(event) => set("pfOptIn", event.target.checked)}
                  />
                  PF
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={esiOn}
                    onChange={(event) => setForm((current) => withEsiChoice(current, event.target.checked, monthDays))}
                  />
                  ESI
                </label>
                {pfBlocked ? (
                  <small className={styles.hint}>PF is off: Basic is above {currency(PF_BASIC_LIMIT)}.</small>
                ) : null}
                {!esiDefault ? (
                  <small className={styles.hint}>
                    Total above {currency(ESI_GROSS_LIMIT)}: ESI is off unless you tick it.
                  </small>
                ) : null}
              </div>
            </>
          )}

          <label className={styles.field}>
            <span>Advance this month (₹)</span>
            <NumberInput
              className={styles.input}
              value={form.advance}
              allowBlank
              min={0}
              onChange={(value) => set("advance", value)}
            />
            <small className={styles.hint}>Leave blank if none</small>
          </label>

          <label className={styles.field}>
            <span>Notes</span>
            <textarea
              className={styles.input}
              rows={2}
              value={form.notes}
              placeholder="Joining date, phone, Aadhaar or ID numbers"
              onChange={(event) => set("notes", event.target.value)}
            />
          </label>
        </div>

        <div className={styles.foot}>
          <div className={styles.preview} aria-live="polite">
            {preview && form.salary > 0 ? (
              <>
                <span>
                  Total salary <strong>{currency(preview.totalSalary)}</strong>/month
                </span>
                <span>
                  Net this month <strong>{currency(preview.netPayable)}</strong>
                </span>
              </>
            ) : (
              <span>Type the salary to see the pay.</span>
            )}
          </div>
          <div className={styles.actions}>
            <button className="ghost-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" type="submit">
              <UserPlus size={16} />
              {errors.duplicate && !blocking ? "Add anyway" : "Add employee"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
