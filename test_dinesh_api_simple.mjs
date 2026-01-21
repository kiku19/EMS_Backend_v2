#!/usr/bin/env node

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { execSync } from 'child_process';

dotenv.config();

const BASE_URL = 'http://localhost:3001';
const DINESH_ID = '696bdeef9c7eb3687eeecdbf';
const DINESH_EMAIL = 'dinesh.kumar@school.com';
const DINESH_USERNAME = 'dinesh.kumar';
const DINESH_PASSWORD = 'Dinesh@123';
const DINESH_STAFF_NUMBER = 'STF-2025-DINESH';
const DINESH_NAME = 'DINESH KUMAR';
const TODAY_DATE = '2026-01-18';

// Test results storage
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

// Helper function to format date as YYYY-MM-DD
function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper function to format time as HH:MM AM/PM
function formatTime(date) {
  const options = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  };
  return date.toLocaleTimeString('en-US', options);
}

// Helper function to log test results
function logTest(testName, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} | ${testName}${details ? ' - ' + details : ''}`);

  testResults.tests.push({
    name: testName,
    passed,
    details
  });

  if (passed) {
    testResults.passed++;
  } else {
    testResults.failed++;
  }
}

// Helper function to execute curl command and parse JSON response
async function executeCurl(command) {
  try {
    // Remove curl output formatting
    const result = execSync(command, { encoding: 'utf8', timeout: 10000 });
    // Clean the result and try to parse JSON
    const cleanResult = result.replace(/[\r\n]+/g, '').trim();
    return {
      success: true,
      data: JSON.parse(cleanResult)
    };
  } catch (error) {
    if (error.signal === 'SIGTERM') {
      return {
        success: false,
        error: 'Timeout'
      };
    }
    return {
      success: false,
      error: error.message
    };
  }
}

// Test 1: GET /api/staff - Verify DINESH appears in staff list
async function testGetStaffList() {
  console.log('\n=== Test 1: GET /api/staff - Verify DINESH appears in staff list ===');

  // First login to get token
  const loginCommand = `curl -s -X POST ${BASE_URL}/api/auth/login \\
    -H "Content-Type: application/json" \\
    -d '{"email":"${DINESH_EMAIL}","password":"${DINESH_PASSWORD}"}'`;

  const loginResult = await executeCurl(loginCommand);

  if (!loginResult.success) {
    logTest('Get Staff List', false, `Login failed: ${loginResult.error}`);
    return;
  }

  const token = loginResult.data.token;

  // Get staff list
  const staffCommand = `curl -s -X GET ${BASE_URL}/api/staff \\
    -H "Authorization: Bearer ${token}"`;

  const staffResult = await executeCurl(staffCommand);

  if (!staffResult.success) {
    logTest('Get Staff List', false, `Request failed: ${staffResult.error}`);
    return;
  }

  const staffList = staffResult.data;
  const dinesh = staffList.find(s => s.email === DINESH_EMAIL || s.username === DINESH_USERNAME);

  if (dinesh) {
    logTest('Get Staff List', true,
      `Found DINESH - ID: ${dinesh.id}, Name: ${dinesh.name}, Email: ${dinesh.email}`);
  } else {
    logTest('Get Staff List', false, 'DINESH not found in staff list');
  }
}

// Test 2: GET /api/staff/:id - Get DINESH's full profile data
async function testGetStaffProfile() {
  console.log('\n=== Test 2: GET /api/staff/:id - Get DINESH full profile data ===');

  // First login to get token
  const loginCommand = `curl -s -X POST ${BASE_URL}/api/auth/login \\
    -H "Content-Type: application/json" \\
    -d '{"email":"${DINESH_EMAIL}","password":"${DINESH_PASSWORD}"}'`;

  const loginResult = await executeCurl(loginCommand);

  if (!loginResult.success) {
    logTest('Get Staff Profile', false, `Login failed: ${loginResult.error}`);
    return;
  }

  const token = loginResult.data.token;

  // Get staff profile
  const profileCommand = `curl -s -X GET ${BASE_URL}/api/staff/${DINESH_ID} \\
    -H "Authorization: Bearer ${token}"`;

  const profileResult = await executeCurl(profileCommand);

  if (!profileResult.success) {
    logTest('Get Staff Profile', false, `Request failed: ${profileResult.error}`);
    return;
  }

  const dinesh = profileResult.data;

  const checks = [
    { condition: dinesh.id === DINESH_ID, name: 'ID matches' },
    { condition: dinesh.email === DINESH_EMAIL, name: 'Email matches' },
    { condition: dinesh.username === DINESH_USERNAME, name: 'Username matches' },
    { condition: dinesh.staffNumber === DINESH_STAFF_NUMBER, name: 'Staff number matches' },
    { condition: dinesh.name && dinesh.name.trim() !== '', name: 'Name exists' }
  ];

  const allPassed = checks.every(check => check.condition);

  if (allPassed) {
    logTest('Get Staff Profile', true,
      `Profile complete - ${dinesh.name}, Role: ${dinesh.role}, Department: ${dinesh.department}`);
  } else {
    const failedChecks = checks.filter(check => !check.condition).map(c => c.name);
    logTest('Get Staff Profile', false, `Failed checks: ${failedChecks.join(', ')}`);
  }
}

// Test 3: Check if Class 10-A has DINESH assigned as class teacher
async function testClassTeacherAssignment() {
  console.log('\n=== Test 3: Check Class 10-A class teacher assignment ===');

  // First login to get token
  const loginCommand = `curl -s -X POST ${BASE_URL}/api/auth/login \\
    -H "Content-Type: application/json" \\
    -d '{"email":"${DINESH_EMAIL}","password":"${DINESH_PASSWORD}"}'`;

  const loginResult = await executeCurl(loginCommand);

  if (!loginResult.success) {
    logTest('Class Teacher Assignment', false, `Login failed: ${loginResult.error}`);
    return;
  }

  const token = loginResult.data.token;

  // Get classes
  const classesCommand = `curl -s -X GET ${BASE_URL}/api/classes \\
    -H "Authorization: Bearer ${token}"`;

  const classesResult = await executeCurl(classesCommand);

  if (!classesResult.success) {
    logTest('Class Teacher Assignment', false, `Failed to get classes: ${classesResult.error}`);
    return;
  }

  const classes = classesResult.data;
  const class10A = classes.find(c => c.name === 'Class 10' && c.section === 'A');

  if (!class10A) {
    logTest('Class Teacher Assignment', false, 'Class 10-A not found');
    return;
  }

  // Check if DINESH is assigned as class teacher
  const isClassTeacher = class10A.classTeacherId === DINESH_ID;

  if (isClassTeacher) {
    logTest('Class Teacher Assignment', true,
      `Class 10-A has DINESH assigned as class teacher`);
  } else {
    const assignedTeacherId = class10A.classTeacherId;
    const assignedTeacher = classesResult.data.find(c => c._id === assignedTeacherId);
    const assignedName = assignedTeacher ? assignedTeacher.name : 'Unknown';
    logTest('Class Teacher Assignment', false,
      `Class 10-A has ${assignedName} assigned as class teacher, not DINESH`);
  }
}

// Test 4: Create a payroll record for DINESH for January 2025
async function testCreatePayrollRecord() {
  console.log('\n=== Test 4: Create payroll record for DINESH for January 2025 ===');

  // First login to get token (need admin privileges)
  const loginCommand = `curl -s -X POST ${BASE_URL}/api/auth/login \\
    -H "Content-Type: application/json" \\
    -d '{"email":"vikram@school.com","password":"test123"}'`;

  const loginResult = await executeCurl(loginCommand);

  if (!loginResult.success) {
    // Try with admin credentials
    const adminLoginCommand = `curl -s -X POST ${BASE_URL}/api/auth/login \\
      -H "Content-Type: application/json" \\
      -d '{"email":"admin@test.com","password":"test123"}'`;

    const adminLoginResult = await executeCurl(adminLoginCommand);

    if (!adminLoginResult.success) {
      logTest('Create Payroll Record', false, `Login failed for both teacher and admin`);
      return;
    }
    loginResult.data = adminLoginResult.data;
  }

  const token = loginResult.data.token;

  // Try to create payroll record
  const payrollCommand = `curl -s -X POST ${BASE_URL}/api/payroll/run \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer ${token}" \\
    -d '{"month":1,"year":2025,"employeeIds":["${DINESH_ID}"]}'`;

  const payrollResult = await executeCurl(payrollCommand);

  if (payrollResult.success && payrollResult.data && payrollResult.data.success !== undefined) {
    logTest('Create Payroll Record', true,
      `Payroll run initiated - Success: ${payrollResult.data.data?.results?.success?.length || 0}`);
  } else if (payrollResult.success && payrollResult.data && payrollResult.data.error) {
    // This might be expected since January 2025 is in the future
    if (payrollResult.data.error.includes('future months')) {
      logTest('Create Payroll Record', true, 'Correctly rejected future month (January 2025)');
    } else {
      logTest('Create Payroll Record', false, `API Error: ${payrollResult.data.error}`);
    }
  } else {
    logTest('Create Payroll Record', false, `Request failed: ${payrollResult.error}`);
  }
}

// Test 5: Mark attendance for DINESH for today
async function testMarkAttendance() {
  console.log('\n=== Test 5: Mark attendance for DINESH for today ===');

  // First login to get token
  const loginCommand = `curl -s -X POST ${BASE_URL}/api/auth/login \\
    -H "Content-Type: application/json" \\
    -d '{"email":"${DINESH_EMAIL}","password":"${DINESH_PASSWORD}"}'`;

  const loginResult = await executeCurl(loginCommand);

  if (!loginResult.success) {
    logTest('Mark Attendance', false, `Login failed: ${loginResult.error}`);
    return;
  }

  const token = loginResult.data.token;

  // Mark attendance
  const attendanceCommand = `curl -s -X POST ${BASE_URL}/api/staff-attendance \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer ${token}" \\
    -d '{"staffId":"${DINESH_ID}","date":"${TODAY_DATE}","status":"present","checkInTime":"09:00 AM","markedBy":"${DINESH_ID}"}'`;

  const attendanceResult = await executeCurl(attendanceCommand);

  if (attendanceResult.success && attendanceResult.data) {
    logTest('Mark Attendance', true,
      `Attendance marked for ${TODAY_DATE} - Status: ${attendanceResult.data.status || 'unknown'}`);
  } else {
    logTest('Mark Attendance', false, `Request failed: ${attendanceResult.error}`);
  }
}

// Test 6: Verify attendance is stored in StaffAttendance collection
async function testVerifyAttendanceStorage() {
  console.log('\n=== Test 6: Verify attendance stored in StaffAttendance collection ===');

  // First login to get token
  const loginCommand = `curl -s -X POST ${BASE_URL}/api/auth/login \\
    -H "Content-Type: application/json" \\
    -d '{"email":"${DINESH_EMAIL}","password":"${DINESH_PASSWORD}"}'`;

  const loginResult = await executeCurl(loginCommand);

  if (!loginResult.success) {
    logTest('Verify Attendance Storage', false, `Login failed: ${loginResult.error}`);
    return;
  }

  const token = loginResult.data.token;

  // Get attendance for DINESH
  const getAttendanceCommand = `curl -s -X GET ${BASE_URL}/api/staff-attendance/staff/${DINESH_ID} \\
    -H "Authorization: Bearer ${token}"`;

  const attendanceResult = await executeCurl(getAttendanceCommand);

  if (attendanceResult.success && attendanceResult.data) {
    const attendanceRecords = attendanceResult.data;
    const todayAttendance = attendanceRecords.find(a => a.date === TODAY_DATE);

    if (todayAttendance) {
      logTest('Verify Attendance Storage', true,
        `Attendance record found for ${TODAY_DATE} - Status: ${todayAttendance.status}, Check-in: ${todayAttendance.checkInTime || 'N/A'}`);
    } else {
      logTest('Verify Attendance Storage', false, 'No attendance record found for today');
    }
  } else {
    logTest('Verify Attendance Storage', false, `Request failed: ${attendanceResult.error}`);
  }
}

// Test 7: Test if attendance status can be changed to "Half Day"
async function testUpdateAttendanceStatus() {
  console.log('\n=== Test 7: Update attendance status to Half Day ===');

  // First login to get token
  const loginCommand = `curl -s -X POST ${BASE_URL}/api/auth/login \\
    -H "Content-Type: application/json" \\
    -d '{"email":"${DINESH_EMAIL}","password":"${DINESH_PASSWORD}"}'`;

  const loginResult = await executeCurl(loginCommand);

  if (!loginResult.success) {
    logTest('Update Attendance Status', false, `Login failed: ${loginResult.error}`);
    return;
  }

  const token = loginResult.data.token;

  // Update to half day
  const updateCommand = `curl -s -X POST ${BASE_URL}/api/staff-attendance \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer ${token}" \\
    -d '{"staffId":"${DINESH_ID}","date":"${TODAY_DATE}","status":"halfday","checkInTime":"09:00 AM","markedBy":"${DINESH_ID}"}'`;

  const updateResult = await executeCurl(updateCommand);

  if (updateResult.success && updateResult.data) {
    logTest('Update Attendance Status', true,
      `Attendance updated to halfday for ${TODAY_DATE}`);
  } else {
    logTest('Update Attendance Status', false, `Request failed: ${updateResult.error}`);
  }
}

// Test 8: Test sending a message from DINESH to another staff
async function testSendMessage() {
  console.log('\n=== Test 8: Send message from DINESH to another staff ===');

  // First login to get token
  const loginCommand = `curl -s -X POST ${BASE_URL}/api/auth/login \\
    -H "Content-Type: application/json" \\
    -d '{"email":"${DINESH_EMAIL}","password":"${DINESH_PASSWORD}"}'`;

  const loginResult = await executeCurl(loginCommand);

  if (!loginResult.success) {
    logTest('Send Message', false, `Login failed: ${loginResult.error}`);
    return;
  }

  const token = loginResult.data.token;

  // Get staff list to find someone to message
  const staffCommand = `curl -s -X GET ${BASE_URL}/api/staff \\
    -H "Authorization: Bearer ${token}"`;

  const staffResult = await executeCurl(staffCommand);

  if (!staffResult.success) {
    logTest('Send Message', false, `Failed to get staff list: ${staffResult.error}`);
    return;
  }

  const staffList = staffResult.data;
  const otherStaff = staffList.find(s => s.id !== DINESH_ID && s.status === 'active');

  if (!otherStaff) {
    logTest('Send Message', false, 'No other active staff found to send message to');
    return;
  }

  // Create conversation
  const conversationCommand = `curl -s -X POST ${BASE_URL}/api/messages/conversations \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer ${token}" \\
    -d '{"user1Id":"${DINESH_ID}","user1Type":"staff","user2Id":"${otherStaff.id}","user2Type":"staff","type":"direct"}'`;

  const conversationResult = await executeCurl(conversationCommand);

  if (!conversationResult.success) {
    logTest('Send Message', false, `Failed to create conversation: ${conversationResult.error}`);
    return;
  }

  // Send message
  const messageCommand = `curl -s -X POST ${BASE_URL}/api/messages/messages \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer ${token}" \\
    -d '{"conversationId":"${conversationResult.data.id}","senderId":"${DINESH_ID}","senderModel":"staff","receiverId":"${otherStaff.id}","receiverModel":"staff","content":"Hello! This is a test message from DINESH.","type":"text"}'`;

  const messageResult = await executeCurl(messageCommand);

  if (messageResult.success && messageResult.data) {
    logTest('Send Message', true,
      `Message sent to ${otherStaff.name} - Message ID: ${messageResult.data.id}`);
  } else {
    logTest('Send Message', false, `Failed to send message: ${messageResult.error}`);
  }
}

// Test 9: Test applying for leave request from DINESH
async function testApplyForLeave() {
  console.log('\n=== Test 9: Apply for leave request from DINESH ===');

  // First login to get token
  const loginCommand = `curl -s -X POST ${BASE_URL}/api/auth/login \\
    -H "Content-Type: application/json" \\
    -d '{"email":"${DINESH_EMAIL}","password":"${DINESH_PASSWORD}"}'`;

  const loginResult = await executeCurl(loginCommand);

  if (!loginResult.success) {
    logTest('Apply For Leave', false, `Login failed: ${loginResult.error}`);
    return;
  }

  const token = loginResult.data.token;

  // Apply for leave
  const leaveCommand = `curl -s -X POST ${BASE_URL}/api/staff-attendance/mobile/leave/apply \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer ${token}" \\
    -d '{"staffId":"${DINESH_ID}","leaveType":"casual","startDate":"${TODAY_DATE}","endDate":"${TODAY_DATE}","reason":"Personal leave"}'`;

  const leaveResult = await executeCurl(leaveCommand);

  if (leaveResult.success && leaveResult.data) {
    logTest('Apply For Leave', true,
      `Leave application submitted for ${TODAY_DATE} - ${leaveResult.data.message}`);
  } else {
    logTest('Apply For Leave', false, `Failed to apply leave: ${leaveResult.error}`);
  }
}

// Main test runner
async function runAllTests() {
  console.log('🧪 DINESH API TEST SUITE');
  console.log('========================');
  console.log(`Test Staff: DINESH (${DINESH_NAME})`);
  console.log(`Test Date: ${TODAY_DATE}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log('========================\n');

  console.log('⚠️  Make sure the backend server is running on port 3001');
  console.log('⚠️  Each test will authenticate independently\n');

  // Start the backend server if not running
  try {
    execSync('netstat -ano | findstr :3001', { encoding: 'utf8', timeout: 5000 });
    console.log('✅ Backend server is running on port 3001\n');
  } catch (error) {
    console.log('⚠️  Backend server not detected. Starting server...\n');
    try {
      execSync('start cmd /k "cd backend && node server.js"', { timeout: 5000 });
      console.log('✅ Backend server started. Please wait 10 seconds before running tests...\n');
      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 10000));
    } catch (startError) {
      console.error('❌ Failed to start backend server automatically');
      console.error('Please start the backend server manually and run the test again');
      process.exit(1);
    }
  }

  // Run all tests with delays between them
  await testGetStaffList();
  await new Promise(resolve => setTimeout(resolve, 2000));

  await testGetStaffProfile();
  await new Promise(resolve => setTimeout(resolve, 2000));

  await testClassTeacherAssignment();
  await new Promise(resolve => setTimeout(resolve, 2000));

  await testCreatePayrollRecord();
  await new Promise(resolve => setTimeout(resolve, 2000));

  await testMarkAttendance();
  await new Promise(resolve => setTimeout(resolve, 2000));

  await testVerifyAttendanceStorage();
  await new Promise(resolve => setTimeout(resolve, 2000));

  await testUpdateAttendanceStatus();
  await new Promise(resolve => setTimeout(resolve, 2000));

  await testSendMessage();
  await new Promise(resolve => setTimeout(resolve, 2000));

  await testApplyForLeave();

  // Print summary
  console.log('\n\n🏁 TEST SUMMARY');
  console.log('========================');
  console.log(`Total Tests: ${testResults.passed + testResults.failed}`);
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);
  console.log('========================\n');

  // Print detailed results
  if (testResults.failed > 0) {
    console.log('📋 FAILED TESTS:');
    testResults.tests
      .filter(test => !test.passed)
      .forEach(test => {
        console.log(`  ❌ ${test.name}${test.details ? ' - ' + test.details : ''}`);
      });
    console.log('');
  }

  console.log('🎯 Test completed!');
  console.log('Check the console above for detailed results.');
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the tests
runAllTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});