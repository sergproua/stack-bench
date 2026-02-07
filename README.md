# Health Claims Performance Lab

Demo application showcasing high-volume MongoDB workloads with a modern, data-rich React UI.

## Stack
- Frontend: React + TypeScript + Vite
- Backend: NestJS + MongoDB driver
- Database: MongoDB

## Quick Start
1. Start MongoDB:

```bash
cd backend
cp .env.example .env
```

Optionally use Docker:

```bash
docker-compose up -d
```

2. Install dependencies:

```bash
cd backend
npm install
cd ../frontend
npm install
```

3. Seed data (500K or 5M):

```bash
cd backend
npm run seed -- --scale=small --reset
npm run seed -- --scale=large --reset
```

4. Run backend and frontend:

```bash
cd backend
npm run start:dev
```

```bash
cd frontend
npm run dev
```

5. Run performance benchmark:

```bash
cd backend
npm run bench
```

Reports are written to `backend/reports/last-report.json`.

## API Endpoints
- `GET /api/claims` with filters
- `GET /api/claims/:id`
- `GET /api/stats/summary`
- `GET /api/stats/slow-queries`

## Data Model
Collections: `members`, `providers`, `claims`, `payments`, `procedures`, `diagnoses`.

## Performance Workflow
1. Seed data
2. Run `npm run bench` to capture baseline and optimized metrics
3. Review `backend/docs/perf-actions.md` for tuning actions
