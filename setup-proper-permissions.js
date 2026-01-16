import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function connectDB() {
  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
}

// Define schemas
const staffSchema = new mongoose.Schema({}, { strict: false });
const Staff = mongoose.model('Staff', staffSchema);

const modulePermissionSchema = new mongoose.Schema({
  module: String,
  view: Boolean,
  create: Boolean,
  edit: Boolean,
  delete: Boolean
}, { _id: false });

const userPermissionSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  role: String,
  permissions: [modulePermissionSchema],
  customPermissions: Boolean,
  lastUpdated: Date,
  updatedBy: mongoose.Schema.Types.ObjectId
}, { timestamps: true });

const UserPermission = mongoose.model('UserPermission', userPermissionSchema);

// Permission templates based on role
const PERMISSION_TEMPLATES = {
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
    'front-desk': { view: true, create: true, edit: true, delete: true }
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
    'front-desk': { view: false, create: false, edit: false, delete: false }
  }
};

function determineRole(userRole) {
  const roleLower = userRole.toLowerCase();
  if (roleLower.includes('admin') || roleLower.includes('principal')) {
    return 'admin';
  }
  return 'teacher';
}

async function setupProperPermissions() {
  try {
    await connectDB();

    // Step 1: Delete all existing permissions
    console.log('🗑️  Deleting all existing permissions...');
    const deleteResult = await UserPermission.deleteMany({});
    console.log(`   Deleted ${deleteResult.deletedCount} permission records`);

    // Step 2: Find all staff
    const allStaff = await Staff.find({});
    console.log(`\n✅ Found ${allStaff.length} staff members\n`);

    let adminCount = 0;
    let teacherCount = 0;

    // Step 3: Set up role-based permissions
    for (const staff of allStaff) {
      const role = determineRole(staff.role);
      const template = PERMISSION_TEMPLATES[role];
      
      const permissions = Object.entries(template).map(([module, perms]) => ({
        module,
        ...perms
      }));

      await UserPermission.create({
        userId: staff._id,
        role,
        permissions,
        customPermissions: false
      });

      if (role === 'admin') {
        adminCount++;
        console.log(`👑 Admin: ${staff.name} (${staff.email}) - Full Access`);
      } else {
        teacherCount++;
        console.log(`👨‍🏫 Teacher: ${staff.name} (${staff.email}) - Limited Access`);
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   Admins: ${adminCount} (Full Access)`);
    console.log(`   Teachers: ${teacherCount} (Limited Access)`);
    console.log('\n✅ Permission system properly configured!');
    console.log('\n📝 Teachers can now request additional permissions through the UI');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

setupProperPermissions();
