import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Use production MongoDB URI
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

console.log('🔗 Connecting to:', MONGODB_URI ? 'Production Database' : 'Local Database');

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

// Define schemas inline
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

async function grantAllStaffPermissions() {
  try {
    await connectDB();

    // Find all staff
    const allStaff = await Staff.find({});
    console.log(`✅ Found ${allStaff.length} staff members`);

    // Define all permissions
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

    let updated = 0;
    let created = 0;

    for (const staff of allStaff) {
      try {
        let userPermission = await UserPermission.findOne({ userId: staff._id });

        if (userPermission) {
          userPermission.permissions = allPermissions;
          userPermission.role = 'admin';
          userPermission.customPermissions = true;
          userPermission.lastUpdated = new Date();
          await userPermission.save();
          updated++;
          console.log(`✅ Updated permissions for: ${staff.name} (${staff.email})`);
        } else {
          await UserPermission.create({
            userId: staff._id,
            role: 'admin',
            permissions: allPermissions,
            customPermissions: true
          });
          created++;
          console.log(`✅ Created permissions for: ${staff.name} (${staff.email})`);
        }
      } catch (error) {
        console.error(`❌ Error processing ${staff.name}:`, error.message);
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Total: ${created + updated}`);
    console.log('\n✅ All staff now have full permissions!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

grantAllStaffPermissions();
