import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB, Staff, UserPermission } from './database.js';

dotenv.config();

async function grantVikramPermissions() {
  try {
    await connectDB();
    console.log('✅ Connected to database');

    // Find Vikram user
    const vikram = await Staff.findOne({ 
      $or: [
        { name: /vikram/i },
        { email: /vikram/i }
      ]
    });

    if (!vikram) {
      console.log('❌ Vikram user not found');
      console.log('Searching for all staff...');
      const allStaff = await Staff.find({}).select('name email code role');
      console.log('Available staff:', allStaff);
      process.exit(1);
    }

    console.log('✅ Found Vikram:', {
      id: vikram._id,
      name: vikram.name,
      email: vikram.email,
      role: vikram.role
    });

    // Define all permissions with correct structure
    const allPermissions = [
      { module: 'dashboard', view: true, create: true, edit: true, delete: true },
      { module: 'staff', view: true, create: true, edit: true, delete: true },
      { module: 'students', view: true, create: true, edit: true, delete: true },
      { module: 'classes', view: true, create: true, edit: true, delete: true },
      { module: 'attendance', view: true, create: true, edit: true, delete: true },
      { module: 'timetable', view: true, create: true, edit: true, delete: true },
      { module: 'fees', view: true, create: true, edit: true, delete: true },
      { module: 'payroll', view: true, create: true, edit: true, delete: true },
      { module: 'messaging', view: true, create: true, edit: true, delete: true },
      { module: 'reports', view: true, create: true, edit: true, delete: true },
      { module: 'settings', view: true, create: true, edit: true, delete: true },
      { module: 'front-desk', view: true, create: true, edit: true, delete: true }
    ];

    // Check if permission record exists
    let userPermission = await UserPermission.findOne({ userId: vikram._id });

    if (userPermission) {
      console.log('📝 Updating existing permissions...');
      userPermission.permissions = allPermissions;
      userPermission.role = 'admin';
      userPermission.customPermissions = true;
      userPermission.lastUpdated = new Date();
      await userPermission.save();
    } else {
      console.log('📝 Creating new permission record...');
      userPermission = await UserPermission.create({
        userId: vikram._id,
        role: 'admin',
        permissions: allPermissions,
        customPermissions: true
      });
    }

    console.log('✅ Successfully granted all permissions to Vikram!');
    console.log('Permissions:', userPermission.permissions);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

grantVikramPermissions();
