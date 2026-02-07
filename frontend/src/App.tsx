import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import ClaimsTable from './components/ClaimsTable';
import PerfPanel from './components/PerfPanel';
import SlowOpsTable from './components/SlowOpsTable';
import { clearSlowOps, fetchClaims, fetchPerfReport, fetchSlowOps, fetchSummary, type Claim, type PerfReport, type SlowOp } from './api';

type Summary = {
  totalClaims: number;
  totalAmount: number;
  statusBreakdown: Array<{ _id: string; count: number }>;
  topProcedures: Array<{ _id: string; count: number }>;
};
type SummaryMeta = {
  generatedAt?: string;
  durationMs?: number;
  cached?: boolean;
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

const defaultSlowFilters = {
  keyword: '',
  minMs: '1000',
  startDate: '',
  endDate: '',
};

const PAGE_SIZE = 100;

const formatSlowOpDetails = (op: SlowOp) => ({
  ...op,
  ts: op.ts ? new Date(op.ts).toISOString() : op.ts,
});

const formatAge = (timestamp?: string) => {
  if (!timestamp) {
    return '—';
  }
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) {
    return '—';
  }
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const STORAGE_KEYS = {
  activeTab: 'ui.activeTab',
  filters: 'ui.claimFilters',
  slowFilters: 'ui.slowFilters',
};

const readStored = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'claims' | 'perf' | 'slow'>(() => {
    const stored = readStored<string | null>(STORAGE_KEYS.activeTab, null);
    return stored === 'perf' || stored === 'slow' || stored === 'claims' ? stored : 'claims';
  });
  const [filters, setFilters] = useState(() => readStored(STORAGE_KEYS.filters, defaultFilters));
  const [debouncedFilters, setDebouncedFilters] = useState(() => readStored(STORAGE_KEYS.filters, defaultFilters));
  const [claims, setClaims] = useState<Claim[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryMeta, setSummaryMeta] = useState<SummaryMeta | null>(null);
  const [perf, setPerf] = useState<PerfReport | null>(null);
  const [slowOps, setSlowOps] = useState<SlowOp[]>([]);
  const [slowOpsMeta, setSlowOpsMeta] = useState<Record<string, unknown> | null>(null);
  const [slowOpsLoading, setSlowOpsLoading] = useState(false);
  const [slowOpsLoadMs, setSlowOpsLoadMs] = useState<number | null>(null);
  const [slowOpsClearLoading, setSlowOpsClearLoading] = useState(false);
  const [slowFilters, setSlowFilters] = useState(() => readStored(STORAGE_KEYS.slowFilters, defaultSlowFilters));
  const [debouncedSlowFilters, setDebouncedSlowFilters] = useState(() => readStored(STORAGE_KEYS.slowFilters, defaultSlowFilters));
  const [selectedSlowOp, setSelectedSlowOp] = useState<SlowOp | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [meta, setMeta] = useState<{ total: number | null; queryTimeMs: number }>({ total: null, queryTimeMs: 0 });
  const [claimsLoadMs, setClaimsLoadMs] = useState<number | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryLoadMs, setSummaryLoadMs] = useState<number | null>(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [perfLoadMs, setPerfLoadMs] = useState<number | null>(null);

  useEffect(() => {
    const wsUrl = import.meta.env.VITE_WS_URL || 'http://localhost:3001';
    const socket = io(wsUrl, { transports: ['websocket'] });

    socket.on('summary:update', (payload: { data?: Summary; meta?: SummaryMeta }) => {
      if (payload?.data) {
        setSummary(payload.data);
        setSummaryMeta(payload.meta || null);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.activeTab, JSON.stringify(activeTab));
    } catch {
      // ignore storage failures
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.filters, JSON.stringify(filters));
    } catch {
      // ignore storage failures
    }
  }, [filters]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.slowFilters, JSON.stringify(slowFilters));
    } catch {
      // ignore storage failures
    }
  }, [slowFilters]);

  const params = useMemo(() => {
    const entries = Object.entries(debouncedFilters).filter(([, value]) => value);
    return Object.fromEntries(entries) as Record<string, string>;
  }, [debouncedFilters]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedFilters(filters);
    }, 300);

    return () => window.clearTimeout(handle);
  }, [filters]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSlowFilters(slowFilters);
    }, 300);

    return () => window.clearTimeout(handle);
  }, [slowFilters]);

  useEffect(() => {
    if (activeTab !== 'claims') {
      return;
    }
    const summaryStart = performance.now();
    setSummaryLoading(true);
    fetchSummary()
      .then((res) => {
        setSummary(res.data);
        setSummaryMeta(res.meta || null);
      })
      .finally(() => {
        setSummaryLoading(false);
        setSummaryLoadMs(Math.round(performance.now() - summaryStart));
      });
  }, [activeTab]);

  useEffect(() => {
    const perfStart = performance.now();
    setPerfLoading(true);
    fetchPerfReport()
      .then((res) => setPerf(res))
      .finally(() => {
        setPerfLoading(false);
        setPerfLoadMs(Math.round(performance.now() - perfStart));
      });
  }, []);

  useEffect(() => {
    if (activeTab !== 'slow') {
      return;
    }
    const loadSlowOps = async () => {
      const start = performance.now();
      setSlowOpsLoading(true);
      try {
        const res = await fetchSlowOps({
          minMs: Number(debouncedSlowFilters.minMs || '1000'),
          limit: 200,
          keyword: debouncedSlowFilters.keyword || undefined,
          startDate: debouncedSlowFilters.startDate || undefined,
          endDate: debouncedSlowFilters.endDate || undefined,
        });
        setSlowOps(res.data || []);
        setSlowOpsMeta(res.meta || {});
      } finally {
        setSlowOpsLoading(false);
        setSlowOpsLoadMs(Math.round(performance.now() - start));
      }
    };
    loadSlowOps();
  }, [activeTab, debouncedSlowFilters]);

  const loadClaims = async (reset: boolean) => {
    if (reset) {
      setLoading(true);
      setClaims([]);
      setCursor(null);
      setHasMore(true);
    } else {
      if (!hasMore || loadingMore) {
        return;
      }
      setLoadingMore(true);
    }

    const start = performance.now();
    const cursorParam = reset ? '' : (cursor ?? '');
    try {
      const res = await fetchClaims({
        ...params,
        pageSize: String(PAGE_SIZE),
        cursor: cursorParam,
        includeTotal: '0',
      });

      setClaims((prev) => (reset ? res.data : [...prev, ...res.data]));
      setCursor(res.meta.nextCursor);
      setHasMore(Boolean(res.meta.hasMore));
      setMeta({ total: res.meta.total, queryTimeMs: res.meta.queryTimeMs });
      setClaimsLoadMs(Math.round(performance.now() - start));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadClaims(true);
  }, [params]);

  const updateFilter = (key: keyof typeof defaultFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const updateSlowFilter = (key: keyof typeof defaultSlowFilters, value: string) => {
    setSlowFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleClearSlowOps = async () => {
    if (!window.confirm('Clear all captured slow query entries?')) {
      return;
    }
    setSlowOpsClearLoading(true);
    try {
      await clearSlowOps();
      setSlowOps([]);
      setSlowOpsMeta(null);
    } finally {
      setSlowOpsClearLoading(false);
    }
  };

  return (
    <div className="app">
      <section className="hero">
        <div>
          <h1>Health Claims Performance Lab</h1>
          <p>Explore large-scale claim data, diagnose slow MongoDB queries, and verify index impact with live metrics.</p>
        </div>
      </section>

      <div className="tabs">
        <button className={`tab ${activeTab === 'claims' ? 'active' : ''}`} onClick={() => setActiveTab('claims')}>Claims Search</button>
        <button className={`tab ${activeTab === 'perf' ? 'active' : ''}`} onClick={() => setActiveTab('perf')}>Performance</button>
        <button className={`tab ${activeTab === 'slow' ? 'active' : ''}`} onClick={() => setActiveTab('slow')}>Slow Queries</button>
      </div>

      {activeTab === 'claims' ? (
        <>
          <section className="panel">
            <h2>Portfolio Summary</h2>
            {summaryLoading ? (
              <div>Loading...</div>
            ) : summary ? (
              <>
                <div className="load-meta">Loaded in {summaryLoadMs} ms</div>
                <div className="load-meta">
                  As of {formatAge(summaryMeta?.generatedAt)}
                  {summaryMeta?.durationMs ? ` · Job ${summaryMeta.durationMs} ms` : ''}
                </div>
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
              </>
            ) : (
              <div>No summary data.</div>
            )}
          </section>

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

            {loading && claims.length === 0 ? (
              <div>Loading...</div>
            ) : (
              <ClaimsTable
                data={claims}
                hasMore={hasMore}
                isLoadingMore={loadingMore}
                onLoadMore={() => loadClaims(false)}
              />
            )}
            {claimsLoadMs !== null ? <div className="load-meta">Loaded in {claimsLoadMs} ms</div> : null}
          </section>
        </>
      ) : activeTab === 'perf' ? (
        <section className="panel">
          <h2>Optimization Impact</h2>
          <p>Run backend benchmarks to populate this report and validate index improvements.</p>
          <PerfPanel report={perf} loading={perfLoading} loadMs={perfLoadMs} />
        </section>
      ) : (
        <section className="panel">
          <h2>Slow Queries (MongoDB Profiler)</h2>
          <div className="filters">
            <label>
              Keyword
              <input value={slowFilters.keyword} onChange={(e) => updateSlowFilter('keyword', e.target.value)} placeholder="Namespace, plan, command" />
            </label>
            <label>
              Min Duration
              <select value={slowFilters.minMs} onChange={(e) => updateSlowFilter('minMs', e.target.value)}>
                <option value="1000">≥ 1s</option>
                <option value="2000">≥ 2s</option>
                <option value="5000">≥ 5s</option>
                <option value="10000">≥ 10s</option>
              </select>
            </label>
            <label>
              Start Date
              <input type="date" value={slowFilters.startDate} onChange={(e) => updateSlowFilter('startDate', e.target.value)} />
            </label>
            <label>
              End Date
              <input type="date" value={slowFilters.endDate} onChange={(e) => updateSlowFilter('endDate', e.target.value)} />
            </label>
            <label>
              Actions
              <button className="tab" type="button" onClick={handleClearSlowOps} disabled={slowOpsClearLoading}>
                {slowOpsClearLoading ? 'Clearing...' : 'Clear Results'}
              </button>
            </label>
          </div>

          {slowOpsLoading ? (
            <div>Loading...</div>
          ) : (
            <>
              {slowOpsLoadMs !== null ? <div className="load-meta">Loaded in {slowOpsLoadMs} ms</div> : null}
              {slowOpsMeta?.message ? <div className="load-meta">{String(slowOpsMeta.message)}</div> : null}
              {slowOps.length > 0 ? (
                <SlowOpsTable data={slowOps} onSelect={setSelectedSlowOp} />
              ) : (
                <div className="load-meta">No queries match the current filters.</div>
              )}
            </>
          )}
        </section>
      )}

      {selectedSlowOp ? (
        <div className="modal-backdrop" onClick={() => setSelectedSlowOp(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Slow Query Details</h3>
              <button className="tab" onClick={() => setSelectedSlowOp(null)}>Close</button>
            </div>
            <pre>{JSON.stringify(formatSlowOpDetails(selectedSlowOp), null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
