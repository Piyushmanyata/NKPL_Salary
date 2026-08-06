import { AlertTriangle } from "lucide-react";
import styles from "./LifecycleErrorBanner.module.css";

export function LifecycleErrorBanner({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className={styles.banner} role="alert">
      <span>
        <AlertTriangle size={14} aria-hidden="true" />
        Database operation failed: {error}
      </span>
      <button type="button" className="primary-button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
