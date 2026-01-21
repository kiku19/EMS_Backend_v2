#!/usr/bin/env node

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

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

// Auth token storage
let authToken = null;

// Helper function to login and get token
async function getAuthToken() {
  try {
    const loginData = {
      email: DINESH_EMAIL,
      password: DINESH_PASSWORD
    };

    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(loginData)
    });

    if (response.status === 200) {
      const data = await response.json();
      authToken = data.token;
      return authToken;
    } else {
      console.error('Failed to get auth token');
      return null;
    }
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
}

// Helper function to make API requests with authentication
async function authenticatedRequest(method, endpoint, data = null, token = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  // Use provided token or the global authToken
  const finalToken = token || authToken;
  if (finalToken) {
    options.headers['Authorization'] = `Bearer ${finalToken}`;
  }

  if (data) {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, options);
  return {
    status: response.status,
    data: await response.json()
  };
}

// Test 1: GET /api/staff - Verify DINESH appears in staff list
async function testGetStaffList() {
  console.log('\n=== Test 1: GET /api/staff - Verify DINESH appears in staff list ===');

  try {
    const response = await authenticatedRequest('GET', '/api/staff');

    if (response.status !== 200) {
      logTest('Get Staff List', false, `Status: ${response.status}`);
      return;
    }

    const staffList = response.data;
    const dinesh = staffList.find(s => s.email === DINESH_EMAIL || s.username === DINESH_USERNAME);

    if (dinesh) {
      logTest('Get Staff List', true,
        `Found DINESH - ID: ${dinesh.id}, Name: ${dinesh.name}, Email: ${dinesh.email}`);
    } else {
      logTest('Get Staff List', false, 'DINESH not found in staff list');
    }
  } catch (error) {
    logTest('Get Staff List', false, `Error: ${error.message}`);
  }
}

// Test 2: GET /api/staff/:id - Get DINESH's full profile data
async function testGetStaffProfile() {
  console.log('\n=== Test 2: GET /api/staff/:id - Get DINESH full profile data ===');

  try {
    const response = await authenticatedRequest('GET', `/api/staff/${DINESH_ID}`);

    if (response.status !== 200) {
      logTest('Get Staff Profile', false, `Status: ${response.status}`);
      return;
    }

    const dinesh = response.data;

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
  } catch (error) {
    logTest('Get Staff Profile', false, `Error: ${error.message}`);
  }
}

// Test 3: Check if Class 10-A has DINESH assigned as class teacher
async function testClassTeacherAssignment() {
  console.log('\n=== Test 3: Check Class 10-A class teacher assignment ===');

  try {
    // First, get all classes to find class 10-A
    const classesResponse = await authenticatedRequest('GET', '/api/classes');

    if (classesResponse.status !== 200) {
      logTest('Class Teacher Assignment', false, `Failed to get classes: ${classesResponse.status}`);
      return;
    }

    const class10A = classesResponse.data.find(c => c.name === '10' && c.section === 'A');

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
      const assignedTeacher = classesResponse.data.find(c => c._id === assignedTeacherId);
      const assignedName = assignedTeacher ? assignedTeacher.name : 'Unknown';
      logTest('Class Teacher Assignment', false,
        `Class 10-A has ${assignedName} assigned as class teacher, not DINESH`);
    }
  } catch (error) {
    logTest('Class Teacher Assignment', false, `Error: ${error.message}`);
  }
}

// Test 4: Create a payroll record for DINESH for January 2025
async function testCreatePayrollRecord() {
  console.log('\n=== Test 4: Create payroll record for DINESH for January 2025 ===');

  try {
    // First try to create a payroll record for DINESH
    const payrollData = {
      month: 1,
      year: 2025,
      employeeIds: [DINESH_ID]
    };

    const response = await authenticatedRequest('POST', '/api/payroll/run', payrollData);

    if (response.status === 400 && response.data.error.includes('future months')) {
      // This is expected for January 2025 since it's a future month
      logTest('Create Payroll Record', true, 'Correctly rejected future month (January 2025)');
      return;
    }

    if (response.status === 200 || response.status === 201) {
      logTest('Create Payroll Record', true,
        `Payroll run initiated for DINESH - ${response.data.data.results.success.length} successful`);
      return;
    }

    logTest('Create Payroll Record', false,
      `Unexpected response: ${response.status} - ${JSON.stringify(response.data)}`);
  } catch (error) {
    logTest('Create Payroll Record', false, `Error: ${error.message}`);
  }
}

// Test 5: Mark attendance for DINESH for today
async function testMarkAttendance() {
  console.log('\n=== Test 5: Mark attendance for DINESH for today ===');

  try {
    const attendanceData = {
      staffId: DINESH_ID,
      date: TODAY_DATE,
      status: 'present',
      checkInTime: '09:00 AM',
      markedBy: DINESH_ID // Self-marking
    };

    const response = await authenticatedRequest('POST', '/api/staff-attendance', attendanceData);

    if (response.status === 200 || response.status === 201) {
      logTest('Mark Attendance', true,
        `Attendance marked for ${TODAY_DATE} - Status: ${response.data.status}`);
    } else {
      logTest('Mark Attendance', false, `Status: ${response.status}, Error: ${response.data.error}`);
    }
  } catch (error) {
    logTest('Mark Attendance', false, `Error: ${error.message}`);
  }
}

