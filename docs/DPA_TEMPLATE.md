# Data Processing Agreement (DPA)

**Version:** 1.0
**Effective Date:** March 2026

---

## 1. Parties

This Data Processing Agreement ("DPA") is entered into between:

**Data Controller:** The School or Educational Institution ("School") that subscribes to and uses the EMS platform, identified by the account registered at onboarding.

**Data Processor:** The EMS platform operator ("Processor") that provides the Education Management System software-as-a-service.

Together referred to as the "Parties".

---

## 2. Definitions

- **Personal Data** — Any information relating to an identified or identifiable natural person (student, parent, staff member, or visitor) processed through the EMS platform.
- **Processing** — Any operation performed on Personal Data, including collection, storage, retrieval, use, disclosure, or deletion.
- **Data Subject** — The individual whose Personal Data is being processed (e.g., student, parent, staff).
- **Sub-processor** — Any third party engaged by the Processor to process Personal Data on behalf of the Controller.

---

## 3. Subject Matter and Duration

3.1 The Processor shall process Personal Data on behalf of the Controller solely for the purpose of providing the EMS platform services as described in the subscription agreement.

3.2 This DPA remains in effect for the duration of the subscription and terminates when the Controller's account is closed or upon written notice by either Party, subject to the data retention obligations in Section 9.

---

## 4. Nature and Purpose of Processing

The Processor processes Personal Data to enable the following core platform functions:

| Function | Data Categories |
|----------|----------------|
| Student enrollment and class management | Name, date of birth, admission ID, roll number, class assignment, address |
| Academic records | Exam results, remarks, homework submissions, attendance |
| Fee management | Fee structure, payment records, receipt history |
| Staff management | Name, contact details, role, subject assignments, attendance, payroll |
| Parent communication | Name, phone, email, relationship to student |
| Front desk and security | Visitor logs, gate passes, pickup authorization |
| Platform administration | Login credentials (hashed), session tokens, audit logs |

---

## 5. Categories of Data Subjects

- Students enrolled at the School
- Parents and guardians of enrolled students
- Teaching and non-teaching staff employed by the School
- Visitors to the School premises (via front-desk module)

---

## 6. Obligations of the Processor

The Processor shall:

6.1 **Process only on documented instructions** — Process Personal Data solely on the Controller's documented instructions, including as set out in this DPA, unless required to do so by applicable law.

6.2 **Confidentiality** — Ensure that authorized personnel are bound by appropriate confidentiality obligations with respect to the Personal Data.

6.3 **Security** — Implement and maintain appropriate technical and organizational security measures, including:
   - Encryption of Personal Data at rest (AES-256) and in transit (TLS 1.2+)
   - Role-based access control ensuring staff can only access data scoped to their school
   - Hashed password storage (bcrypt with minimum 10 rounds)
   - Audit logging for all administrative actions
   - Regular automated backups with point-in-time recovery capability

6.4 **Sub-processor management** — Notify the Controller before engaging new Sub-processors and include equivalent data protection obligations in Sub-processor agreements.

6.5 **Data subject rights** — Assist the Controller in responding to data subject rights requests (access, rectification, erasure, portability) using the GDPR tools provided within the platform.

6.6 **Breach notification** — Notify the Controller without undue delay (and within 72 hours where feasible) after becoming aware of a Personal Data breach affecting the Controller's data.

6.7 **Data Protection Impact Assessments** — Assist the Controller in carrying out DPIAs where required by applicable law.

6.8 **Audit and inspection** — Make available all information necessary to demonstrate compliance with this DPA and allow for audits conducted by the Controller or an auditor mandated by the Controller, subject to reasonable notice and confidentiality restrictions.

---

## 7. Obligations of the Controller

The Controller shall:

7.1 Ensure there is a lawful basis for processing Personal Data before inputting it into the platform.

7.2 Obtain necessary consents from data subjects (students, parents, staff) where required by applicable law.

7.3 Maintain accurate data and promptly update or delete records when no longer required.

7.4 Notify the Processor of any data subject rights requests that cannot be fulfilled using the platform's built-in tools.

7.5 Ensure that authorized users access the platform only over secure networks and do not share login credentials.

7.6 Configure data retention policies within the platform to comply with applicable statutory requirements.

---

## 8. Sub-processors

The following Sub-processors are currently engaged by the Processor and authorized by the Controller under this DPA:

| Sub-processor | Purpose | Location |
|---------------|---------|----------|
| MongoDB Atlas (MongoDB, Inc.) | Primary database hosting | India (ap-south-1) |
| Cloudinary (Cloudinary Ltd.) | File and image storage | Global CDN |
| Firebase (Google LLC) | Push notifications | Global |
| SendGrid / Twilio | Email and SMS delivery | Global |
| Redis Labs | Session caching and queues | India region |

The Controller may object to new Sub-processors within 14 days of notification. If the Controller objects and the Processor cannot accommodate the objection, the Controller may terminate the subscription with a pro-rata refund.

---

## 9. Data Retention and Deletion

9.1 The Processor retains Personal Data for the periods configured in the Controller's retention policy settings, with the following platform defaults:

| Data Category | Default Retention |
|---------------|------------------|
| Student records | 7 years |
| Staff records | 7 years |
| Attendance records | 3 years |
| Academic results | 5 years |
| Financial records | 7 years |
| Payroll records | 7 years |
| Messages | 1 year |
| Audit logs | 1 year |

9.2 Upon termination of the subscription, the Controller may export all data using the platform's export tools within 30 days. After 30 days, all Personal Data will be permanently deleted, except where retention is required by law.

9.3 The Controller may submit right-to-erasure requests within the platform, which are subject to a review and approval workflow before execution.

---

## 10. International Data Transfers

10.1 Personal Data is stored primarily on servers located in India.

10.2 Where Personal Data is transferred to Sub-processors outside India (e.g., for email delivery), the Processor shall ensure appropriate safeguards are in place in accordance with applicable data protection law.

---

## 11. Liability

11.1 Each Party shall be liable for its own non-compliance with applicable data protection law.

11.2 The Processor's liability under this DPA is limited as set out in the main subscription agreement.

---

## 12. Governing Law

This DPA shall be governed by and construed in accordance with the laws of India. Any disputes arising under this DPA shall be subject to the exclusive jurisdiction of the courts in the jurisdiction specified in the subscription agreement.

---

## 13. Updates to this DPA

The Processor may update this DPA from time to time to reflect changes in law or platform capabilities. The Controller will be notified of material changes and asked to re-accept the updated DPA before the changes take effect.

---

*This template is provided as a reference document. It does not constitute legal advice. Schools are encouraged to have this agreement reviewed by their own legal counsel before accepting.*
