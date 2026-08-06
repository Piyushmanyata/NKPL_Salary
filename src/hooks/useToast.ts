import { useRef, useState } from "react";
import type { ToastState } from "../components/Toast";

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 4000);
  };

  const dismissToast = () => setToast(null);

  return { toast, showToast, dismissToast };
}