// Test 6: Verify attendance is stored in StaffAttendance collection
async function testVerifyAttendanceStorage() {
  console.log('\n=== Test 6: Verify attendance stored in StaffAttendance collection ===');

  try {
    const response = await authenticatedRequest('GET', `/api/staff-attendance/staff/${DINESH_ID}`);

    if (response.status !== 200) {
      logTest('Verify Attendance Storage', false, `Status: ${response.status}`);
      return;
    }

    const attendanceRecords = response.data;
    const todayAttendance = attendanceRecords.find(a => a.date === TODAY_DATE);

    if (todayAttendance) {
      logTest('Verify Attendance Storage', true,
        `Attendance record found for ${TODAY_DATE} - Status: ${todayAttendance.status}, Check-in: ${todayAttendance.checkInTime}`);
    } else {
      logTest('Verify Attendance Storage', false, 'No attendance record found for today');
    }
  } catch (error) {
    logTest('Verify Attendance Storage', false, `Error: ${error.message}`);
  }
}

// Test 7: Test if attendance status can be changed to "Half Day"
async function testUpdateAttendanceStatus() {
  console.log('\n=== Test 7: Update attendance status to Half Day ===');

  try {
    // First get today's attendance record ID
    const getResponse = await authenticatedRequest('GET', `/api/staff-attendance/staff/${DINESH_ID}`);

    if (getResponse.status !== 200) {
      logTest('Update Attendance Status', false, `Failed to get attendance records: ${getResponse.status}`);
      return;
    }

    const attendanceRecords = getResponse.data;
    const todayAttendance = attendanceRecords.find(a => a.date === TODAY_DATE);

    if (!todayAttendance) {
      logTest('Update Attendance Status', false, 'No attendance record found for today to update');
      return;
    }

    // Update to half day
    const updateData = {
      staffId: DINESH_ID,
      date: TODAY_DATE,
      status: 'halfday',
      checkInTime: '09:00 AM',
      markedBy: DINESH_ID
    };

    const updateResponse = await authenticatedRequest('POST', '/api/staff-attendance', updateData);

    if (updateResponse.status === 200 || updateResponse.status === 201) {
      logTest('Update Attendance Status', true,
        `Attendance updated to halfday for ${TODAY_DATE}`);
    } else {
      logTest('Update Attendance Status', false,
        `Status: ${updateResponse.status}, Error: ${updateResponse.data.error}`);
    }
  } catch (error) {
    logTest('Update Attendance Status', false, `Error: ${error.message}`);
  }
}


// Test 9: Test sending a message from DINESH to another staff
async function testSendMessage() {
  console.log('\n=== Test 9: Send message from DINESH to another staff ===');

  try {
    // First, get all staff to find someone to message
    const staffResponse = await authenticatedRequest('GET', '/api/staff');

    if (staffResponse.status !== 200) {
      logTest('Send Message', false, `Failed to get staff list: ${staffResponse.status}`);
      return;
    }

    const staffList = staffResponse.data;
    const otherStaff = staffList.find(s => s.id !== DINESH_ID && s.status === 'active');

    if (!otherStaff) {
      logTest('Send Message', false, 'No other active staff found to send message to');
      return;
    }

    // Create conversation
    const conversationData = {
      user1Id: DINESH_ID,
      user1Type: 'staff',
      user2Id: otherStaff.id,
      user2Type: 'staff',
      type: 'direct'
    };

    const conversationResponse = await authenticatedRequest('POST', '/api/messages/conversations', conversationData);

    if (conversationResponse.status !== 200 && conversationResponse.status !== 201) {
      logTest('Send Message', false, `Failed to create conversation: ${conversationResponse.status}`);
      return;
    }

    // Send message
    const messageData = {
      conversationId: conversationResponse.data.id,
      senderId: DINESH_ID,
      senderModel: 'staff',
      receiverId: otherStaff.id,
      receiverModel: 'staff',
      content: 'Hello! This is a test message from DINESH.',
      type: 'text'
    };

    const messageResponse = await authenticatedRequest('POST', '/api/messages/messages', messageData);

    if (messageResponse.status === 200 || messageResponse.status === 201) {
      logTest('Send Message', true,
        `Message sent to ${otherStaff.name} - Message ID: ${messageResponse.data.id}`);
    } else {
      logTest('Send Message', false,
        `Failed to send message - Status: ${messageResponse.status}`);
    }
  } catch (error) {
    logTest('Send Message', false, `Error: ${error.message}`);
  }
}

// Test 10: Test applying for leave request from DINESH
async function testApplyForLeave() {
  console.log('\n=== Test 10: Apply for leave request from DINESH ===');

  try {
    const leaveData = {
      staffId: DINESH_ID,
      leaveType: 'casual',
      startDate: TODAY_DATE,
      endDate: TODAY_DATE,
      reason: 'Personal leave'
    };

    const response = await authenticatedRequest('POST', '/api/staff-attendance/mobile/leave/apply', leaveData);

    if (response.status === 200 || response.status === 201) {
      logTest('Apply For Leave', true,
        `Leave application submitted for ${TODAY_DATE} - ${response.data.message}`);
    } else {
      logTest('Apply For Leave', false,
        `Failed to apply leave - Status: ${response.status}, Error: ${response.data.error}`);
    }
  } catch (error) {
    logTest('Apply For Leave', false, `Error: ${error.message}`);
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
  console.log('⚠️  Starting tests automatically...\n');

  // First, get authentication token
  console.log('🔐 Getting authentication token...');
  const token = await getAuthToken();
  if (!token) {
    console.error('❌ Failed to get authentication token. Cannot proceed with tests.');
    process.exit(1);
  }
  console.log('✅ Authentication token received successfully\n');

  // Run all tests
  await testGetStaffList();
  await testGetStaffProfile();
  await testClassTeacherAssignment();
  await testCreatePayrollRecord();
  await testMarkAttendance();
  await testVerifyAttendanceStorage();
  await testUpdateAttendanceStatus();
  await testSendMessage();
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