interface MetricCardProps {
  title: string;
  value: string | number | null;
  subtitle?: string;
  accent?: string;
}

export function MetricCard({ title, value, subtitle, accent = "indigo" }: MetricCardProps) {
  const accentClasses: Record<string, string> = {
    indigo: "metric-card--indigo",
    emerald: "metric-card--emerald",
    amber: "metric-card--amber",
    rose: "metric-card--rose",
  };

  return (
    <div className={`metric-card ${accentClasses[accent] ?? accentClasses.indigo}`}>
      <p className="metric-card__title">{title}</p>
      <p className="metric-card__value">{value ?? "—"}</p>
      {subtitle && <p className="metric-card__subtitle">{subtitle}</p>}
    </div>
  );
}
