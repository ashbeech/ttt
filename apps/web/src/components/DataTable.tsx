interface DataTableProps {
  columns: string[];
  rows: Record<string, unknown>[];
  maxRows?: number;
}

export function DataTable({ columns, rows, maxRows = 100 }: DataTableProps) {
  const displayed = rows.slice(0, maxRows);
  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayed.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col}>
                  {formatCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <p className="table-shell__caption">
          Showing {maxRows} of {rows.length} rows
        </p>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  if (typeof value === "string" && value.startsWith("0x") && value.length > 12) {
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }
  return String(value);
}
