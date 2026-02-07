import type { PerfReport } from '../api';

type Props = {
  report: PerfReport | null;
};

export default function PerfPanel({ report }: Props) {
  if (!report) {
    return <div className="metric-card">No report yet. Run the benchmark script.</div>;
  }

  return (
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
  );
}
