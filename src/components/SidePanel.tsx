import { BarChart3 } from "lucide-react";
import { currency } from "../salary";

export type CategoryTotal = { category: string; total: number };

export function SidePanel({
  categoryTotals,
  netTotal,
}: {
  categoryTotals: CategoryTotal[];
  netTotal: number;
}) {
  return (
    <aside className="side-stack">
      <article className="panel">
        <div className="panel-heading compact">
          <div>
            <h2><BarChart3 size={18} /> Category Net Pay</h2>
            <p>Largest groups</p>
          </div>
        </div>
        <div className="bar-list">
          {categoryTotals.map((item) => {
            const width = netTotal ? Math.max(8, (item.total / netTotal) * 100) : 0;
            return (
              <div className="bar-row" key={item.category}>
                <div className="bar-label">
                  <span>{item.category}</span>
                  <strong>{currency(item.total)}</strong>
                </div>
                <div className="bar-track">
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
