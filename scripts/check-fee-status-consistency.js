/**
 * Diagnostic script to check and fix fee status inconsistencies
 *
 * This script checks for mismatches between:
 * - StudentFeeStructure.overallStatus
 * - Student.feeStatus
 *
 * Run with: node backend/scripts/check-fee-status-consistency.js
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Student, StudentFeeStructure } from '../database.js';

// Load environment variables
dotenv.config();

// Calculate fee status based on totalBalance and totalPaid
function calculateFeeStatus(totalBalance, totalPaid) {
  if (totalBalance <= 0) return 'paid';
  if (totalPaid > 0) return 'partial';
  return 'pending';
}

async function checkFeeStatusConsistency(fix = false) {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/ems');
    console.log('✅ Connected to database\n');

    // Get all students with their fee structures
    const students = await Student.find({});

    console.log(`📊 Found ${students.length} students\n`);

    let inconsistencies = [];

    for (const student of students) {
      const feeStructure = await StudentFeeStructure.findOne({
        studentId: student._id,
        academicYear: '2024-25'
      });

      if (!feeStructure) {
        // No fee structure exists
        if (student.feeStatus !== 'pending') {
          inconsistencies.push({
            studentId: student._id,
            admissionId: student.admissionId,
            name: student.name,
            issue: 'No fee structure but feeStatus is not pending',
            currentStatus: student.feeStatus,
            expectedStatus: 'pending'
          });
        }
        continue;
      }

      // Calculate what the fee status should be
      const expectedStatus = calculateFeeStatus(
        feeStructure.totalBalance,
        feeStructure.totalPaid
      );

      // Check if there's a mismatch
      if (student.feeStatus !== expectedStatus) {
        inconsistencies.push({
          studentId: student._id,
          admissionId: student.admissionId,
          name: student.name,
          issue: 'Fee status mismatch',
          currentStatus: student.feeStatus,
          expectedStatus: expectedStatus,
          totalFee: feeStructure.totalFee,
          totalPaid: feeStructure.totalPaid,
          totalBalance: feeStructure.totalBalance,
          overallStatus: feeStructure.overallStatus
        });
      }
    }

    if (inconsistencies.length === 0) {
      console.log('✅ No fee status inconsistencies found!');
    } else {
      console.log(`⚠️  Found ${inconsistencies.length} inconsistencies:\n`);

      // Group by issue type
      const byIssue = inconsistencies.reduce((acc, inc) => {
        acc[inc.issue] = acc[inc.issue] || [];
        acc[inc.issue].push(inc);
        return acc;
      }, {});

      for (const [issue, items] of Object.entries(byIssue)) {
        console.log(`\n🔍 ${issue} (${items.length} students):`);
        console.log('─'.repeat(80));
        items.forEach((inc, idx) => {
          console.log(`\n  ${idx + 1}. ${inc.name} (${inc.admissionId})`);
          console.log(`     Current: ${inc.currentStatus} → Expected: ${inc.expectedStatus}`);
          if (inc.totalFee !== undefined) {
            console.log(`     Fee: ₹${inc.totalFee} | Paid: ₹${inc.totalPaid} | Balance: ₹${inc.totalBalance}`);
          }
        });
      }

      // Fix if requested
      if (fix) {
        console.log('\n\n🔧 Fixing inconsistencies...\n');
        let fixed = 0;

        for (const inc of inconsistencies) {
          try {
            await Student.findByIdAndUpdate(inc.studentId, {
              feeStatus: inc.expectedStatus
            });
            console.log(`  ✅ Fixed ${inc.name} (${inc.admissionId}): ${inc.currentStatus} → ${inc.expectedStatus}`);
            fixed++;
          } catch (error) {
            console.log(`  ❌ Failed to fix ${inc.name}: ${error.message}`);
          }
        }

        console.log(`\n✅ Fixed ${fixed}/${inconsistencies.length} inconsistencies`);
      } else {
        console.log('\n\n💡 To fix these inconsistencies, run:');
        console.log('   node backend/scripts/check-fee-status-consistency.js --fix');
      }
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Check if --fix flag was passed
const fixMode = process.argv.includes('--fix');

console.log('='.repeat(80));
console.log('Fee Status Consistency Check');
console.log('='.repeat(80));
console.log(fixMode ? 'Mode: FIX' : 'Mode: CHECK ONLY');
console.log('='.repeat(80));
console.log();

checkFeeStatusConsistency(fixMode);
