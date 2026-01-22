/**
 * Verification Script: Timetable Management Setup
 * 
 * This script verifies that the timetable management system
 * is properly installed and configured.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

const log = {
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`)
};

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    log.success('Connected to MongoDB');
    return true;
  } catch (error) {
    log.error(`MongoDB connection failed: ${error.message}`);
    return false;
  }
};

// Verification checks
const checks = {
  async databaseSchema() {
    console.log('\n📋 Checking Database Schema...');
    
    const db = mongoose.connection.db;
    let passed = 0;
    let failed = 0;
    
    // Check Staff collection
    const staff = db.collection('staff');
    const staffSample = await staff.findOne({});
    if (staffSample && staffSample.hasOwnProperty('teacherAssignments')) {
      log.success('Staff collection has teacherAssignments field');
      passed++;
    } else {
      log.error('Staff collection missing teacherAssignments field');
      failed++;
    }
    
    // Check Class collection
    const classes = db.collection('classes');
    const classSample = await classes.findOne({});
    if (classSample && classSample.hasOwnProperty('classTag') && classSample.hasOwnProperty('assignedSubjects')) {
      log.success('Class collection has classTag and assignedSubjects fields');
      passed++;
    } else {
      log.error('Class collection missing required fields');
      failed++;
    }
    
    // Check Timetable collection
    const timetables = db.collection('timetables');
    const timetableSample = await timetables.findOne({});
    if (timetableSample && timetableSample.hasOwnProperty('version') && timetableSample.hasOwnProperty('lastSyncedAt')) {
      log.success('Timetable collection has metadata fields');
      passed++;
    } else {
      log.warning('Timetable collection missing metadata fields (may be empty)');
    }
    
    // Check TeacherTimetable collection exists
    const collections = await db.listCollections({ name: 'teachertimetables' }).toArray();
    if (collections.length > 0) {
      log.success('TeacherTimetable collection exists');
      passed++;
    } else {
      log.error('TeacherTimetable collection does not exist');
      failed++;
    }
    
    // Check ConflictLog collection exists
    const conflictCollections = await db.listCollections({ name: 'conflictlogs' }).toArray();
    if (conflictCollections.length > 0) {
      log.success('ConflictLog collection exists');
      passed++;
    } else {
      log.error('ConflictLog collection does not exist');
      failed++;
    }
    
    return { passed, failed };
  },
  
  async indexes() {
    console.log('\n📋 Checking Database Indexes...');
    
    const db = mongoose.connection.db;
    let passed = 0;
    let failed = 0;
    
    // Check Timetable indexes
    const timetables = db.collection('timetables');
    const timetableIndexes = await timetables.indexes();
    const hasClassIdIndex = timetableIndexes.some(idx => idx.key.classId && idx.key.academicYear);
    if (hasClassIdIndex) {
      log.success('Timetable has classId+academicYear index');
      passed++;
    } else {
      log.error('Timetable missing classId+academicYear index');
      failed++;
    }
    
    // Check TeacherTimetable indexes
    const teacherTimetables = db.collection('teachertimetables');
    const teacherTimetableIndexes = await teacherTimetables.indexes();
    const hasTeacherIdIndex = teacherTimetableIndexes.some(idx => idx.key.teacherId && idx.key.academicYear);
    if (hasTeacherIdIndex) {
      log.success('TeacherTimetable has teacherId+academicYear index');
      passed++;
    } else {
      log.error('TeacherTimetable missing teacherId+academicYear index');
      failed++;
    }
    
    // Check Staff indexes
    const staff = db.collection('staff');
    const staffIndexes = await staff.indexes();
    const hasAssignmentIndexes = staffIndexes.some(idx => 
      idx.key['teacherAssignments.subject'] || idx.key['teacherAssignments.classes']
    );
    if (hasAssignmentIndexes) {
      log.success('Staff has teacherAssignments indexes');
      passed++;
    } else {
      log.warning('Staff missing teacherAssignments indexes (may impact performance)');
    }
    
    return { passed, failed };
  },
  
  async apiEndpoints() {
    console.log('\n📋 Checking API Endpoints...');
    
    const fs = require('fs');
    const path = require('path');
    let passed = 0;
    let failed = 0;
    
    const requiredRoutes = [
      'backend/routes/classSettings.js',
      'backend/routes/teacherAssignments.js',
      'backend/routes/teacherTimetable.js',
      'backend/routes/validation.js'
    ];
    
    for (const route of requiredRoutes) {
      const routePath = path.join(process.cwd(), '..', route);
      if (fs.existsSync(routePath)) {
        log.success(`Route file exists: ${route}`);
        passed++;
      } else {
        log.error(`Route file missing: ${route}`);
        failed++;
      }
    }
    
    return { passed, failed };
  },
  
  async services() {
    console.log('\n📋 Checking Services...');
    
    const fs = require('fs');
    const path = require('path');
    let passed = 0;
    let failed = 0;
    
    const requiredServices = [
      'backend/services/timetableService.js',
      'backend/services/conflictDetectionService.js',
      'backend/services/validationService.js'
    ];
    
    for (const service of requiredServices) {
      const servicePath = path.join(process.cwd(), '..', service);
      if (fs.existsSync(servicePath)) {
        log.success(`Service file exists: ${service}`);
        passed++;
      } else {
        log.error(`Service file missing: ${service}`);
        failed++;
      }
    }
    
    return { passed, failed };
  },
  
  async configuration() {
    console.log('\n📋 Checking Configuration...');
    
    let passed = 0;
    let failed = 0;
    
    // Check environment variables
    if (process.env.MONGODB_URI) {
      log.success('MONGODB_URI is configured');
      passed++;
    } else {
      log.warning('MONGODB_URI not set (using default)');
    }
    
    if (process.env.ENABLE_TIMETABLE_MANAGEMENT !== undefined) {
      const enabled = process.env.ENABLE_TIMETABLE_MANAGEMENT === 'true';
      if (enabled) {
        log.success('Timetable management is ENABLED');
      } else {
        log.warning('Timetable management is DISABLED');
      }
      passed++;
    } else {
      log.warning('ENABLE_TIMETABLE_MANAGEMENT not set');
    }
    
    if (process.env.CONFLICT_CHECK_ENABLED !== undefined) {
      log.success('Conflict detection is configured');
      passed++;
    } else {
      log.warning('CONFLICT_CHECK_ENABLED not set');
    }
    
    return { passed, failed };
  },
  
  async dataIntegrity() {
    console.log('\n📋 Checking Data Integrity...');
    
    const db = mongoose.connection.db;
    let passed = 0;
    let failed = 0;
    
    // Check for orphaned teacher timetable entries
    const teacherTimetables = db.collection('teachertimetables');
    const staff = db.collection('staff');
    
    const teacherTimetableCount = await teacherTimetables.countDocuments({});
    if (teacherTimetableCount > 0) {
      log.info(`Found ${teacherTimetableCount} teacher timetables`);
      
      // Sample check for orphaned entries
      const sampleTimetable = await teacherTimetables.findOne({});
      if (sampleTimetable) {
        const teacherExists = await staff.findOne({ _id: sampleTimetable.teacherId });
        if (teacherExists) {
          log.success('Teacher timetables reference valid staff members');
          passed++;
        } else {
          log.error('Found orphaned teacher timetable entry');
          failed++;
        }
      }
    } else {
      log.info('No teacher timetables found (system may be new)');
    }
    
    // Check for class timetables without corresponding classes
    const timetables = db.collection('timetables');
    const classes = db.collection('classes');
    
    const timetableCount = await timetables.countDocuments({});
    if (timetableCount > 0) {
      log.info(`Found ${timetableCount} class timetables`);
      
      const sampleTimetable = await timetables.findOne({});
      if (sampleTimetable) {
        const classExists = await classes.findOne({ _id: sampleTimetable.classId });
        if (classExists) {
          log.success('Class timetables reference valid classes');
          passed++;
        } else {
          log.error('Found orphaned class timetable entry');
          failed++;
        }
      }
    } else {
      log.info('No class timetables found (system may be new)');
    }
    
    return { passed, failed };
  }
};

// Run all checks
const runVerification = async () => {
  console.log('🔍 Timetable Management System Verification\n');
  console.log('This script will verify that the timetable management system');
  console.log('is properly installed and configured.\n');
  
  const connected = await connectDB();
  if (!connected) {
    console.log('\n❌ Cannot proceed without database connection');
    process.exit(1);
  }
  
  const results = {
    passed: 0,
    failed: 0,
    warnings: 0
  };
  
  try {
    // Run all checks
    const schemaResult = await checks.databaseSchema();
    results.passed += schemaResult.passed;
    results.failed += schemaResult.failed;
    
    const indexResult = await checks.indexes();
    results.passed += indexResult.passed;
    results.failed += indexResult.failed;
    
    const apiResult = await checks.apiEndpoints();
    results.passed += apiResult.passed;
    results.failed += apiResult.failed;
    
    const serviceResult = await checks.services();
    results.passed += serviceResult.passed;
    results.failed += serviceResult.failed;
    
    const configResult = await checks.configuration();
    results.passed += configResult.passed;
    results.failed += configResult.failed;
    
    const integrityResult = await checks.dataIntegrity();
    results.passed += integrityResult.passed;
    results.failed += integrityResult.failed;
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Verification Summary');
    console.log('='.repeat(50));
    console.log(`${colors.green}Passed:${colors.reset} ${results.passed}`);
    console.log(`${colors.red}Failed:${colors.reset} ${results.failed}`);
    
    if (results.failed === 0) {
      console.log(`\n${colors.green}✅ All checks passed!${colors.reset}`);
      console.log('The timetable management system is properly configured.');
    } else {
      console.log(`\n${colors.red}❌ Some checks failed${colors.reset}`);
      console.log('Please review the errors above and run the migration script if needed:');
      console.log('  node migrations/001_add_timetable_fields.js');
    }
    
  } catch (error) {
    console.error(`\n${colors.red}❌ Verification failed:${colors.reset}`, error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✓ Database connection closed');
  }
};

// Run verification if called directly
if (require.main === module) {
  runVerification();
}

module.exports = { runVerification, checks };
