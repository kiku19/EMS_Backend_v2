# Accountant User Guide — EMS School Dashboard

This guide covers the full fee and finance workflow available to accountants in the EMS School Dashboard. It assumes your school administrator has granted you the **Accountant** or **Finance** role.

---

## 1. Logging In

1. Navigate to your school's EMS dashboard URL.
2. Enter your **email** and **password**, then click **Sign In**.
3. Use **Forgot Password** if needed — a reset link is sent to your email.

---

## 2. Dashboard Overview

After logging in, the dashboard shows finance-relevant widgets:

| Widget | What it shows |
|--------|--------------|
| Today's Collections | Total fees collected today |
| Pending Dues | Students with outstanding balances |
| Overdue Students | Students past their due date |
| Fee Category Breakdown | Pie chart of tuition vs transport vs hostel |
| Recent Receipts | Last 10 fee payments received |

---

## 3. Fee Heads

Fee heads are the categories of fees your school charges (e.g., Tuition, Transport, Hostel, Library).

### 3.1 Viewing Fee Heads
Go to **Fees** → **Fee Heads**. You will see a table of all active fee categories with their default amounts.

### 3.2 Creating a Fee Head
1. Click **+ Add Fee Head**.
2. Enter:
   - **Name** — e.g., "Computer Lab Fee"
   - **Amount** — default amount (can be overridden per class)
   - **Type** — One-time / Monthly / Annual / Term-wise
   - **Is Optional** — toggle if this fee is optional for some students
3. Click **Save**.

### 3.3 Editing / Deactivating a Fee Head
Click the edit icon next to any fee head. Deactivating a fee head removes it from new fee structures but preserves historical records.

---

## 4. Fee Templates

Fee templates define the set of fee heads and amounts for a specific class/category combination.

### 4.1 Creating a Fee Template
1. Go to **Fees** → **Fee Templates** → **+ Create Template**.
2. Select the **Class** (or "All Classes" for a school-wide template).
3. Add fee head rows and set amounts for each.
4. Click **Save Template**.

### 4.2 Applying a Template
Templates can be applied to a class's fee structure when onboarding students or at the start of an academic year.

---

## 5. Fee Structures (Per Student)

### 5.1 Viewing a Student's Fee Structure
1. Go to **Students** → search and open a student profile.
2. Click the **Fees** tab.
3. You will see the student's current fee structure — each fee head, expected amount, and status.

### 5.2 Adjusting a Student's Fees
On the student's Fees tab:
- Click **Edit Fee Structure** to change amounts (e.g., apply a scholarship discount).
- Add or remove optional fee heads.
- Click **Save** to confirm changes.

### 5.3 Concessions / Scholarships
In the fee structure editor, you can set a **Concession Amount** or **Concession Percentage** per fee head. The balance due is automatically recalculated.

---

## 6. Collecting Fees (Recording a Payment)

### 6.1 Single Student Payment
1. Go to **Fees** → **Collect Fee** (or search the student and open their Fees tab).
2. Click **+ Record Payment**.
3. Fill in:
   - **Amount** — amount received
   - **Payment Mode** — Cash, UPI, Bank Transfer, Cheque, DD, Card
   - **Payment Date** — defaults to today
   - **Receipt Note** — optional (cheque number, UTR, etc.)
   - **Fee Heads** — select which fee head(s) this payment applies to (partial payments supported)
4. Click **Save & Print Receipt**.

> A receipt is auto-generated with a sequential receipt number. You can reprint any receipt from the payment history.

### 6.2 Partial Payments
You can accept partial payments. The system tracks the paid amount and outstanding balance separately for each fee head.

### 6.3 Advance Payments
Payments in excess of the outstanding balance are recorded as advance. The system deducts advance amounts from future dues.

---

## 7. Fee Reports

### 7.1 Collection Summary Report
Go to **Fees** → **Reports** → **Collection Summary**:
- Filter by **date range**, **class**, **fee head**, or **payment mode**.
- Export to **Excel** or **PDF**.

### 7.2 Dues Report
Go to **Fees** → **Reports** → **Pending Dues**:
- Shows all students with outstanding balances.
- Filter by class, minimum due amount, or overdue status.
- Export for follow-up or to send automated reminders.

### 7.3 Receipt Register
Go to **Fees** → **Reports** → **Receipt Register**:
- Chronological list of all receipts with student name, class, amount, and mode.
- Useful for daily cash reconciliation.

### 7.4 Defaulter List
Go to **Fees** → **Reports** → **Defaulters**:
- Students who have not paid any fees for the current term.
- Can trigger SMS/Email reminders from this view.

---

## 8. Sending Fee Reminders

### 8.1 Automatic Reminders
Automatic reminders can be configured by your admin under **Settings** → **Fee Reminders**. Reminders are sent via SMS, Email, or WhatsApp on configured schedules.

### 8.2 Manual Reminder
1. Go to **Fees** → **Reports** → **Pending Dues**.
2. Select one or more students.
3. Click **Send Reminder** → choose channel (SMS/Email/WhatsApp).
4. Confirm to send.

---

## 9. Receipts

### 9.1 Reprinting a Receipt
1. Go to **Fees** → search for the payment by receipt number or student name.
2. Click the print icon next to the receipt.
3. The receipt opens as a PDF for printing.

### 9.2 Cancelling a Receipt
Receipts cannot be deleted (for audit trail purposes). To reverse a payment:
1. Record a **reversal** or **refund** in the same payment flow by entering a negative amount.
2. Add a note explaining the reason.

---

## 10. Invoices / Bills

Go to **Fees** → **Bills** to manage invoices sent to parents:
- Generate a fee invoice for a student.
- Send the invoice via email directly from the system.
- Track invoice status (sent, viewed, paid).

---

## 11. Payroll (Read-Only)

If your admin has granted read access:
- Go to **Accounts** → **Payroll** to view processed payroll records.
- You cannot create or edit payroll — that requires admin/HR access.
- Export payroll summaries for accounting reconciliation.

---

## 12. Tally Export

If your school uses Tally accounting software:
1. Go to **Accounts** → **Tally Export**.
2. Select the **date range**.
3. Click **Export** to download a Tally-compatible XML or CSV file.
4. Import the file into Tally using the standard import procedure.

---

## 13. Concession / Scholarship Management

Go to **Fees** → **Concessions**:
- View all students with active concessions.
- Filter by concession type (scholarship, staff ward, sibling discount, etc.).
- Export a concession report for approval records.

---

## 14. Academic Year Rollover

At the end of the academic year:
1. The admin initiates the **Promote Students** workflow (your input may not be required).
2. Fee structures for the new year should be updated using **Fee Templates** before the new academic year begins.
3. Any carryforward dues from the previous year must be manually noted; the system does not auto-migrate dues across academic years unless configured to do so.

---

## 15. Common Issues

| Problem | Solution |
|---------|----------|
| Receipt number already used | Receipt numbers are system-generated; do not manually enter one that was already printed |
| Payment not reflecting in student balance | Check if the payment was saved; refresh the student's fee tab |
| Cannot find a student in the fee list | Ensure the student is enrolled and has a fee structure assigned |
| Tally export is empty | Confirm the date range has transactions and the export filter matches |
| Reminder SMS not sent | Check SMS balance / settings under Settings → SMS Configuration |

---

## 16. Getting Help

- Use the **?** icon next to any section for context-sensitive help.
- Search the **Knowledge Base** from the Help menu.
- Contact your school administrator for role or permission changes.

---

*Last updated: 2026-03-23 | EMS v2.x*
