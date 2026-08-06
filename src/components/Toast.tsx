import { AlertTriangle, Check } from "lucide-react";

export type ToastState = { message: string; type: "success" | "error" } | null;

export function Toast({
  toast,
  onDismiss,
}: {
  toast: NonNullable<ToastState>;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`custom-toast ${toast.type}`}
      role="status"
      aria-live="polite"
      onClick={onDismiss}
    >
      {toast.type === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}
      <span>{toast.message}</span>
    </div>
  );
}
