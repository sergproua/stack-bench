import { useEffect, useMemo, useState } from 'react';
import ClaimsTable from './components/ClaimsTable';
import PerfPanel from './components/PerfPanel';
import { fetchClaims, fetchPerfReport, fetchSummary, type Claim, type PerfReport } from './api';

type Summary = {
  totalClaims: number;
  totalAmount: number;
  statusBreakdown: Array<{ _id: string; count: number }>;
  topProcedures: Array<{ _id: string; count: number }>;
};

const defaultFilters = {
  q: '',
  status: '',
  region: '',
  providerSpecialty: '',
  minAmount: '',
  maxAmount: '',
  startDate: '',
  endDate: '',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'claims' | 'perf'>('claims');
  const [filters, setFilters] = useState(defaultFilters);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [perf, setPerf] = useState<PerfReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState({ total: 0, queryTimeMs: 0 });

  const params = useMemo(() => {
    const entries = Object.entries(filters).filter(([, value]) => value);
    return Object.fromEntries(entries) as Record<string, string>;
  }, [filters]);

  useEffect(() => {
    fetchSummary().then((res) => setSummary(res.data));
    fetchPerfReport().then((res) => setPerf(res));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchClaims({ ...params, pageSize: '100' })
      .then((res) => {
        setClaims(res.data);
        setMeta({ total: res.meta.total, queryTimeMs: res.meta.queryTimeMs });
      })
      .finally(() => setLoading(false));
  }, [params]);

  const updateFilter = (key: keyof typeof defaultFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="app">
      <section className="hero">
        <div>
          <h1>Health Claims Performance Lab</h1>
          <p>Explore large-scale claim data, diagnose slow MongoDB queries, and verify index impact in minutes.</p>
        </div>
        <div className="meta">
          <div>Dataset: 500K / 5M claims</div>
          <div>Total Results: {meta.total.toLocaleString()}</div>
          <div>Query Time: {meta.queryTimeMs} ms</div>
        </div>
      </section>

      <div className="tabs">
        <button className={`tab ${activeTab === 'claims' ? 'active' : ''}`} onClick={() => setActiveTab('claims')}>Claims Search</button>
        <button className={`tab ${activeTab === 'perf' ? 'active' : ''}`} onClick={() => setActiveTab('perf')}>Performance</button>
      </div>

      {activeTab === 'claims' ? (
        <section className="panel">
          <div className="filters">
            <label>
              Keyword
              <input value={filters.q} onChange={(e) => updateFilter('q', e.target.value)} placeholder="Member, provider, code" />
            </label>
            <label>
              Status
              <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}>
                <option value="">All</option>
                <option value="submitted">Submitted</option>
                <option value="in_review">In Review</option>
                <option value="approved">Approved</option>
                <option value="denied">Denied</option>
                <option value="paid">Paid</option>
              </select>
            </label>
            <label>
              Region
              <select value={filters.region} onChange={(e) => updateFilter('region', e.target.value)}>
                <option value="">All</option>
                <option value="Northeast">Northeast</option>
                <option value="Midwest">Midwest</option>
                <option value="South">South</option>
                <option value="West">West</option>
              </select>
            </label>
            <label>
              Specialty
              <select value={filters.providerSpecialty} onChange={(e) => updateFilter('providerSpecialty', e.target.value)}>
                <option value="">All</option>
                <option value="Cardiology">Cardiology</option>
                <option value="Orthopedics">Orthopedics</option>
                <option value="Primary Care">Primary Care</option>
                <option value="Neurology">Neurology</option>
                <option value="Oncology">Oncology</option>
                <option value="Dermatology">Dermatology</option>
              </select>
            </label>
            <label>
              Min Amount
              <input value={filters.minAmount} onChange={(e) => updateFilter('minAmount', e.target.value)} placeholder="100" />
            </label>
            <label>
              Max Amount
              <input value={filters.maxAmount} onChange={(e) => updateFilter('maxAmount', e.target.value)} placeholder="10000" />
            </label>
            <label>
              Start Date
              <input type="date" value={filters.startDate} onChange={(e) => updateFilter('startDate', e.target.value)} />
            </label>
            <label>
              End Date
              <input type="date" value={filters.endDate} onChange={(e) => updateFilter('endDate', e.target.value)} />
            </label>
          </div>

          {loading ? <div>Loading claims...</div> : <ClaimsTable data={claims} />}
        </section>
      ) : (
        <section className="panel">
          <h2>Optimization Impact</h2>
          <p>Run backend benchmarks to populate this report and validate index improvements.</p>
          <PerfPanel report={perf} />
        </section>
      )}

      {summary ? (
        <section className="panel">
          <h2>Portfolio Summary</h2>
          <div className="metrics">
            <div className="metric-card">
              <h3>Total Claims</h3>
              <p>{summary.totalClaims.toLocaleString()}</p>
            </div>
            <div className="metric-card">
              <h3>Total Amount</h3>
              <p>${summary.totalAmount.toLocaleString()}</p>
            </div>
            <div className="metric-card">
              <h3>Status Breakdown</h3>
              <p>{summary.statusBreakdown.map((item) => `${item._id}: ${item.count}`).join(' | ')}</p>
            </div>
            <div className="metric-card">
              <h3>Top Procedures</h3>
              <p>{summary.topProcedures.map((item) => `${item._id}: ${item.count}`).join(' | ')}</p>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
