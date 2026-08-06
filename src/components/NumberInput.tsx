import { useState } from "react";
import { numberValue } from "../salary";
import "./NumberInput.module.css";

export function NumberInput({
  value,
  onChange,
  className = "number-input",
  min,
  max,
  allowBlank = false,
  disabled = false,
  dataCell,
  title,
}: {
  value: number | undefined | "";
  onChange: (value: number | undefined) => void;
  className?: string;
  min?: number;
  max?: number;
  allowBlank?: boolean;
  disabled?: boolean;
  // Opts this input into arrow-key column navigation — see handleGridKey.
  dataCell?: string;
  title?: string;
}) {
  const canonical =
    allowBlank && (value === undefined || value === "") ? "" : Number.isFinite(value) ? value : 0;
  // While the field is focused we show exactly what was typed. The model still
  // updates on every keystroke, but a value that comes back rounded or derived
  // (Salary per Month for Unskilled, Allowance) must not overwrite the digits
  // mid-word — that made the box snap to 0 or refuse the number entered.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={className}
      type="number"
      min={min}
      max={max}
      value={draft ?? canonical}
      disabled={disabled}
      data-cell={dataCell}
      title={title}
      onFocus={(event) => setDraft(event.target.value)}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        const val = event.target.value;
        setDraft(val);
        if (val === "") {
          onChange(allowBlank ? undefined : 0);
        } else {
          onChange(numberValue(val));
        }
      }}
    />
  );
}
