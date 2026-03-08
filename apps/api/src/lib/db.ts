import { DuckDBInstance } from "@duckdb/node-api";

let instance: Awaited<ReturnType<typeof DuckDBInstance.create>> | null = null;

async function getInstance() {
  if (!instance) {
    instance = await DuckDBInstance.create(":memory:");
  }
  return instance;
}

export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const inst = await getInstance();
  const conn = await inst.connect();
  const reader = await conn.runAndReadAll(sql);
  const columnNames = reader.columnNames();
  const rawRows = reader.getRows();
  return rawRows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columnNames.length; i++) {
      const val = row[i];
      if (typeof val === "bigint") {
        obj[columnNames[i]] = Number(val);
      } else if (val && typeof val === "object" && "days" in val) {
        // DuckDB DATE type → convert epoch days to YYYY-MM-DD string
        const epoch = new Date((val as { days: number }).days * 86400000);
        obj[columnNames[i]] = epoch.toISOString().slice(0, 10);
      } else {
        obj[columnNames[i]] = val;
      }
    }
    return obj as T;
  });
}
