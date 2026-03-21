# Admin Setup Guide — School Configuration

This guide walks a school administrator through the full configuration of a new EMS school from initial provisioning to a fully operational system.

---

## Overview

School setup follows two phases:

| Phase | Who | What |
|-------|-----|-------|
| **Phase 1 — Provisioning** | Super Admin | Create the school account and admin user |
| **Phase 2 — Onboarding** | School Admin | Configure the 7 required setup steps |

After completing both phases the school is operational and ready for daily use.

---

## Phase 1 — Super Admin: Provision the School

> **Requires:** Super Admin credentials

### Step 1.1 — Create the School

`POST /api/superAdmin/schools`

```json
{
  "schoolName": "Springfield Academy",
  "adminEmail": "admin@springfieldacademy.edu",
  "adminName": "Dr. Jane Smith",
  "address": "123 Elm Street, Springfield",
  "phone": "9876543210"
}
```

The system automatically:
- Generates a unique `schoolCode` (e.g. `SPRI001`)
- Creates a `SchoolSettings` document with defaults
- Creates the admin user with a temporary password (emailed to `adminEmail`)
- Provisions default resources: common subjects, permission roles

**Response includes:** `schoolId`, `schoolCode`, `adminUserId`, `temporaryPassword`

### Step 1.2 — (Optional) Provision Default Resources

If the school needs a pre-loaded set of classes, subjects, or fee heads:

`POST /api/superAdmin/schools/:schoolId/provision`

```json
{
  "classes": true,
  "subjects": true,
  "feeHeads": true
}
```

---

## Phase 2 — School Admin: 7-Step Onboarding

> **Requires:** School Admin login
>
> The onboarding checklist is visible on the dashboard until all 7 steps are complete. Each step can also be completed later via **Settings**.

Track progress at any time:

`GET /api/settings/onboarding-status`

Returns completion status for each of the 7 steps.

---

### Step 1 — School Profile

**Dashboard:** Settings → Institution Settings

**What to configure:**
- School name, address, phone number, email, website
- Logo (upload PNG/JPG)
- Board of education: `CBSE` | `ICSE` | `StateBoard` | `IB` | `IGCSE` | `Custom`
- UDISE number and affiliation number (optional, required for report cards)
- Primary and secondary brand colors (hex format, e.g. `#1A73E8`)
- Principal signature image (used on report cards and certificates)

**API:** `PUT /api/settings/school`

**Minimum required fields:** `schoolName`, `address`, `phone`

> Selecting a **board of education** automatically loads preset grading scales and exam defaults for that board. You can override these in Step 2.

---

### Step 2 — Academic Year

**Dashboard:** Settings → Academic Settings

**What to configure:**
- Academic year in `YYYY-YY` format (e.g. `2025-26`)
- Session start date and end date
- Exam terms (e.g. Term 1, Term 2, Annual)
- Exam types (e.g. Unit Test, Half-Yearly, Final)
- Default max marks, passing marks, exam duration
- Grading scale (minimum percentage → grade label)

**API:** `PUT /api/settings/academic-year`

```json
{
  "academicYear": "2025-26",
  "academicYearStart": "2025-04-01",
  "academicYearEnd": "2026-03-31"
}
```

> **Warning:** Changing the academic year mid-session affects fee structures and exam data. Use `GET /api/settings/academic-year/transition-preview` to see the impact before switching.

---

### Step 3 — Classes

**Dashboard:** Classes → Add Class

**What to configure:**
- Class names (e.g. Grade 1, Class 6, Nursery)
- Sections per class (e.g. A, B, C)
- Class capacity (optional)
- Assign class teacher (can be done after adding staff)
- Subjects for each class

**API:** `POST /api/classes`

```json
{
  "name": "Grade 5",
  "section": "A",
  "capacity": 40
}
```

Repeat for every class and section combination.

> You can also use **Bulk Import** (Data Tools → Import) to upload all classes from a CSV.

---

### Step 4 — Fee Heads

**Dashboard:** Settings → Fee Heads

Fee heads define the types of fees collected (e.g. Tuition Fee, Transport Fee, Uniform Fee).

**What to configure:**
- Fee head name
- Fee head type: `tuition` | `transport` | `hostel` | `uniform` | `exam` | `library` | `other`
- Whether it is mandatory or optional
- Whether it is recurring (per term/month) or one-time

**API:** `POST /api/settings/fee-heads`

```json
{
  "name": "Tuition Fee",
  "type": "tuition",
  "isMandatory": true,
  "isRecurring": true
}
```

> Add all fee head types before assigning fee structures to students. Fee heads cannot be deleted once student fee records reference them.

---

### Step 5 — Students

**Dashboard:** Students → Add Student  or  Data Tools → Bulk Import

**What to configure per student:**
- Full name, date of birth, gender
- Admission number (auto-generated or manual)
- Class and section assignment
- Parent/guardian contact details (name, phone, email)
- Aadhaar number (optional)
- Address

**Bulk import:** Upload a CSV with headers matching the student fields. Template available at Data Tools → Import → Download Template.

