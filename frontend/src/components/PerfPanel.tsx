import type { PerfReport } from '../api';
import { formatDuration, isSlowDuration } from '../utils/time';

type Props = {
  report: PerfReport | null;
  loading: boolean;
  loadMs: number | null;
};

export default function PerfPanel({ report, loading, loadMs }: Props) {
  if (loading) {
    return <div className="metric-card">Loading...</div>;
  }

  if (!report) {
    return <div className="metric-card">No report yet. Run the benchmark script.</div>;
  }

  return (
    <div>
      {loadMs !== null ? (
        <div className={`load-meta${isSlowDuration(loadMs) ? ' slow' : ''}`}>
          Loaded in {formatDuration(loadMs)}
        </div>
      ) : null}
      <div className="metrics">
        {report.data.map((item) => (
          <div className="metric-card" key={item.label}>
            <h3>{item.label}</h3>
            <p>Baseline: {item.baselineMs} ms</p>
            <p>Optimized: {item.optimizedMs} ms</p>
            <p>Improvement: {item.improvement}x</p>
            {item.indexUsed ? <p>Index: {item.indexUsed}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
