# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EMS (Education Management System) — a multi-tenant SaaS platform for schools. Three client apps talk to one backend:

- **Backend**: `EMS-backend/` — Node.js/Express/MongoDB/Socket.IO (ES modules, `"type": "module"`)
- **Dashboard**: `EMS/school-dashboard/` — React 19 + Vite 6 + Tailwind CSS 4 + HeroUI + TanStack Query
- **Parent App**: `EMS/parent-app/` — React Native + Expo 52
- **Staff App**: `EMS/staff-app/` — React Native + Expo 52
- **Analytics**: `owlin-server/` — TypeScript Express + Turso/LibSQL

## Commands

### Backend (`EMS-backend/`)

```bash
npm run dev                 # Dev server with --watch (:3001)
npm start                   # Production start (node start.js)
npm test                    # Vitest single run
npm run test:watch          # Vitest watch mode
npm run test:coverage       # Coverage report
npm run lint                # ESLint
npm run format              # Prettier
npm run migrate             # Run DB migrations (up|down|status|dry-run)
npm run migrate:indexes     # Sync MongoDB indexes
npm run create:admin        # Bootstrap first admin user
npm run tenant:bootstrap    # Setup default school tenant
```

Tests use **Vitest + Supertest + mongodb-memory-server** (no external DB required). Test files: `tests/*.unit.test.js`, `tests/*.routes.test.js`.

### Dashboard (`EMS/school-dashboard/`)

```bash
npm run dev                 # Vite dev server (:5173)
npm run build               # Production build → dist/
npm test                    # Playwright E2E (Chromium, Firefox, WebKit, mobile)
npm run test:unit           # Vitest unit tests
npm run test:watch          # Vitest watch mode
npm run lint                # ESLint
```

### Mobile Apps

```bash
cd EMS/parent-app && npm start   # Expo dev server
cd EMS/staff-app && npm start    # Expo dev server
```

### Docker (full stack)

```bash
docker compose up -d                           # MongoDB + Redis + backend
docker compose exec backend node scripts/createAdmin.js  # First admin
```

## Environment Setup

Backend requires `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (64+ char minimum, validated at startup via Zod in `config/environment.js`). Copy `.env.example` to `.env`. Optional: `REDIS_URL`, `CLOUDINARY_*`, `RAZORPAY_*`, `FIREBASE_*`, `MSG91_*`.

Dashboard needs `VITE_API_URL` (defaults to `http://localhost:3001/api` in dev). `VITE_SOCKET_URL` is auto-derived.

## Architecture

### Backend Startup & Middleware Chain

Entry: `start.js` → loads Sentry + dotenv → imports `server.js` (Express app, ~700 lines).

Middleware order: Helmet/CORS → body parsing (50MB limit) → request ID + tracing → i18n → API versioning → audit logging → business metrics → tenant rate limiting → **JWT auth** → route handlers.

### Multi-Tenancy (Critical Pattern)

Every MongoDB document has `schoolId`. All queries MUST be scoped via `buildSchoolScopedQuery(schoolId, baseQuery)` from `utils/schoolContext.js`. The `schoolId` comes from `req.user.schoolId` (JWT claims) — **never** from request body. Super-admins bypass scoping.

### Authentication

JWT in httpOnly cookies (8h access, 30d refresh). Also accepts `Authorization: Bearer <token>` header. Refresh via `POST /auth/refresh` with in-flight deduplication. API keys supported via `X-API-Key` header. Claims: `{ userId, role, userType, schoolId, groupId, email, name }`.

### Route Mounting

40+ route groups under `/api/v1/`. Legacy `/api/*` routes also served with deprecation + sunset headers. Key groups: `/auth`, `/students`, `/classes`, `/staff`, `/attendance`, `/academics`, `/fees`, `/messages`, `/notifications`, `/settings`, `/super-admin`.

### Database

Main schemas in `EMS-backend/database.js`, additional models in `EMS-backend/models/`. Mongoose with replica set failover (`retryWrites`, `w: majority`). **Agenda** for background jobs (reminders, expense cycles, SMS). Migrations in `migrations/`.

### Dashboard Patterns

