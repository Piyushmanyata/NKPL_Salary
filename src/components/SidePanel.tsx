import { BarChart3 } from "lucide-react";
import { currency } from "../salary";
import styles from "./SidePanel.module.css";

export type CategoryTotal = { category: string; total: number };

export function SidePanel({
  categoryTotals,
  netTotal,
}: {
  categoryTotals: CategoryTotal[];
  netTotal: number;
}) {
  return (
    <aside className={styles.sideStack}>
      <article className="panel">
        <div className="panel-heading compact">
          <div>
            <h2><BarChart3 size={18} /> Category Net Pay</h2>
            <p>Largest groups</p>
          </div>
        </div>
        <div className={styles.barList}>
          {categoryTotals.map((item) => {
            const width = netTotal ? Math.max(8, (item.total / netTotal) * 100) : 0;
            return (
              <div className={styles.barRow} key={item.category}>
                <div className={styles.barLabel}>
                  <span>{item.category}</span>
                  <strong>{currency(item.total)}</strong>
                </div>
                <div className={styles.barTrack}>
                  <span style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </article>
    </aside>
  );
}
