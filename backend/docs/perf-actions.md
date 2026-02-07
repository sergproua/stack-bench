# Performance Actions (IT Runbook)

- Capture baseline query stats with `npm run bench` before applying indexes.
- Review `reports/last-report.json` for queries with highest `baselineMs` and `docsExamined`.
- Apply compound indexes aligned to filters and sorts:
  - `memberId + serviceDate`
  - `providerId + serviceDate`
  - `status + totalAmount`
- Use text index on `searchText` to avoid regex scans.
- For expensive aggregations, ensure early `$match` stages and consider `$project` to reduce payload.
- Re-run benchmarks and compare `improvement` ratios.
