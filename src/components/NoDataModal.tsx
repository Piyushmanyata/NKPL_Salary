export function NoDataModal({
  activeCompany,
  companyName,
  noDataMonth,
  allMonths,
  copySourceMonth,
  onCopySourceMonthChange,
  onCopyMonth,
  onCreateSampleMonth,
  onCreateBlankMonth,
  onCancel,
}: {
  activeCompany: string;
  companyName: string;
  noDataMonth: string;
  allMonths: string[];
  copySourceMonth: string;
  onCopySourceMonthChange: (month: string) => void;
  onCopyMonth: (source: string) => void;
  onCreateSampleMonth: () => void;
  onCreateBlankMonth: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: "500px", height: "auto", padding: "28px" }}>
        <div style={{ marginBottom: "20px" }}>
          <span className="modal-eyebrow">Database Notice</span>
          <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "8px 0" }}>
            Initialize {activeCompany} &middot; {noDataMonth}
          </h2>
          <p style={{ color: "#667085", fontSize: "14px", lineHeight: "1.5" }}>
            No records exist for <strong>{companyName || activeCompany}</strong> in <strong>{noDataMonth}</strong> yet. How would you like to initialize this month?
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
          {allMonths.filter((m) => m !== noDataMonth).length > 0 && (
            <div style={{ padding: "14px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#f8fafc" }}>
              <label style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>
                Copy Employees From:
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <select
                  value={copySourceMonth}
                  onChange={(e) => onCopySourceMonthChange(e.target.value)}
                  style={{ flex: 1, padding: "8px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", fontSize: "14px" }}
                >
                  {allMonths.filter((m) => m !== noDataMonth).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <button
                  className="primary-button"
                  onClick={() => onCopyMonth(copySourceMonth)}
                  style={{ padding: "0 14px", height: "38px", fontSize: "13px" }}
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {activeCompany === "NKPL" && (
            <button
              className="ghost-button"
              onClick={onCreateSampleMonth}
              style={{ justifyContent: "center", height: "42px", fontWeight: "600", color: "#2563eb", borderColor: "#2563eb", background: "rgba(37,99,235,0.04)" }}
            >
              Use Default Sample Employees
            </button>
          )}

          <button
            className="quiet-button"
            onClick={onCreateBlankMonth}
            style={{ justifyContent: "center", height: "42px", fontWeight: "500", border: "1px solid #cbd5e1" }}
          >
            Start with a Blank Sheet
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="quiet-button"
            onClick={onCancel}
            style={{ color: "#ef4444", fontWeight: "600" }}
          >
            Cancel & Restore Previous Month
          </button>
        </div>
      </div>
    </div>
  );
}
