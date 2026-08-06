import { IndianRupee } from "lucide-react";
import { currency } from "../salary";
import type { MonthTotals } from "../totals";
import styles from "./TotalsStrip.module.css";

export function TotalsStrip({ totals }: { totals: MonthTotals }) {
  return (
    <section className={styles.totalsStrip} aria-label="Month totals">
      <div className={styles.totalsNet}>
        <IndianRupee size={18} />
        <span>Net Payable</span>
        <strong>{currency(totals.net)}</strong>
      </div>
      <div className={styles.totalsItem} title={`${currency(totals.deductions)} total deductions`}>
        <span>Gross</span>
        <strong>{currency(totals.gross)}</strong>
      </div>
      <div
        className={styles.totalsItem}
        title={`${currency(totals.employerPf)} PF + ${currency(totals.employerEsi)} ESI (Employer)`}
      >
        <span>PF + ESI + P-Tax</span>
        <strong>{currency(totals.pf + totals.esi + totals.professionalTax)}</strong>
      </div>
      <div className={styles.totalsItem}>
        <span>Employer Cost</span>
        <strong>{currency(totals.cost)}</strong>
      </div>
      <div className={styles.totalsItem}>
        <span>Employees</span>
        <strong>{totals.employees}</strong>
      </div>
    </section>
  );
}
