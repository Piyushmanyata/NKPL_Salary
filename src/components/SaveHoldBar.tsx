import { AlertTriangle } from "lucide-react";
import type { Flag } from "../flags";
import styles from "./SaveHoldBar.module.css";

export function SaveHoldBar({
  warnings,
  onShow,
  onSaveAnyway,
}: {
  warnings: Flag[];
  onShow: () => void;
  onSaveAnyway: () => void;
}) {
  const [first] = warnings;
  const more = warnings.length - 1;
  return (
    <div className={styles.bar} role="alert">
      <span className={styles.text}>
        <AlertTriangle size={15} aria-hidden="true" />
        <b>Not saved yet.</b>
        <span>
          {first.name}: {first.title}. {first.detail}
          {more > 0 ? ` (+${more} more)` : ""}
        </span>
      </span>
      <span className={styles.actions}>
        <button type="button" className="ghost-button" onClick={onShow}>
          See flags
        </button>
        <button type="button" className="primary-button" onClick={onSaveAnyway}>
          Save anyway
        </button>
      </span>
    </div>
  );
}
