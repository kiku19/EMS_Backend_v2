// Script to grant admin permissions to a user
// Usage: node grant-admin-permission.js <staffId>

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import UserPermission, { PERMISSION_TEMPLATES } from './models/UserPermission.js';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school-management';

async function grantAdminPermission(staffId) {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check if permission already exists
    let permission = await UserPermission.findOne({ staffId });

    if (permission) {
      // Update existing permission to admin
      permission.role = 'admin';
      permission.permissions = PERMISSION_TEMPLATES.admin;
      await permission.save();
      console.log(`✅ Updated permissions for staff ${staffId} to admin`);
    } else {
      // Create new permission
      permission = await UserPermission.create({
        staffId,
        role: 'admin',
        permissions: PERMISSION_TEMPLATES.admin
      });
      console.log(`✅ Created admin permissions for staff ${staffId}`);
    }

    console.log('✅ Done! User now has admin permissions.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

const staffId = process.argv[2];
if (!staffId) {
  console.error('❌ Please provide a staff ID');
  console.log('Usage: node grant-admin-permission.js <staffId>');
  process.exit(1);
}

grantAdminPermission(staffId);