**API (single):** `POST /api/students`

> Every student document is automatically scoped to the school (`schoolId`). Students without a class assignment will not appear in class-level reports.

---

### Step 6 — Staff

**Dashboard:** Staff → Add Staff Member

**What to configure per staff member:**
- Full name, phone, email
- Role: `teacher` | `admin` | `accountant` | `librarian` | `support`
- Department (optional)
- Staff ID (auto-generated based on prefix configured in Settings → Staff ID)
- Subjects taught and classes assigned
- Salary details (if using payroll)

**API:** `POST /api/staff`

```json
{
  "name": "Mr. Ramesh Kumar",
  "phone": "9876543210",
  "email": "ramesh@school.edu",
  "role": "teacher"
}
```

After adding staff, return to **Step 3** to assign class teachers to each class.

---

### Step 7 — Notifications

**Dashboard:** Settings → Communication Settings

**What to configure:**
- SMS provider: Twilio, MSG91, or similar (API key + sender ID)
- Email provider: SMTP credentials or SendGrid/AWS SES API key
- Custom email domain (optional): configure DKIM, SPF, DMARC records for your domain

**Verify custom email domain (optional):**

```
POST /api/settings/email-domain/verify
```

Returns DNS record verification status. Add the provided TXT records to your domain's DNS before verifying.

**Enable notification categories:**
- Attendance alerts (absent notification to parents)
- Fee due/overdue reminders
- Result publication alerts
- Remark notifications

> Notifications require at least one SMS or email provider to be configured. Without this, system notifications will only appear in the in-app notification center.

---

## Post-Onboarding Configuration

These steps are optional at setup time but recommended before the school goes fully live.

### Holidays

**Dashboard:** Settings → Holiday Settings

Add public holidays and school vacation dates. These are used by the attendance module to exclude non-working days.

`POST /api/settings/holidays`

```json
{
  "name": "Republic Day",
  "startDate": "2026-01-26",
  "endDate": "2026-01-26"
}
```

---

### Leave Types

**Dashboard:** Settings → Leave Settings

Define leave categories for staff (e.g. Casual Leave, Sick Leave, Earned Leave) and set maximum days per year.

`POST /api/settings/leave-types`

---

### User Roles & Permissions

**Dashboard:** Settings → Roles & Access

Review and customise what each role (admin, teacher, accountant, etc.) can see and do. The system ships with sensible defaults; adjust only what the school's policy requires.

---

### Attendance Rules

**Dashboard:** Settings → Attendance Rules

Configure:
- Attendance window (time after which absent is auto-marked)
- Whether to allow retroactive marking
- Minimum attendance percentage for eligibility warnings

---

### Payroll Configuration

**Dashboard:** Settings → Payroll Settings

Set the payroll cycle (monthly/bi-monthly), define salary components (Basic, HRA, DA, PF, etc.) and create salary templates before running the first payroll.

---

### Demo / Test Data

To populate the school with realistic sample data before go-live testing:

`POST /api/seed`

```json
{
  "categories": ["classes", "students", "staff", "attendance", "fees"]
}
```

> Use only in staging/test environments. Seed data cannot be selectively undone; use Settings → Trash to recover or manually delete records.

---

## Onboarding Progress API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/settings/onboarding-status` | GET | Get completion status for all 7 steps |
| `/api/settings/onboarding-progress` | PUT | Mark a step complete/incomplete |
| `/api/settings/school` | GET / PUT | School profile |
| `/api/settings/academic-year` | GET / PUT | Academic year and dates |
| `/api/settings/academic-year/transition-preview` | GET | Preview impact of year change |
| `/api/settings/fee-heads` | GET / POST | Fee head management |
| `/api/settings/holidays` | GET / POST | Holiday management |
| `/api/settings/leave-types` | GET / POST | Leave type management |
| `/api/settings/subjects` | GET / POST | Subject management |
| `/api/settings/email-domain` | GET / POST | Custom email domain setup |
| `/api/settings/email-domain/verify` | POST | Verify DNS records |

---

## Troubleshooting

### Students not appearing in class reports
Verify the student document has both `classId` and `schoolId` set. Run:

```
GET /api/classes/:classId/students
```

If the list is empty but students exist, check that `schoolId` on those student documents matches the authenticated school.

### Onboarding step not marking complete
The system auto-detects completion by querying counts. If a step shows incomplete after adding data:
- **Classes:** Ensure at least one class exists with `isDeleted: { $ne: true }`
- **Fee Heads:** Ensure at least one active fee head exists
- **Students / Staff:** Ensure at least one active record exists

### Email domain verification failing
1. Add all three DNS records (DKIM TXT, SPF TXT, DMARC TXT) provided by the system to your domain registrar.
2. Allow up to 48 hours for DNS propagation.
3. Re-run `POST /api/settings/email-domain/verify`.

### Academic year transition warnings
Before switching years, use `GET /api/settings/academic-year/transition-preview` to review:
- Students with unpaid balances
- Active or unpublished exams
- Incomplete attendance records

Resolve all warnings before completing the transition.