- **API calls**: `request(endpoint, options)` in `services/api/core.js` — handles auth headers, token refresh dedup, request dedup for concurrent GETs, retry-after
- **Domain API modules**: `services/api/{staff,academics,classes,fees,operations,settings,extensions,permissions}.js`
- **Auth headers for raw fetch**: Use `getAuthHeaders()` from `utils/authSession.js` — the centralized `request()` handles this automatically, but direct `fetch()` calls must add it manually
- **Routing**: Lazy-loaded pages via `lazyWithRetry()` (auto-retries failed chunk loads). Code-split by vendor chunks in Vite config
- **State**: React Context (AppContext, AuthContext, PermissionContext) + TanStack Query for server state
- **Config validation**: `src/config/api.js` validates env before React mounts — renders plain DOM error page if invalid
- **Feature gates**: `FeatureGate` component enforces plan-based feature access

### Health Endpoints

- `GET /health` — full status (db, redis, memory)
- `GET /healthz` — liveness (process alive)
- `GET /readyz` — readiness (db connected)
- `GET /startupz` — startup complete

### Observability

Request ID correlation on every request. Error rate tracking feeds Sentry. Business metrics (DAU/MAU, feature adoption) flushed every 5 min. SLA monitor tracks p50/p95/p99 latency per endpoint. Slow query APM on MongoDB commands.

---

## Mandatory Zod Validation Rule

**This rule applies to ALL code changes — features, fixes, routes, and tests.**

### When Creating or Modifying Any Feature:
1. **Define a Zod schema FIRST** — Before writing any route handler or controller logic, define the Zod validation schema for the request body/params/query in `middleware/validation.js` (or a dedicated `validators/` directory).
2. **Validate incoming data** — Every POST/PUT/PATCH route MUST parse the request through the Zod schema before processing. Use `schema.parse(req.body)` or `schema.safeParse(req.body)` with proper error handling.
3. **Match Mongoose schema** — The Zod schema fields MUST mirror the Mongoose schema exactly (types, required fields, enums, nested objects). Any mismatch is a bug.
4. **Frontend validation** — When building forms, use the same Zod schema (or a shared version) for client-side validation before submission.

### When Testing Any Feature:
1. **Validate test payloads** — Test data sent to API endpoints MUST pass through the Zod schema. If test data doesn't match the schema, the test is invalid.
2. **Test validation boundaries** — Include tests for: missing required fields, wrong types, invalid enum values, out-of-range numbers, and malformed nested objects.
3. **Test error responses** — Verify that Zod validation errors return structured, descriptive error messages (not generic 500s).

### Zod over Joi:
- **Do NOT use Joi** for new code. All new validation must use **Zod**.
- When modifying existing Joi validation, migrate it to Zod in the same change.

---

## Every-Session Checklist — Common Bugs to Prevent

### 1. Missing `schoolId` on new documents (Multi-tenancy bug)
Every document in MongoDB MUST have a `schoolId` field set from `req.user.schoolId`. If it's missing, school-scoped queries (`buildSchoolScopedQuery`, `scopeBySchool`) will silently return empty results — making data appear "deleted" when it's actually just invisible.

### 2. Missing auth headers on frontend fetch calls
Every `fetch()` call to the backend API MUST include authentication headers. Use `getAuthHeaders()` from `utils/authSession.js`. The centralized `request()` in `services/api.js` handles this automatically — but any direct `fetch()` calls (common in settings pages) must add headers manually.

### 3. Backend returning 404 for "not yet created" data
When an entity is expected to be auto-created on first access (e.g., student fee structures), the GET endpoint should auto-initialize and return 200 — not return 404. Prefer returning a default/empty object with a `_initialized: false` flag over 404.

---

## Module Audit Protocol

When asked to "check", "audit", or "review" any module, execute **ALL** of the following checks exhaustively. Do not skip any step. Do not summarize without evidence. Every field, every route, every component must be traced end-to-end.

---

### PHASE 1: SCHEMA & MODEL AUDIT

#### 1.1 - Field Completeness
- [ ] Read the **Mongoose schema** in `database.js` or `models/` for the entity
- [ ] List **every single field** with its type, required status, default value, enum values, ref targets, and index participation
- [ ] Check for **subdocument schemas** and their fields
- [ ] Check **virtual fields** and **instance methods**
- [ ] Check **pre/post hooks** (save, validate, remove, findOneAndUpdate)
- [ ] Verify every `ref` points to a schema that actually exists
- [ ] Check if `timestamps: true` is set (createdAt/updatedAt auto-fields)

