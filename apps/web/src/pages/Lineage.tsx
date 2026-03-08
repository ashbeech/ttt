import { useEffect, useState } from "react";
import { getLineageList, getLineageDetail } from "../lib/api";
import { DataTable } from "../components/DataTable";

interface LineageSummary {
  key: string;
  metricName: string;
  description: string;
  formula: string;
  sourceEvents: string[];
}

interface LineageDetail {
  metricName: string;
  description: string;
  formula: string;
  sourceEvents: string[];
  sourceRawFiles: string[];
  sourceIntermediateFiles: string[];
  sampleNormalizedRows: Record<string, unknown>[];
  sampleRawLogs: Record<string, unknown>[];
}

export function LineagePage() {
  const [metrics, setMetrics] = useState<LineageSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<LineageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLineageList()
      .then((res) => setMetrics(res.data))
      .catch((e) => setError(e.message));
  }, []);

  async function toggleExpand(key: string) {
    if (expanded === key) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(key);
    setDetailLoading(true);
    try {
      const res = await getLineageDetail(key);
      setDetail(res.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }

  if (error) return <div className="state-message state-message--error">Error: {error}</div>;

  return (
    <div className="page page--lineage">
      <div className="page__header">
        <h1 className="page__title">Lineage & Audit</h1>
        <p className="page__subtitle">
          Trace each metric back to its source events, raw files, and transformation logic.
          This page proves that every number can be audited.
        </p>
      </div>

      <div className="lineage-list">
        {metrics.map((m) => (
          <div key={m.key} className="lineage-card">
            <button
              onClick={() => toggleExpand(m.key)}
              className="lineage-card__toggle"
            >
              <div className="lineage-card__top">
                <div>
                  <h3 className="lineage-card__title">{m.metricName}</h3>
                  <p className="lineage-card__description">{m.description}</p>
                </div>
                <span className="lineage-card__icon">{expanded === m.key ? "−" : "+"}</span>
              </div>
              <div className="lineage-card__tags">
                {m.sourceEvents.map((e) => (
                  <span key={e} className="badge badge--blue">
                    {e}
                  </span>
                ))}
              </div>
            </button>

            {expanded === m.key && (
              <div className="lineage-card__content">
                {detailLoading ? (
                  <p className="state-message">Loading lineage detail...</p>
                ) : detail ? (
                  <>
                    {/* Formula */}
                    <div className="lineage-block">
                      <h4 className="lineage-block__title">Formula</h4>
                      <pre className="lineage-block__formula">
                        {detail.formula}
                      </pre>
                    </div>

                    {/* Source files */}
                    <div className="lineage-grid">
                      <div>
                        <h4 className="lineage-block__title">Raw Source Files</h4>
                        <ul className="lineage-file-list">
                          {detail.sourceRawFiles.map((f) => (
                            <li key={f} className="lineage-file-list__item">
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="lineage-block__title">
                          Intermediate Tables
                        </h4>
                        <ul className="lineage-file-list">
                          {detail.sourceIntermediateFiles.map((f) => (
                            <li key={f} className="lineage-file-list__item">
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Sample normalized rows */}
                    {detail.sampleNormalizedRows.length > 0 && (
                      <div className="lineage-block">
                        <h4 className="lineage-block__title">
                          Sample Normalized Rows
                        </h4>
                        <DataTable
                          columns={Object.keys(detail.sampleNormalizedRows[0])}
                          rows={detail.sampleNormalizedRows}
                        />
                      </div>
                    )}

                    {/* Sample raw logs */}
                    {detail.sampleRawLogs.length > 0 && (
                      <div className="lineage-block">
                        <h4 className="lineage-block__title">
                          Sample Raw Logs
                        </h4>
                        <div className="lineage-block__raw">
                          <pre>
                            {JSON.stringify(detail.sampleRawLogs, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
