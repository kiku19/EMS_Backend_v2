// Migration script to create/update UserPermissions for all existing staff
// This syncs staff roles with user permissions

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import UserPermission from './models/UserPermission.js';
import { Staff } from './database.js';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school-management';

// Role mapping from staff roles to permission roles
const ROLE_MAPPING = {
  'Admin': 'admin',
  'Principal': 'admin', // Map to admin for now since principal not in enum
  'Vice Principal': 'admin', // Map to admin for now
  'Teacher': 'teacher',
  'Accountant': 'accountant',
  'Librarian': 'teacher', // Map to teacher for now
  'Lab Assistant': 'teacher', // Map to teacher for now
  'Receptionist': 'receptionist',
  // Legacy mappings
  'Administrative': 'admin',
  'Administration': 'admin',
  'Teaching': 'teacher'
};

// Convert PERMISSION_TEMPLATES object format to array format
function convertPermissionsToArray(permissionsObj) {
  const permissionsArray = [];
  
  for (const [module, actions] of Object.entries(permissionsObj)) {
    permissionsArray.push({
      module,
      view: actions.view || false,
      create: actions.create || false,
      edit: actions.edit || false,
      delete: actions.delete || false
    });
  }
  
  return permissionsArray;
}

// Get default permissions for a role
function getDefaultPermissions(role) {
  const templates = {
    admin: {
      dashboard: { view: true, create: true, edit: true, delete: true },
      staff: { view: true, create: true, edit: true, delete: true },
      students: { view: true, create: true, edit: true, delete: true },
      classes: { view: true, create: true, edit: true, delete: true },
      attendance: { view: true, create: true, edit: true, delete: true },
      timetable: { view: true, create: true, edit: true, delete: true },
      fees: { view: true, create: true, edit: true, delete: true },
      payroll: { view: true, create: true, edit: true, delete: true },
      messaging: { view: true, create: true, edit: true, delete: true },
      reports: { view: true, create: true, edit: true, delete: true },
      settings: { view: true, create: true, edit: true, delete: true },
      'front-desk': { view: true, create: true, edit: true, delete: true },
      'intake-forms': { view: true, create: true, edit: true, delete: true }
    },
    teacher: {
      dashboard: { view: true, create: false, edit: false, delete: false },
      staff: { view: true, create: false, edit: false, delete: false },
      students: { view: true, create: false, edit: true, delete: false },
      classes: { view: true, create: false, edit: false, delete: false },
      attendance: { view: true, create: true, edit: true, delete: false },
      timetable: { view: true, create: false, edit: false, delete: false },
      fees: { view: true, create: false, edit: false, delete: false },
      payroll: { view: false, create: false, edit: false, delete: false },
      messaging: { view: true, create: true, edit: true, delete: false },
      reports: { view: true, create: false, edit: false, delete: false },
      settings: { view: false, create: false, edit: false, delete: false },
      'front-desk': { view: false, create: false, edit: false, delete: false },
      'intake-forms': { view: true, create: true, edit: true, delete: false }
    },
    accountant: {
      dashboard: { view: true, create: false, edit: false, delete: false },
      staff: { view: true, create: false, edit: false, delete: false },
      students: { view: true, create: false, edit: false, delete: false },
      classes: { view: true, create: false, edit: false, delete: false },
      attendance: { view: true, create: false, edit: false, delete: false },
      timetable: { view: false, create: false, edit: false, delete: false },
      fees: { view: true, create: true, edit: true, delete: true },
      payroll: { view: true, create: true, edit: true, delete: false },
      messaging: { view: true, create: true, edit: false, delete: false },
      reports: { view: true, create: false, edit: false, delete: false },
      settings: { view: false, create: false, edit: false, delete: false },
      'front-desk': { view: false, create: false, edit: false, delete: false },
      'intake-forms': { view: true, create: false, edit: false, delete: false }
    },
    receptionist: {
      dashboard: { view: true, create: false, edit: false, delete: false },
      staff: { view: true, create: false, edit: false, delete: false },
      students: { view: true, create: true, edit: true, delete: false },
      classes: { view: true, create: false, edit: false, delete: false },
      attendance: { view: true, create: false, edit: false, delete: false },
      timetable: { view: false, create: false, edit: false, delete: false },
      fees: { view: true, create: false, edit: false, delete: false },
      payroll: { view: false, create: false, edit: false, delete: false },
      messaging: { view: true, create: true, edit: false, delete: false },
      reports: { view: false, create: false, edit: false, delete: false },
      settings: { view: false, create: false, edit: false, delete: false },
      'front-desk': { view: true, create: true, edit: true, delete: false },
      'intake-forms': { view: true, create: true, edit: true, delete: false }
    }
  };
  
  return convertPermissionsToArray(templates[role] || templates.teacher);
}

async function migrateStaffPermissions() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all staff members
    const allStaff = await Staff.find({});
    console.log(`📊 Found ${allStaff.length} staff members\n`);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const staff of allStaff) {
      try {
        // Get staff roles (handle both array and string)
        const staffRoles = Array.isArray(staff.role) ? staff.role : [staff.role];
        
        // Use the first role or default to teacher
        const firstRole = staffRoles[0] || 'Teacher';
        const permissionRole = ROLE_MAPPING[firstRole] || 'teacher';

        // Check if permission already exists
        const existingPermission = await UserPermission.findOne({ userId: staff._id });

        if (existingPermission) {
          // Update existing permission
          existingPermission.role = permissionRole;
          existingPermission.permissions = getDefaultPermissions(permissionRole);
          existingPermission.lastUpdated = new Date();
          await existingPermission.save();
          
          console.log(`✅ Updated: ${staff.name} (${staff.code}) - Staff Role: ${firstRole} → Permission Role: ${permissionRole}`);
          updated++;
        } else {
          // Create new permission
          await UserPermission.create({
            userId: staff._id,
            role: permissionRole,
            permissions: getDefaultPermissions(permissionRole),
            customPermissions: false
          });
          
          console.log(`✨ Created: ${staff.name} (${staff.code}) - Staff Role: ${firstRole} → Permission Role: ${permissionRole}`);
          created++;
        }
      } catch (error) {
        console.error(`❌ Error processing ${staff.name} (${staff.code}):`, error.message);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(60));
    console.log(`✨ Created: ${created} new permissions`);
    console.log(`✅ Updated: ${updated} existing permissions`);
    console.log(`⏭️  Skipped: ${skipped} staff members`);
    console.log(`❌ Errors: ${errors} failed`);
    console.log('='.repeat(60));
    console.log('\n✅ Migration completed successfully!');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
console.log('🚀 Starting Staff Permissions Migration...\n');
migrateStaffPermissions();