#### 1.2 - Index Audit
- [ ] List **every index** (compound, unique, sparse, partial)
- [ ] Verify unique indexes include `schoolId` for multi-tenancy
- [ ] Check if unique indexes handle `null` values correctly (MongoDB treats null as a value in unique indexes)
- [ ] Verify compound unique indexes won't block legitimate operations (e.g., soft-deleted records blocking new ones)
- [ ] Check for stale/orphaned indexes referencing paths that no longer exist in the schema
- [ ] Verify indexes match actual query patterns used in routes

#### 1.3 - Defaults & Enums
- [ ] Verify every `enum` array is consistent with what the frontend sends
- [ ] Check that `default` values make business sense (e.g., `status: 'passed'` should not be default for results)
- [ ] Verify `required` fields are truly required and won't block creation flows
- [ ] Check for fields with `unique: true` that might cause issues with soft deletes

#### 1.4 - Relations & References
- [ ] Map every `ref` field to its target collection
- [ ] Verify that when parent documents are deleted, child/referencing documents are cleaned up
- [ ] Check for circular references
- [ ] Verify `populate()` calls in routes match the actual ref field names
- [ ] Check if orphan documents can be created (e.g., student referencing a deleted class)

---

### PHASE 2: VALIDATION LAYER AUDIT

#### 2.1 - Zod Validation Schemas
- [ ] Read the Zod validation schema in `middleware/validation.js` (or `validators/`) for the entity
- [ ] If the entity still uses Joi, flag it for migration to Zod
- [ ] Compare **every field** in the Zod schema against the Mongoose schema - they must match
- [ ] Check for fields in Mongoose schema that are **missing from Zod** (will be silently stripped)
- [ ] Check for fields in Zod that are **missing from Mongoose** (will cause silent data loss or errors)
- [ ] Verify Zod type matches Mongoose type (e.g., `z.string()` for a `String` field, `z.number()` for `Number`)
- [ ] Check if Zod uses `.passthrough()` or `.strict()` - this affects which fields pass through
- [ ] Verify nested object/array validation matches subdocument schemas exactly
- [ ] Check document/file upload validation (e.g., Aadhaar front/back vs single URL patterns)

#### 2.2 - Business Rule Validation
- [ ] Check for server-side validation of numeric ranges (marks 0-100, amounts >= 0, etc.)
- [ ] Check for date validation (future dates, date ranges, academic year boundaries)
- [ ] Check for string length limits on text fields
- [ ] Check for phone number, email, and URL format validation
- [ ] Verify duplicate detection queries include proper scoping (`schoolId`, `academicYear`, `isDeleted`)

---

### PHASE 3: API ROUTE AUDIT

#### 3.1 - Route Registration & Middleware
- [ ] Read the route file in `routes/` for the entity
- [ ] Check how routes are mounted in `server.js` - verify the base path
- [ ] Verify **auth middleware** is applied to every route (not just the router level)
- [ ] Verify **permission middleware** is applied where needed (role-based access)
- [ ] Check for route parameter conflicts (e.g., `/:id` vs `/:studentId` shadowing)
- [ ] Check for duplicate routes serving the same purpose with different response shapes

#### 3.2 - CRUD Operations - CREATE
- [ ] Trace the full request body → validation → database save flow
- [ ] Verify **every field from the frontend** is included in the save operation
- [ ] Check if computed fields are set during creation (e.g., `feeStatus`, `totalFee`)
- [ ] Check if related documents are created/updated (e.g., creating a student should update class count)
- [ ] Verify `schoolId` is set from `req.user.schoolId` (not from request body)
- [ ] Check uniqueness validation includes `isDeleted: { $ne: true }` filter
- [ ] Check for race conditions on auto-generated IDs (admissionNo, rollNo, receiptNumber)
- [ ] Verify the response returns the created document with all fields

#### 3.3 - CRUD Operations - READ (List)
- [ ] Verify `schoolId` scoping on all queries (multi-tenancy security)
- [ ] Check pagination implementation (skip/limit, cursor-based)
- [ ] Check filter parameters match frontend filter UI options
- [ ] Verify `isDeleted: { $ne: true }` is applied (soft delete filtering)
- [ ] Check `populate()` calls return the fields the frontend needs
- [ ] Check sort order matches frontend expectations
- [ ] Verify search/text query implementation handles special characters safely

