# Health Claims Performance Lab

Demo application showcasing high-volume MongoDB workloads with a modern, data-rich React UI. It includes seed generation/loading, index tooling, benchmarks, slow query profiling, and real-time portfolio summaries via change streams.

## Stack
- Frontend: React + TypeScript + Vite
- Backend: NestJS + MongoDB driver
- Database: MongoDB (replica set for change streams)

## Quick Start (Dev)
1. Start MongoDB (replica set):
```bash
docker-compose up -d
```

2. Install deps:
```bash
cd backend
npm install
cd ../frontend
npm install
```

3. Configure backend:
```bash
cd backend
cp .env.example .env
```

4. Seed data:
```bash
cd backend
npm run seed -- --scale=small --reset
```

5. Run backend and frontend:
```bash
cd backend
npm run start:dev
```

```bash
cd frontend
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:3001/api`

## Seed Data
Direct seed (single process, faster for small datasets):
```bash
cd backend
npm run seed -- --scale=small --reset
npm run seed -- --scale=large --reset
npm run seed -- --scale=xl --reset
```

Generate once, load many (recommended for large datasets):
```bash
cd backend
npm run seed:generate -- --scale=large --out=seed-data
npm run seed:load -- --out=seed-data --reset --concurrency=4
```

Seed generator options:
- `--scale=small|large|xl`
- `--out=seed-data`
- `--max-files=10`
- `--claims-per-file=500000`
- `--concurrency=<workers>`
- `--force`

Seed loader options:
- `--out=seed-data`
- `--reset`
- `--concurrency=<workers>`

## Indexes
Build indexes sequentially with logs and optional rebuild:
```bash
cd backend
INDEX_BUILD_MEM_MB=4096 npm run indexes
```

Indexes options:
- `--rebuild` rebuild matching indexes
- `--abort-in-progress` attempts to kill in-progress index builds
- `--only=serviceDate,status,region,text`

Behavior:
- Detects stale index definitions by name and rebuilds.
- Verifies expected indexes at the end.

## Benchmarks
```bash
cd backend
npm run bench
```

Benchmark options:
- `BENCH_MAX_MS=15000` max time per query
- `BENCH_SKIP_EXPLAIN=1` skip explain stats
- `BENCH_BASELINE_NATURAL=0` disable `$natural` baseline hint

Output:
- `backend/reports/last-report.json`  
Includes index health, index lists before/after, dataset count delta, and warnings.

## Portfolio Summary (Change Streams)
Summary is materialized and updated incrementally from claim inserts.

Env flags:
- `SUMMARY_BOOTSTRAP_ON_START=1` runs one-time backfill if summary data is missing
- `CLAIM_INSERT_ENABLED=1` inserts a few new claims every 15s (demo job)
- `CLAIM_INSERT_INTERVAL_MS=15000`
- `CLAIM_INSERT_BATCH=5`

If you want zero full scans on startup, set `SUMMARY_BOOTSTRAP_ON_START=0`.

## Slow Query Profiling
Enable profiling in `.env`:
```bash
PROFILER_ENABLED=1
PROFILER_SLOW_MS=1000
```

Endpoints:
- `GET /api/stats/slow-ops` with filters
- `DELETE /api/stats/slow-ops` clears captured entries

## API Endpoints
- `GET /api/claims` with filters and cursor pagination
- `GET /api/claims/:id`
- `GET /api/stats/summary`
- `GET /api/stats/slow-ops`
- `DELETE /api/stats/slow-ops`

## Production Compose
Build and run:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
Compose reads `.env` from the repo root (same directory as `docker-compose.prod.yml`), not `backend/.env`.

Services:
- MongoDB: `mongodb:27017`
- Backend: `http://localhost:3001`
- Frontend: `http://localhost:8080`

Frontend proxies `/api` and `/socket.io` to the backend.
Set `FRONTEND_BASE_PATH` in root `.env` to host the frontend under a subpath (for example `FRONTEND_BASE_PATH=/dashboard`).
The same variable is used for Vite build-time base URLs and Nginx runtime routing template.
When `FRONTEND_BASE_PATH` is not `/`, frontend API and websocket defaults are prefixed too (`/dashboard/api`, `/dashboard/socket.io`).

Important for prod `.env`:
- Set `MONGODB_URI` to the service hostname, not localhost, e.g.  
  `MONGODB_URI=mongodb://mongodb:27017/?replicaSet=rs0`
- If running MongoDB in Compose, set `MONGO_REPLICA_HOST=mongodb:27017` so the replica set advertises the correct host.
- Optional frontend path prefix: `FRONTEND_BASE_PATH=/` (default) or `FRONTEND_BASE_PATH=/dashboard`
- `FRONTEND_BASE_PATH` is normalized on startup, so `dashboard` and `/dashboard/` are treated as `/dashboard`
- Optional frontend API/socket overrides (build-time): `VITE_API_URL=...`, `VITE_WS_URL=...`
- Frontend `VITE_*` values are baked into static assets at image build time, so run with rebuild when `.env` changes:
  `docker compose -f docker-compose.prod.yml up -d --build`
- For subpath deployments, `/` redirects to `${FRONTEND_BASE_PATH}/` (for example `/dashboard/`).

## Import/Export With Compression
Export:
```bash
docker compose -f docker-compose.prod.yml exec -T mongodb \
  mongodump --db health_claims --archive --gzip \
  > health_claims.archive.gz
```

Import:
```bash
cat health_claims.archive.gz | docker compose -f docker-compose.prod.yml exec -T mongodb \
  mongorestore --archive --gzip --drop
```

## Commands (Backend)
```bash
npm run start:dev
npm run build
npm run seed
npm run seed:generate
npm run seed:load
npm run indexes
npm run bench
```

## Commands (Frontend)
```bash
npm run dev
npm run build
```
