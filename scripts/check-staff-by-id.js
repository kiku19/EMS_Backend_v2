/**
 * Check Staff by ID
 * 
 * This script checks a specific staff member's data to diagnose issues
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Staff } from '../database.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/school-management';

// Get staff ID from command line argument
const staffId = process.argv[2] || '69900115d125322003266f9d';

async function checkStaff() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    console.log(`📋 Looking up staff with ID: ${staffId}\n`);
    
    const staff = await Staff.findById(staffId).populate('reporterId', 'name code');
    
    if (!staff) {
      console.log('❌ Staff not found!\n');
      return;
    }
    
    console.log('📄 Staff Record:');
    console.log('================\n');
    
    // Check if name is an ObjectId
    const nameIsObjectId = /^[a-f\d]{24}$/i.test(staff.name);
    
    console.log(`ID: ${staff._id}`);
    console.log(`Name: ${staff.name} ${nameIsObjectId ? '⚠️ (IS AN OBJECTID!)' : '✅'}`);
    console.log(`Code: ${staff.code || 'N/A'}`);
    console.log(`Email: ${staff.email || 'N/A'}`);
    console.log(`Phone: ${staff.phone || 'N/A'}`);
    console.log(`Role: ${staff.role || 'N/A'}`);
    console.log(`Department: ${staff.department || 'N/A'}`);
    console.log(`Status: ${staff.status || 'N/A'}`);
    console.log(`Username: ${staff.username || 'N/A'}`);
    console.log(`Join Date: ${staff.joinDate || 'N/A'}`);
    
    if (staff.reporterId) {
      console.log(`\nReporter:`);
      console.log(`  ID: ${staff.reporterId._id}`);
      console.log(`  Name: ${staff.reporterId.name}`);
      console.log(`  Code: ${staff.reporterId.code || 'N/A'}`);
    }
    
    if (nameIsObjectId) {
      console.log('\n⚠️ WARNING: The name field contains a MongoDB ObjectId!');
      console.log('This is a data corruption issue that needs to be fixed.\n');
      
      // Suggest a fix
      let suggestedName = null;
      if (staff.code) {
        suggestedName = `Staff ${staff.code}`;
      } else if (staff.email) {
        const emailPrefix = staff.email.split('@')[0];
        suggestedName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
      } else {
        suggestedName = `${staff.role || 'Staff'} ${staff._id.toString().slice(-6)}`;
      }
      
      console.log(`💡 Suggested fix: Update name to "${suggestedName}"`);
      console.log(`\nTo fix this, run:`);
      console.log(`  node backend/scripts/fix-objectid-names.js`);
      console.log(`\nOr manually update in MongoDB:`);
      console.log(`  db.staff.updateOne({ _id: ObjectId("${staffId}") }, { $set: { name: "${suggestedName}" } })`);
    }
    
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

checkStaff();