#### 3.4 - CRUD Operations - READ (Detail)
- [ ] Verify `schoolId` scoping
- [ ] Check all `populate()` chains return necessary related data
- [ ] Verify the response shape matches what the frontend destructures
- [ ] Check if sensitive fields are excluded from the response

#### 3.5 - CRUD Operations - UPDATE
- [ ] Trace request body → validation → update flow for every field
- [ ] Check if updating a key field triggers cascading updates (e.g., changing classId should update fee structures)
- [ ] Verify the update doesn't silently drop fields (e.g., `$set` with partial object overwrites embedded docs)
- [ ] Check for duplicate `$set` keys in MongoDB update objects (JS object duplicate keys = last wins)
- [ ] Verify optimistic concurrency control if applicable
- [ ] Check if status transitions are validated (e.g., can't go from 'inactive' back to 'active' without checks)

#### 3.6 - CRUD Operations - DELETE
- [ ] Check if it's soft delete (`isDeleted: true`) or hard delete
- [ ] Verify cascading cleanup of related documents (child records, references in other collections)
- [ ] Check if the delete verifies no dependent active records exist before proceeding
- [ ] Verify the response confirms what was deleted

#### 3.7 - Special/Business Endpoints
- [ ] Check publish/approve/reject workflows update ALL related documents (not just the primary one)
- [ ] Verify bulk operations handle partial failures correctly (some succeed, some fail)
- [ ] Check computed field recalculation endpoints update ALL affected records
- [ ] Verify assignment/linking endpoints update both sides of the relationship
- [ ] Check if notification/alert triggers exist where expected (email, SMS, push, socket)

#### 3.8 - Security Checks
- [ ] Every route must scope queries by `schoolId` from `req.user` (NEVER from request body/params)
- [ ] Check for horizontal privilege escalation (user A accessing user B's data within same school)
- [ ] Check for vertical privilege escalation (teacher accessing admin-only endpoints)
- [ ] Verify file upload endpoints validate file types and sizes
- [ ] Check for NoSQL injection in query parameters (e.g., `req.query` passed directly to MongoDB)
- [ ] Verify sensitive data (passwords, tokens) is never returned in responses

---

### PHASE 4: FRONTEND AUDIT (School Dashboard)

#### 4.1 - Page/Component Discovery
- [ ] Find ALL pages in `school-dashboard/src/pages/` related to the module
- [ ] Find ALL components in `school-dashboard/src/components/` related to the module
- [ ] Find ALL modals, drawers, tabs, and sub-components
- [ ] Find ALL hooks and context providers related to the module
- [ ] Find the API service file that makes HTTP calls for this module

#### 4.2 - Form Field Completeness
- [ ] List every form field in Create/Add forms
- [ ] List every form field in Edit/Update forms
- [ ] Compare form fields against Mongoose schema - **every schema field should have a corresponding form field** (or documented reason for exclusion)
- [ ] Check for fields collected in form state but **never included in the submission payload**
- [ ] Check for fields in the submission payload that **don't exist in the schema** (will be stripped or cause errors)
- [ ] Verify field types match (number inputs for number fields, date pickers for dates, etc.)
- [ ] Check form validation rules match backend Zod validation
- [ ] Verify required field indicators match backend required fields
- [ ] Check dropdown/select options match backend enum values exactly (including case)

#### 4.3 - Data Display Completeness
- [ ] Check list/table views display all important fields
- [ ] Check detail/dashboard views display all fields from the schema
- [ ] Verify field names used in frontend destructuring match the backend response field names exactly
- [ ] Check for hardcoded/fake data that should be dynamic (common in MVPs)
- [ ] Verify date formatting is consistent
- [ ] Check number formatting (currency, percentages, decimals)
- [ ] Verify status badges/colors match all possible backend enum values
- [ ] Check empty state handling (what shows when there's no data)

#### 4.4 - API Integration
- [ ] Verify API base URLs and endpoints match backend route paths
- [ ] Check request payload structure matches what backend expects
- [ ] Check response destructuring matches what backend actually returns
- [ ] Verify error handling for all API calls (try/catch, error toasts)
- [ ] Check loading states during API calls
- [ ] Verify pagination parameters are sent correctly
- [ ] Check filter/search parameters match backend query param names

#### 4.5 - State Management
- [ ] Verify data is refreshed after create/update/delete operations
- [ ] Check for stale data issues (caching old values after mutations)
- [ ] Verify optimistic updates are rolled back on error
- [ ] Check if related data is refreshed when dependencies change (e.g., class change refreshes student list)

#### 4.6 - UI/UX Logic
- [ ] Verify conditional rendering matches business rules (e.g., show "Publish" only for draft exams)
- [ ] Check button click handlers actually call APIs (not just show toasts)
- [ ] Verify confirmation dialogs for destructive actions
- [ ] Check that disabled/readonly states are applied correctly
- [ ] Verify navigation flows after successful operations (redirects, drawer closes, etc.)

---

### PHASE 5: MOBILE APP AUDIT (Parent App & Staff App)

#### 5.1 - Parent App (`/EMS/parent-app/`)
- [ ] Find all screens in `parent-app/src/screens/` related to the module
- [ ] Read the corresponding backend routes in `parentData.js`, `parentAuth.js`, `parentMessaging.js`
- [ ] Verify the parent API endpoints apply proper scoping (parent can only see their children's data)
- [ ] Check field names in the screen components match the backend response exactly
- [ ] Verify privacy filters are applied (e.g., `sentToParent: true` for remarks, `isPublished: true` for results)
- [ ] Check status enums/values match between app and backend
- [ ] Verify data displayed matches what parents should be authorized to see
- [ ] Check offline/error handling

#### 5.2 - Staff App (`/EMS/staff-app/`)
- [ ] Find all screens in `staff-app/src/screens/` related to the module
- [ ] Read the corresponding backend routes (may use `mobile.js` or standard routes)
- [ ] Verify staff can only access their assigned classes/subjects
- [ ] Check field names in screens match backend response
- [ ] Verify create/update flows from staff app match the same validation as dashboard
- [ ] Check for field name differences (e.g., `rollNo` vs `rollNumber`)

---

### PHASE 6: CROSS-MODULE INTEGRATION AUDIT

#### 6.1 - Data Flow Between Modules
- [ ] When a student is created → is the class student count updated?
- [ ] When a student changes class → are fee structures migrated/deleted correctly?
- [ ] When a class teacher is assigned → are both Class and Staff documents updated?
- [ ] When an exam is published → are all Result documents updated?
- [ ] When a payment is recorded → are Student, StudentFeeStructure, and FeePayment all updated?
- [ ] When a student is deleted → are attendance, results, remarks, fee records cleaned up?
- [ ] When a class is deleted → are students, timetables, exams, fee structures handled?
- [ ] When a staff member is deleted → are class teacher assignments, timetables cleaned up?

#### 6.2 - Computed Field Consistency
- [ ] Verify percentage/grade/rank are computed and stored (not just displayed client-side)
- [ ] Verify fee totals (totalFee, paidAmount, balanceAmount) are recalculated on every relevant change
- [ ] Verify attendance statistics are consistent across all endpoints that compute them
- [ ] Check that summary/aggregate fields are updated when underlying data changes

#### 6.3 - Notification Triggers
- [ ] When results are published → are parents notified?
- [ ] When remarks are sent to parent → is a notification triggered?
- [ ] When fees are due/overdue → are reminders sent?
- [ ] When attendance is marked absent → are parents notified?
- [ ] Verify socket events are emitted for real-time updates where expected

#### 6.4 - Academic Year Scoping
- [ ] Verify all queries filter by `academicYear` where applicable
- [ ] Check that the academic year value is consistent between frontend and backend
- [ ] Verify year transition doesn't break active data (e.g., mid-year class changes)

---

### PHASE 7: MULTI-TENANCY & SECURITY AUDIT

#### 7.1 - School Isolation
- [ ] **Every single database query** must include `schoolId` scoping
- [ ] `schoolId` must come from `req.user.schoolId` (authenticated session), NEVER from request body
- [ ] Check all route files for queries missing `scopeBySchool()` or manual `schoolId` filter
- [ ] Verify unique indexes include `schoolId` where two schools could have same values
- [ ] Check aggregate pipelines include `$match` on `schoolId`

#### 7.2 - Role-Based Access
- [ ] Verify admin-only routes are protected by role middleware
- [ ] Verify teachers can only access their assigned classes
- [ ] Verify parents can only access their linked children's data
- [ ] Check for endpoints that return data for all students without proper role filtering

---

### PHASE 8: ERROR HANDLING & EDGE CASES

#### 8.1 - Error Responses
- [ ] Verify all routes have try/catch with proper error responses
- [ ] Check that validation errors return descriptive messages
- [ ] Verify 404 responses for non-existent resources
- [ ] Check that internal errors don't leak stack traces or sensitive info

#### 8.2 - Edge Cases
- [ ] What happens when a referenced document is deleted? (orphan handling)
- [ ] What happens with empty arrays/objects in bulk operations?
- [ ] What happens when required fields are null/undefined?
- [ ] What happens with concurrent updates to the same document?
- [ ] What happens when a student has no class assigned?
- [ ] What happens at academic year boundaries?

---

## Audit Output Format

```
## [Module Name] Audit Report

### Summary
- Total issues: X
- Critical: X | High: X | Medium: X | Low: X

### Issues

#### ISSUE [N] - [SEVERITY] - [Short Title]
- **File:** `path/to/file.js:line_number`
- **What:** Description of the problem
- **Expected:** What should happen
- **Actual:** What currently happens
- **Impact:** Who/what is affected
- **Fix:** Recommended fix approach
```

Severity: **CRITICAL** = data loss/security/feature broken | **HIGH** = partially broken/data risk | **MEDIUM** = inconsistent behavior | **LOW** = code quality/edge cases

---

## Quick Module Reference

| Module | Schema Location | Routes | Dashboard Pages | Parent App | Staff App |
|--------|----------------|--------|-----------------|------------|-----------|
| Students | `database.js` | `students.js` | `pages/students/` | via `parentData.js` | `screens/students/` |
| Classes | `database.js` | `classes.js`, `classesEnhanced.js` | `pages/classes/` | - | `screens/classes/` |
| Attendance | `database.js` | `attendance.js` | `pages/classes/Attendance.jsx`, `pages/students/StudentAttendance.jsx` | `AttendanceScreen.jsx` | `screens/classes/AttendanceScreen.jsx` |
| Academics | `database.js` | `academics.js` | `pages/academics/` | `ExamDetailScreen.jsx`, `ResultDetailScreen.jsx` | `screens/exams/` |
| Fees | `database.js`, `models/FeeHead.js`, `models/StudentFeeStructure.js` | `fees.js`, `studentFees.js`, `feeStructure.js`, `feeTemplates.js`, `feeHeads.js`, `feeSettings.js` | `pages/fees/` | `FeesScreen.jsx`, `PaymentScreen.jsx` | - |
| Remarks | `models/Remark.js` | `students.js` (nested) | `components/modals/WriteRemarkModal.jsx`, `components/tabs/RemarksTab.jsx` | `RemarksScreen.jsx` | - |
| Staff | `database.js` | `staff.js`, `staffAttendance.js` | `pages/staffs/` | - | `screens/` |
| Timetable | `database.js` | `timetable.js`, `teacherTimetable.js` | `pages/classes/Timetable.jsx` | `TimetableScreen.jsx` | - |
| Front Desk | `database.js`, `models/GatePass.js`, `models/Visitor.js` | `frontDesk.js`, `visitors.js`, `gatePasses.js` | `pages/front-desk/` | - | - |
| Messages | `database.js`, `models/Message.js`, `models/Conversation.js` | `messages.js`, `announcements.js` | `pages/messaging/` | `ChatListScreen.jsx` | `ChatScreen.jsx` |
| Payroll | `database.js`, `models/PayrollRecord.js` | `payroll.js` | `pages/accounts/` | - | `PayslipsScreen.jsx` |
| Settings | Various | `settings.js`, `permissions.js` | `pages/settings/` | - | - |
| Notifications | `models/Notification.js`, `models/NotificationPreference.js` | `notifications.js` | `pages/messaging/Notifications.jsx` | `NotificationSettingsScreen.jsx` | `NotificationsScreen.jsx` |
