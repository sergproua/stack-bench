export type Claim = {
  _id: string;
  memberName: string;
  providerName: string;
  status: string;
  memberRegion: string;
  providerSpecialty: string;
  totalAmount: number;
  serviceDate: string;
};

export type ClaimsResponse = {
  data: Claim[];
  meta: {
    page: number;
    pageSize: number;
    total: number | null;
    sortBy: string;
    sortDir: string;
    hasMore: boolean | null;
    nextCursor: string | null;
    queryTimeMs: number;
  };
};

export type PerfReport = {
  data: Array<{
    label: string;
    baselineMs: number;
    optimizedMs: number;
    improvement: number;
    docsExamined?: number;
    keysExamined?: number;
    indexUsed?: string | null;
  }>;
  meta: Record<string, unknown>;
};

export type SlowOp = {
  ts?: string;
  millis?: number;
  op?: string;
  ns?: string;
  command?: Record<string, unknown>;
  planSummary?: string;
  nreturned?: number;
  keysExamined?: number;
  docsExamined?: number;
  responseLength?: number;
};

export type SlowOpsResponse = {
  data: SlowOp[];
  meta: Record<string, unknown>;
};

const DEFAULT_API_URL = (() => {
  if (import.meta.env.DEV) {
    return 'http://localhost:3001/api';
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api`;
  }
  return 'http://localhost:3001/api';
})();
const API_URL = import.meta.env.VITE_API_URL || DEFAULT_API_URL;

export async function fetchClaims(params: Record<string, string>, signal?: AbortSignal) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_URL}/claims?${query}`, { signal });
  if (!res.ok) {
    throw new Error('Failed to load claims');
  }
  return res.json() as Promise<ClaimsResponse>;
}

export async function fetchSummary() {
  const res = await fetch(`${API_URL}/stats/summary`);
  if (!res.ok) {
    throw new Error('Failed to load summary');
  }
  return res.json();
}

export async function fetchPerfReport() {
  const res = await fetch(`${API_URL}/stats/slow-queries`);
  if (!res.ok) {
    throw new Error('Failed to load performance report');
  }
  return res.json() as Promise<PerfReport>;
}

export async function fetchSlowOps(params: {
  minMs?: number;
  limit?: number;
  keyword?: string;
  startDate?: string;
  endDate?: string;
} = {}, signal?: AbortSignal) {
  const search = new URLSearchParams();
  if (params.minMs) {
    search.set('minMs', String(params.minMs));
  }
  if (params.limit) {
    search.set('limit', String(params.limit));
  }
  if (params.keyword) {
    search.set('keyword', params.keyword);
  }
  if (params.startDate) {
    search.set('startDate', params.startDate);
  }
  if (params.endDate) {
    search.set('endDate', params.endDate);
  }
  const res = await fetch(`${API_URL}/stats/slow-ops?${search.toString()}`, { signal });
  if (!res.ok) {
    throw new Error('Failed to load slow ops');
  }
  return res.json() as Promise<SlowOpsResponse>;
}

export async function clearSlowOps() {
  const res = await fetch(`${API_URL}/stats/slow-ops`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error('Failed to clear slow ops');
  }
  return res.json() as Promise<{ data: { deletedCount: number } }>;
}
