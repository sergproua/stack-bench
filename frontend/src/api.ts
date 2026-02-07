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
    total: number;
    sortBy: string;
    sortDir: string;
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

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export async function fetchClaims(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_URL}/claims?${query}`);
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
