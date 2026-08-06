import { IndianRupee } from "lucide-react";
import { currency } from "../salary";

export type MonthTotals = {
  net: number;
  gross: number;
  deductions: number;
  employerPf: number;
  employerEsi: number;
  pf: number;
  esi: number;
  professionalTax: number;
  cost: number;
  employees: number;
};

export function TotalsStrip({ totals }: { totals: MonthTotals }) {
  return (
    <section className="totals-strip" aria-label="Month totals">
      <div className="totals-net">
        <IndianRupee size={18} />
        <span>Net Payable</span>
        <strong>{currency(totals.net)}</strong>
      </div>
      <div className="totals-item" title={`${currency(totals.deductions)} total deductions`}>
        <span>Gross</span>
        <strong>{currency(totals.gross)}</strong>
      </div>
      <div
        className="totals-item"
        title={`${currency(totals.employerPf)} PF + ${currency(totals.employerEsi)} ESI (Employer)`}
      >
        <span>PF + ESI + P-Tax</span>
        <strong>{currency(totals.pf + totals.esi + totals.professionalTax)}</strong>
      </div>
      <div className="totals-item">
        <span>Employer Cost</span>
        <strong>{currency(totals.cost)}</strong>
      </div>
      <div className="totals-item">
        <span>Employees</span>
        <strong>{totals.employees}</strong>
      </div>
    </section>
  );
}
