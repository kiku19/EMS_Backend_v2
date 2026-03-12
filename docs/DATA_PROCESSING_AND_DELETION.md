# Student Data Processing and Deletion Register

Last updated: 2026-03-10

This file documents the main student-related personal data currently processed by the backend, the operational reason for processing it, and the baseline deletion behavior implemented in code. It is a technical register, not a legal determination.

## Data inventory

| Category | Example fields | Main storage locations | Operational purpose |
| --- | --- | --- | --- |
| Student identity | `name`, `admissionId`, `dateOfBirth`, `rollNo` | `Student` | enrollment, class rosters, profile lookups |
| Parent or guardian contacts | `parentName`, `parentPhone`, `parentEmail`, `parents[]` | `Student`, `Parent` | communication, pickup verification, emergency contact |
| Attendance | `date`, `status` | `Attendance` | attendance tracking and reporting |
| Academic outcomes | results, remarks, homework submissions | `Result`, `Remark`, `Homework` | academic performance and teacher feedback |
| Financial records | fee structure, payment, refund | `StudentFeeStructure`, `FeePayment`, `FeeRefund`, `FeeStructure` | billing, collection, reconciliation |
| Safety and welfare | `medicalConditions`, emergency contacts, gate pass and visitor links | `Student`, `GatePass`, `Visitor` | health response, campus access, pickup safety |
| Messaging | student-linked messages and conversations | `Message`, `Conversation` | school messaging workflows |
| Announcements and progress targeting | student recipient references | `ClassAnnouncement`, `ChapterProgress` | class communication and subject progress targeting |
| Intake workflow | approved student-linked form submissions | `FormSubmission` | intake and onboarding records |

## Permanent student deletion behavior

`DELETE /api/students/:id` now performs permanent deletion rather than moving the student into trash.

The deletion workflow currently:

1. Deletes the student profile.
2. Deletes linked personal records from attendance, results, remarks, fee structures, payments, refunds, form submissions, gate passes, visitor logs, and student-linked messages.
3. Removes student references from homework submissions, class announcements, chapter progress assignments, and fee structure assignment arrays.
4. Unlinks the student from parent accounts and deletes parent accounts that no longer have any children linked.
5. Removes any matching trash entries for that student.

## Operational notes

- This delete path is intended for validated erasure requests, not routine archival.
- The system still needs school-approved retention rules for cases where records must be preserved for statutory or audit reasons.
- Consent collection and retention enforcement are still open compliance tasks and are not solved by this file alone.
