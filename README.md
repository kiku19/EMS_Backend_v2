# EMS Backend

[![Backend CI](https://github.com/dinesh4720/EMS-backend/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dinesh4720/EMS-backend/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/dinesh4720/EMS-backend/branch/main/graph/badge.svg)](https://codecov.io/gh/dinesh4720/EMS-backend)

Backend API for the EMS (Education Management System) platform.

## Tech Stack

- **Runtime:** Node.js 20+
- **Framework:** Express.js
- **Database:** MongoDB with Mongoose
- **Testing:** Vitest
- **Linting:** ESLint + Prettier

## Getting Started

```bash
# Install dependencies
npm ci

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Start development server
npm run dev
```

## Coverage

Coverage is collected for `routes/**/*.js` and `models/**/*.js` (plus `middleware`, `services`, and `utils`). The CI pipeline fails if coverage drops below **50%**.

## Scripts

| Script | Description |
|--------|-------------|
| `npm test` | Run unit tests |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |
