import { Cloud, Download, Wifi, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BACKUP_DOWNLOAD_URL, getBackupStatus, type BackupStatus } from "../db";
import { formatSavedAt } from "../hooks/useMonthLifecycle";

function backupLine(status: BackupStatus | null | undefined): string {
  if (status === undefined) return "Checking the last backup…";
  if (status === null) return "Could not read the backup status.";
  if (!status.configured) return "The nightly backup is not switched on yet. Use Download backup to keep a copy.";
  if (!status.lastAt) return "The nightly backup is on, but no copy has been taken yet.";
  return `Last automatic backup: ${formatSavedAt(status.lastAt)}. One copy a day is kept for 180 days, and the first copy of every month for good.`;
}

export function DatabaseModal({ onClose }: { onClose: () => void }) {
  const [backup, setBackup] = useState<BackupStatus | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void getBackupStatus().then((status) => {
      if (!cancelled) setBackup(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: "600px", height: "auto", padding: "28px" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <span className="modal-eyebrow">Database Settings</span>
            <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "4px 0" }}>Database Sync & Backup</h2>
          </div>
          <button className="close-modal" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <div style={{ marginBottom: "20px", padding: "16px", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: "10px", color: "#065f46", fontSize: "14px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <Cloud size={20} style={{ color: "#059669", flexShrink: 0, marginTop: "2px" }} />
            <div>
              <strong style={{ display: "block", marginBottom: "4px", fontSize: "15px" }}>Redis Sync Active</strong>
              Payroll is stored in Redis and is the single source of truth. Every month record and the shared rate card load and sync automatically by company and month for everyone who opens the app &mdash; NKPL and APTUS data are kept completely separate.
            </div>
          </div>

          <div style={{ marginBottom: "20px", padding: "12px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", color: "#64748b", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
            <Wifi size={18} style={{ color: "#2563eb", flexShrink: 0 }} />
            <div>
              <strong>Local Caching Active:</strong> Local Storage caches the data locally in your browser to ensure offline support and maximum speed.
            </div>
          </div>

          <div style={{ fontSize: "13px", color: "#64748b", background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0", lineHeight: "1.5" }}>
            <strong>Keys in use:</strong>
            <ul style={{ paddingLeft: "18px", marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px", listStyleType: "disc" }}>
              <li><code>monthly_salary/&lt;company&gt;/&lt;month&gt;</code> &mdash; one record per company per month.</li>
              <li><code>employee_rates/&lt;company&gt;</code> &mdash; the shared rate card that carries across months.</li>
              <li><code>salary_history/&lt;company&gt;/&lt;month&gt;</code> &mdash; the last 40 copies a save replaced; open <strong>History</strong> to restore one.</li>
              <li>A tab open on older data cannot save over newer data: it is asked to reload instead.</li>
              <li>The connection string never reaches the browser; all reads and writes go through <code>/api/db</code> and <code>/api/rates</code>.</li>
            </ul>
          </div>
        </div>

        <div style={{ marginBottom: "24px", padding: "14px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "14px", color: "#334155", lineHeight: "1.5" }}>
          <strong style={{ display: "block", marginBottom: "4px" }}>Backup</strong>
          <span>{backupLine(backup)}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
          <a className="quiet-button" href={BACKUP_DOWNLOAD_URL} download style={{ fontWeight: "600", textDecoration: "none" }}>
            <Download size={16} />
            Download backup
          </a>
          <button
            className="quiet-button"
            onClick={onClose}
            style={{ fontWeight: "600" }}
          >
            Close Settings
          </button>
        </div>
      </div>
    </div>
  );
}
