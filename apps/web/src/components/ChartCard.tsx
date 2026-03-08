import { ReactNode } from "react";

interface ChartCardProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function ChartCard({ title, description, children }: ChartCardProps) {
  return (
    <div className="chart-card">
      {title && <h3 className="chart-card__title">{title}</h3>}
      {description && <p className="chart-card__description">{description}</p>}
      <div className="chart-card__body">{children}</div>
    </div>
  );
}
