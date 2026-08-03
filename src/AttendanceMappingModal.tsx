import { useMemo, useState } from "react";
import type { AttendanceEmployee, AttendanceMetaV1, EmployeeInput } from "./types";
import { suggestMapping } from "./reconcile";

type Props = {
  biometric: AttendanceEmployee[];
  roster: EmployeeInput[];
  meta: AttendanceMetaV1;
  onSave: (nextMap: Record<string, string>) => void;
  onClose: () => void;
};

export function AttendanceMappingModal({
  biometric,
  roster,
  meta,
  onSave,
  onClose,
}: Props) {
  const suggestions = useMemo(
    () => suggestMapping(biometric, roster, meta),
    [biometric, roster, meta]
  );

  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = { ...(meta.map || {}) };
    for (const s of suggestions) {
      if (s.suggestedRosterId && !init[s.biometricId]) {
        init[s.biometricId] = s.suggestedRosterId;
      }
    }
    return init;
  });

  const unmapped = suggestions;

  return (
    <div
      className="attendance-overlay"
      style={{ zIndex: 60, background: "rgba(15,23,42,0.55)" }}
      onClick={onClose}
    >
      <div
        className="attendance-modal"
        style={{
          maxWidth: 640,
          height: "auto",
          maxHeight: "80vh",
          padding: 0,
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Map Biometric IDs</h2>
            <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>
              Joins device rows to the roster by stored Biometric ID only. Name match is a
              suggestion — never applied silently.
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {unmapped.length === 0 ? (
            <p style={{ fontSize: 13, color: "#64748b" }}>All biometric rows are mapped.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>
                  <th style={{ padding: "8px 6px" }}>Device ID</th>
                  <th style={{ padding: "8px 6px" }}>Biometric name</th>
                  <th style={{ padding: "8px 6px" }}>Roster employee</th>
                </tr>
              </thead>
              <tbody>
                {unmapped.map((row) => (
                  <tr key={row.biometricId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 6px", fontFamily: "monospace" }}>
                      {row.biometricId}
                    </td>
                    <td style={{ padding: "8px 6px", fontWeight: 600 }}>{row.biometricName}</td>
                    <td style={{ padding: "8px 6px" }}>
                      <select
                        value={draft[row.biometricId] || ""}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [row.biometricId]: e.target.value,
                          }))
                        }
                        style={{
                          width: "100%",
                          minHeight: 32,
                          fontSize: 12,
                          borderRadius: 6,
                          border: "1px solid #cbd5e1",
                          padding: "4px 8px",
                        }}
                      >
                        <option value="">— unmapped —</option>
                        {roster.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer
          style={{
            padding: "12px 16px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              const cleaned: Record<string, string> = { ...(meta.map || {}) };
              for (const [deviceId, rosterId] of Object.entries(draft)) {
                if (rosterId) cleaned[deviceId] = rosterId;
                else delete cleaned[deviceId];
              }
              onSave(cleaned);
            }}
          >
            Save mapping
          </button>
        </footer>
      </div>
    </div>
  );
}
