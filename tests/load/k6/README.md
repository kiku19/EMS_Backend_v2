# k6 Load Testing — EMS Backend

This directory contains [k6](https://k6.io/) load test scripts for the EMS backend.

## Prerequisites

```bash
# Install k6 (macOS)
brew install k6

# Install k6 (Linux)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

## Running Tests

```bash
# Run a single scenario against local dev server
BASE_URL=http://localhost:5000/api TOKEN=<admin_jwt> k6 run k6/auth.k6.js

# Run with HTML report output
k6 run --out json=results/auth-results.json k6/auth.k6.js

# Run smoke test (1 VU, 30s)
k6 run -e SCENARIO=smoke k6/full-suite.k6.js

# Run soak test (50 VUs, 30min)
k6 run -e SCENARIO=soak k6/full-suite.k6.js
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:5000/api` | EMS backend base URL |
| `TOKEN` | _(required)_ | Admin JWT token for authenticated routes |
| `PARENT_TOKEN` | _(optional)_ | Parent JWT for parent-app routes |
| `VUS` | `10` | Number of virtual users (overrides scenario default) |
| `DURATION` | `30s` | Test duration (overrides scenario default) |

## Test Files

| File | What it tests |
|------|--------------|
| `auth.k6.js` | Login, token refresh, logout |
| `students.k6.js` | Student list, search, create, update |
| `attendance.k6.js` | Mark attendance, bulk submit (peak hour) |
| `fees.k6.js` | Fee collection, receipt generation, reports |
| `full-suite.k6.js` | All modules combined with weighted distribution |

## Thresholds

All scripts enforce these thresholds (fail the test if exceeded):

- **Error rate:** < 1%
- **P95 response time:** < 2,000 ms
- **P99 response time:** < 5,000 ms
