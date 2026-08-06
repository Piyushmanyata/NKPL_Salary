export function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="rule-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
