import { AlertTriangle } from "lucide-react";
import styles from "./LifecycleErrorBanner.module.css";

export function LifecycleErrorBanner({
  error,
  stale,
  loaded,
  nextRetryMs,
  onRetry,
}: {
  error: string;
  stale: boolean;
  loaded: boolean;
  nextRetryMs: number;
  onRetry: () => void;
}) {
  const what = loaded ? "Not saved yet" : "Could not open this month";
  const seconds = Math.round(nextRetryMs / 1000);
  return (
    <div className={styles.banner} role="alert">
      <span>
        <AlertTriangle size={14} aria-hidden="true" />
        {stale ? error : `${what}: ${error} Trying again by itself in about ${seconds} s. Keep this tab open.`}
      </span>
      <button type="button" className="primary-button" onClick={onRetry}>
        {stale ? "Reload" : "Try now"}
      </button>
    </div>
  );
}
