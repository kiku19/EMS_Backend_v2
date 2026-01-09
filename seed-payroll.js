import mongoose from 'mongoose';
import dotenv from 'dotenv';
import PayrollRun from './models/PayrollRun.js';
import PayrollRecord from './models/PayrollRecord.js';
import Payslip from './models/Payslip.js';
import SalaryAdjustment from './models/SalaryAdjustment.js';
import { Staff } from './database.js';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school-management';

// Sample allowances and deductions
const allowanceTypes = [
  { type: 'HRA', description: 'House Rent Allowance', percentage: 0.4 },
  { type: 'Transport', description: 'Transport Allowance', fixed: 2000 },
  { type: 'Medical', description: 'Medical Allowance', fixed: 1500 },
  { type: 'Special', description: 'Special Allowance', percentage: 0.1 }
];

const deductionTypes = [
  { type: 'PF', description: 'Provident Fund', percentage: 0.12 },
  { type: 'Tax', description: 'Income Tax', percentage: 0.1 },
  { type: 'Insurance', description: 'Health Insurance', fixed: 1000 }
];

const statuses = ['generated', 'paid', 'on_hold'];
const employmentTypes = ['full_time', 'part_time', 'contractor'];

async function seedPayrollData() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get all staff
    const staff = await Staff.find({ status: 'active' });
    console.log(`📊 Found ${staff.length} active staff members`);

    if (staff.length === 0) {
      console.log('⚠️  No staff found. Please run seed-staff.js first.');
      process.exit(0);
    }

    // Clear existing payroll data
    console.log('🗑️  Clearing existing payroll data...');
    await PayrollRun.deleteMany({});
    await PayrollRecord.deleteMany({});
    await Payslip.deleteMany({});
    await SalaryAdjustment.deleteMany({});

    // Create payroll data for last 3 months
    const currentDate = new Date();
    const months = [
      { month: currentDate.getMonth() + 1, year: currentDate.getFullYear() }, // Current month
      { month: currentDate.getMonth() === 0 ? 12 : currentDate.getMonth(), year: currentDate.getMonth() === 0 ? currentDate.getFullYear() - 1 : currentDate.getFullYear() }, // Last month
      { month: currentDate.getMonth() <= 1 ? 12 + currentDate.getMonth() - 1 : currentDate.getMonth() - 1, year: currentDate.getMonth() <= 1 ? currentDate.getFullYear() - 1 : currentDate.getFullYear() } // 2 months ago
    ];

    for (const period of months) {
      console.log(`\n📅 Creating payroll for ${period.month}/${period.year}...`);

      // Create PayrollRun
      const payrollRun = new PayrollRun({
        month: period.month,
        year: period.year,
        status: 'completed',
        totalEmployees: staff.length,
        processedEmployees: staff.length,
        failedEmployees: 0,
        runDate: new Date(period.year, period.month - 1, 1)
      });

      let totalAmount = 0;
      let totalPaid = 0;
      let totalPending = 0;

      // Create records for each staff member
      for (const employee of staff) {
        const baseSalary = employee.salary || (Math.floor(Math.random() * 50000) + 30000);
        const empType = employmentTypes[Math.floor(Math.random() * employmentTypes.length)];

        // Generate allowances
        const allowances = [];
        for (const allowance of allowanceTypes) {
          if (Math.random() > 0.3) { // 70% chance to have this allowance
            const amount = allowance.fixed || Math.round(baseSalary * allowance.percentage);
            allowances.push({
              type: allowance.type,
              amount: amount,
              description: allowance.description
            });
          }
        }

        // Generate deductions
        const deductions = [];
        for (const deduction of deductionTypes) {
          if (Math.random() > 0.2) { // 80% chance to have this deduction
            const amount = deduction.fixed || Math.round(baseSalary * deduction.percentage);
            deductions.push({
              type: deduction.type,
              amount: amount,
              description: deduction.description
            });
          }
        }

        // Determine status (more paid for older months)
        let status;
        if (period.month === currentDate.getMonth() + 1) {
          // Current month: mostly generated
          status = Math.random() > 0.7 ? 'paid' : 'generated';
        } else {
          // Past months: mostly paid
          status = Math.random() > 0.2 ? 'paid' : statuses[Math.floor(Math.random() * statuses.length)];
        }

        // Calculate totals
        const totalAllowances = allowances.reduce((sum, a) => sum + a.amount, 0);
        const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
        const grossPay = baseSalary + totalAllowances;
        const netPay = grossPay - totalDeductions;

        const record = new PayrollRecord({
          employeeId: employee.id,
          payrollRunId: payrollRun._id,
          month: period.month,
          year: period.year,
          employmentType: empType,
          baseSalary: baseSalary,
          allowances: allowances,
          deductions: deductions,
          totalAllowances: totalAllowances,
          totalDeductions: totalDeductions,
          grossPay: grossPay,
          netPay: netPay,
          status: status,
          paymentDate: status === 'paid' ? new Date(period.year, period.month - 1, Math.floor(Math.random() * 28) + 1) : null,
          paymentMethod: status === 'paid' ? 'bank_transfer' : null,
          paymentReference: status === 'paid' ? `TXN${Date.now()}${Math.floor(Math.random() * 1000)}` : null,
          isLocked: status === 'paid',
          lockedAt: status === 'paid' ? new Date() : null
        });

        await record.save();

        totalAmount += netPay;
        if (status === 'paid') {
          totalPaid += netPay;
        } else {
          totalPending += netPay;
        }

        // Create payslip
        const payslip = new Payslip({
          payrollRecordId: record._id,
          employeeId: employee.id,
          month: period.month,
          year: period.year,
          payslipNumber: `PS-${period.year}-${period.month.toString().padStart(2, '0')}-${employee.id}`,
          downloadCount: Math.floor(Math.random() * 5)
        });

        await payslip.save();
      }

      // Update payroll run totals
      payrollRun.totalAmount = totalAmount;
      payrollRun.totalPaid = totalPaid;
      payrollRun.totalPending = totalPending;
      payrollRun.completedAt = new Date();
      await payrollRun.save();

      console.log(`✅ Created payroll run for ${period.month}/${period.year}`);
      console.log(`   Total Amount: ₹${totalAmount.toLocaleString()}`);
      console.log(`   Total Paid: ₹${totalPaid.toLocaleString()}`);
      console.log(`   Total Pending: ₹${totalPending.toLocaleString()}`);
    }

    // Create some recurring salary adjustments
    console.log('\n💰 Creating salary adjustments...');
    const adjustmentCount = Math.min(staff.length, 10); // Create adjustments for up to 10 staff
    for (let i = 0; i < adjustmentCount; i++) {
      const employee = staff[i];
      
      // Create a recurring HRA allowance
      await SalaryAdjustment.create({
        employeeId: employee.id,
        type: 'allowance',
        category: 'HRA',
        amount: Math.floor(Math.random() * 10000) + 5000,
        description: 'House Rent Allowance',
        effectiveMonth: currentDate.getMonth() + 1,
        effectiveYear: currentDate.getFullYear(),
        isRecurring: true,
        isActive: true
      });

      // Create a recurring PF deduction
      await SalaryAdjustment.create({
        employeeId: employee.id,
        type: 'deduction',
        category: 'PF',
        amount: Math.floor(Math.random() * 5000) + 2000,
        description: 'Provident Fund',
        effectiveMonth: currentDate.getMonth() + 1,
        effectiveYear: currentDate.getFullYear(),
        isRecurring: true,
        isActive: true
      });
    }

    console.log(`✅ Created ${adjustmentCount * 2} salary adjustments`);

    // Summary
    const totalRuns = await PayrollRun.countDocuments();
    const totalRecords = await PayrollRecord.countDocuments();
    const totalPayslips = await Payslip.countDocuments();
    const totalAdjustments = await SalaryAdjustment.countDocuments();

    console.log('\n📊 Payroll Data Summary:');
    console.log(`   Payroll Runs: ${totalRuns}`);
    console.log(`   Payroll Records: ${totalRecords}`);
    console.log(`   Payslips: ${totalPayslips}`);
    console.log(`   Salary Adjustments: ${totalAdjustments}`);

    console.log('\n✅ Payroll data seeded successfully!');
    console.log('\n🎯 Next Steps:');
    console.log('   1. Navigate to Staffs → Payroll in the dashboard');
    console.log('   2. View the payroll data for different months');
    console.log('   3. Try filtering by status and employment type');
    console.log('   4. Test the "Run Payroll" button for next month');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding payroll data:', error);
    process.exit(1);
  }
}

seedPayrollData();
