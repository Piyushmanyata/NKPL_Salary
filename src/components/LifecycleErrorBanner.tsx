import { AlertTriangle } from "lucide-react";
import styles from "./LifecycleErrorBanner.module.css";

export function LifecycleErrorBanner({
  error,
  stale,
  onRetry,
}: {
  error: string;
  stale: boolean;
  onRetry: () => void;
}) {
  return (
    <div className={styles.banner} role="alert">
      <span>
        <AlertTriangle size={14} aria-hidden="true" />
        {stale ? error : `Database operation failed: ${error}`}
      </span>
      <button type="button" className="primary-button" onClick={onRetry}>
        {stale ? "Reload" : "Retry"}
      </button>
    </div>
  );
}
