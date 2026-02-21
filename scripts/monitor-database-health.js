import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

/**
 * Database Health Monitor
 * 
 * This script runs health checks and generates a report.
 * Can be scheduled to run periodically (e.g., daily via cron)
 * 
 * Usage:
 *   node backend/scripts/monitor-database-health.js
 * 
 * Output:
 *   - Console output with health status
 *   - JSON report file in logs/ directory
 *   - Exit code 0 = healthy, 1 = warnings, 2 = critical issues
 */

const models = {};

async function initModels() {
  models.Class = mongoose.model('Class', new mongoose.Schema({}, { strict: false }));
  models.Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }));
  models.Staff = mongoose.model('Staff', new mongoose.Schema({}, { strict: false }));
}

async function checkHealth() {
  const report = {
    timestamp: new Date().toISOString(),
    status: 'healthy', // healthy, warning, critical
    checks: [],
    summary: {
      total: 0,
      passed: 0,
      warnings: 0,
      critical: 0
    }
  };

  // Check 1: Pagination limits
  const studentCount = await models.Student.countDocuments({});
  const paginationCheck = {
    name: 'Pagination Limits',
    status: studentCount <= 1000 ? 'pass' : 'warning',
    message: `${studentCount} students (limit: 1000)`,
    details: {
      count: studentCount,
      limit: 1000,
      withinLimit: studentCount <= 1000
    }
  };
  report.checks.push(paginationCheck);

  // Check 2: Missing isDeleted field
  const missingIsDeleted = await models.Student.countDocuments({ 
    isDeleted: { $exists: false } 
  });
  const isDeletedCheck = {
    name: 'isDeleted Field',
    status: missingIsDeleted === 0 ? 'pass' : missingIsDeleted > studentCount * 0.1 ? 'critical' : 'warning',
    message: `${missingIsDeleted}/${studentCount} students missing isDeleted field`,
    details: {
      missing: missingIsDeleted,
      total: studentCount,
      percentage: ((missingIsDeleted / studentCount) * 100).toFixed(1)
    }
  };
  report.checks.push(isDeletedCheck);

  // Check 3: Class strength accuracy
  const allClasses = await models.Class.find({});
  let classesWithMismatch = 0;
  
  for (const cls of allClasses) {
    const actualCount = await models.Student.countDocuments({
      classId: cls._id,
      status: 'active',
      isDeleted: { $ne: true }
    });
    
    if (cls.strength !== actualCount) {
      classesWithMismatch++;
    }
  }

  const classStrengthCheck = {
    name: 'Class Strength Accuracy',
    status: classesWithMismatch === 0 ? 'pass' : classesWithMismatch > allClasses.length * 0.2 ? 'critical' : 'warning',
    message: `${classesWithMismatch}/${allClasses.length} classes have incorrect strength`,
    details: {
      incorrect: classesWithMismatch,
      total: allClasses.length,
      percentage: ((classesWithMismatch / allClasses.length) * 100).toFixed(1)
    }
  };
  report.checks.push(classStrengthCheck);

  // Check 4: Orphaned students
  const classIds = new Set(allClasses.map(c => c._id.toString()));
  const allStudents = await models.Student.find({});
  const orphanedStudents = allStudents.filter(s => 
    s.classId && !classIds.has(s.classId.toString())
  );

  const orphanedCheck = {
    name: 'Orphaned Students',
    status: orphanedStudents.length === 0 ? 'pass' : 'critical',
    message: `${orphanedStudents.length} students with invalid classId`,
    details: {
      count: orphanedStudents.length,
      students: orphanedStudents.map(s => ({
        id: s._id.toString(),
        name: s.name,
        classId: s.classId.toString()
      }))
    }
  };
  report.checks.push(orphanedCheck);

  // Check 5: Invalid status values
  const invalidStatus = await models.Student.find({ 
    status: { $nin: ['active', 'inactive', 'alumni', null, undefined] } 
  });

  const statusCheck = {
    name: 'Valid Status Values',
    status: invalidStatus.length === 0 ? 'pass' : 'warning',
    message: `${invalidStatus.length} students with invalid status`,
    details: {
      count: invalidStatus.length,
      invalidValues: [...new Set(invalidStatus.map(s => s.status))]
    }
  };
  report.checks.push(statusCheck);

  // Check 6: Database connection health
  const dbState = mongoose.connection.readyState;
  const dbCheck = {
    name: 'Database Connection',
    status: dbState === 1 ? 'pass' : 'critical',
    message: dbState === 1 ? 'Connected' : 'Disconnected',
    details: {
      readyState: dbState,
      host: mongoose.connection.host,
      name: mongoose.connection.name
    }
  };
  report.checks.push(dbCheck);

  // Calculate summary
  report.checks.forEach(check => {
    report.summary.total++;
    if (check.status === 'pass') {
      report.summary.passed++;
    } else if (check.status === 'warning') {
      report.summary.warnings++;
    } else if (check.status === 'critical') {
      report.summary.critical++;
    }
  });

  // Determine overall status
  if (report.summary.critical > 0) {
    report.status = 'critical';
  } else if (report.summary.warnings > 0) {
    report.status = 'warning';
  } else {
    report.status = 'healthy';
  }

  return report;
}

function printReport(report) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🏥 DATABASE HEALTH MONITOR');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Overall Status: ${getStatusIcon(report.status)} ${report.status.toUpperCase()}\n`);

  console.log('Health Checks:\n');

  report.checks.forEach((check, index) => {
    const icon = getStatusIcon(check.status);
    console.log(`${index + 1}. ${icon} ${check.name}`);
    console.log(`   ${check.message}`);
    
    if (check.status !== 'pass') {
      console.log(`   Details:`, JSON.stringify(check.details, null, 2).split('\n').join('\n   '));
    }
    console.log('');
  });

  console.log('Summary:');
  console.log(`   Total Checks: ${report.summary.total}`);
  console.log(`   ✅ Passed: ${report.summary.passed}`);
  console.log(`   ⚠️  Warnings: ${report.summary.warnings}`);
  console.log(`   🔴 Critical: ${report.summary.critical}`);
  console.log('');

  if (report.status === 'critical') {
    console.log('🔴 CRITICAL ISSUES DETECTED!');
    console.log('   Run: node backend/scripts/fix-database-issues.js');
  } else if (report.status === 'warning') {
    console.log('⚠️  WARNINGS DETECTED');
    console.log('   Consider running: node backend/scripts/fix-database-issues.js');
  } else {
    console.log('✅ DATABASE IS HEALTHY');
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
}

function getStatusIcon(status) {
  switch (status) {
    case 'pass':
    case 'healthy':
      return '✅';
    case 'warning':
      return '⚠️';
    case 'critical':
      return '🔴';
    default:
      return '❓';
  }
}

function saveReport(report) {
  const logsDir = path.join(__dirname, '../logs');
  
  // Create logs directory if it doesn't exist
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `health-report-${timestamp}.json`;
  const filepath = path.join(logsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  console.log(`📄 Report saved to: ${filepath}`);

  // Also save as latest.json for easy access
  const latestPath = path.join(logsDir, 'health-report-latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  console.log(`📄 Latest report: ${latestPath}\n`);
}

async function main() {
  let exitCode = 0;

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });

    await initModels();

    const report = await checkHealth();
    
    printReport(report);
    saveReport(report);

    // Set exit code based on status
    if (report.status === 'critical') {
      exitCode = 2;
    } else if (report.status === 'warning') {
      exitCode = 1;
    } else {
      exitCode = 0;
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    exitCode = 2;
  } finally {
    await mongoose.connection.close();
    process.exit(exitCode);
  }
}

main();
