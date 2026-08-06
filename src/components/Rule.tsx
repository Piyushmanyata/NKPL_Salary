import styles from "./Rule.module.css";
export function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.ruleRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
