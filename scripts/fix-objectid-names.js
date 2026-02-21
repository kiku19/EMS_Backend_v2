/**
 * Fix ObjectId Names in Database
 * 
 * This script finds and fixes staff/student records where the name field
 * contains a MongoDB ObjectId instead of an actual name.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Staff, Student } from '../database.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/school-management';

// Check if a string looks like a MongoDB ObjectId
function isObjectId(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[a-f\d]{24}$/i.test(str);
}

async function fixStaffNames() {
  console.log('\n📋 Checking Staff records for ObjectId names...\n');
  
  const allStaff = await Staff.find({});
  const corruptedStaff = allStaff.filter(staff => isObjectId(staff.name));
  
  console.log(`Found ${corruptedStaff.length} staff with ObjectId names out of ${allStaff.length} total staff\n`);
  
  if (corruptedStaff.length === 0) {
    console.log('✅ No corrupted staff names found!\n');
    return;
  }
  
  for (const staff of corruptedStaff) {
    console.log(`\n❌ Corrupted Staff:`);
    console.log(`   ID: ${staff._id}`);
    console.log(`   Name (ObjectId): ${staff.name}`);
    console.log(`   Code: ${staff.code || 'N/A'}`);
    console.log(`   Email: ${staff.email || 'N/A'}`);
    console.log(`   Phone: ${staff.phone || 'N/A'}`);
    console.log(`   Role: ${staff.role || 'N/A'}`);
    
    // Try to find a better name
    let newName = null;
    
    // Option 1: Use code as name
    if (staff.code && !isObjectId(staff.code)) {
      newName = `Staff ${staff.code}`;
    }
    // Option 2: Use email prefix
    else if (staff.email && !isObjectId(staff.email)) {
      const emailPrefix = staff.email.split('@')[0];
      newName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
    }
    // Option 3: Use role + ID
    else if (staff.role) {
      newName = `${staff.role} ${staff._id.toString().slice(-6)}`;
    }
    // Option 4: Generic fallback
    else {
      newName = `Staff ${staff._id.toString().slice(-6)}`;
    }
    
    console.log(`   ✅ Suggested Name: ${newName}`);
    
    // Update the staff record
    try {
      await Staff.findByIdAndUpdate(staff._id, { name: newName });
      console.log(`   ✅ Updated successfully!`);
    } catch (error) {
      console.error(`   ❌ Failed to update: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Fixed ${corruptedStaff.length} staff records\n`);
}

async function fixStudentNames() {
  console.log('\n📋 Checking Student records for ObjectId names...\n');
  
  const allStudents = await Student.find({});
  const corruptedStudents = allStudents.filter(student => isObjectId(student.name));
  
  console.log(`Found ${corruptedStudents.length} students with ObjectId names out of ${allStudents.length} total students\n`);
  
  if (corruptedStudents.length === 0) {
    console.log('✅ No corrupted student names found!\n');
    return;
  }
  
  for (const student of corruptedStudents) {
    console.log(`\n❌ Corrupted Student:`);
    console.log(`   ID: ${student._id}`);
    console.log(`   Name (ObjectId): ${student.name}`);
    console.log(`   Admission ID: ${student.admissionId || 'N/A'}`);
    console.log(`   Roll No: ${student.rollNo || 'N/A'}`);
    console.log(`   Class: ${student.class || 'N/A'}`);
    console.log(`   Parent Name: ${student.parentName || 'N/A'}`);
    
    // Try to find a better name
    let newName = null;
    
    // Option 1: Use admission ID
    if (student.admissionId && !isObjectId(student.admissionId)) {
      newName = `Student ${student.admissionId}`;
    }
    // Option 2: Use roll number and class
    else if (student.rollNo && student.class) {
      newName = `Student ${student.class}-${student.rollNo}`;
    }
    // Option 3: Use parent name + child
    else if (student.parentName && !isObjectId(student.parentName)) {
      newName = `${student.parentName}'s Child`;
    }
    // Option 4: Generic fallback
    else {
      newName = `Student ${student._id.toString().slice(-6)}`;
    }
    
    console.log(`   ✅ Suggested Name: ${newName}`);
    
    // Update the student record
    try {
      await Student.findByIdAndUpdate(student._id, { name: newName });
      console.log(`   ✅ Updated successfully!`);
    } catch (error) {
      console.error(`   ❌ Failed to update: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Fixed ${corruptedStudents.length} student records\n`);
}

async function main() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    await fixStaffNames();
    await fixStudentNames();
    
    console.log('\n✅ All done! Database has been cleaned.\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

main();
