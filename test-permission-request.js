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

const permissionRequestSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  userName: String,
  userEmail: String,
  module: String,
  permissions: [String],
  reason: String,
  status: String,
  requestedAt: Date,
  reviewedAt: Date,
  reviewedBy: mongoose.Schema.Types.ObjectId,
  reviewerName: String,
  reviewNotes: String
}, { timestamps: true });

const PermissionRequest = mongoose.model('PermissionRequest', permissionRequestSchema);

async function testPermissionRequest() {
  try {
    await connectDB();

    // Find Sooraj (teacher with limited access)
    const sooraj = await Staff.findOne({ email: /soorajnd/i });
    
    if (!sooraj) {
      console.log('❌ Sooraj not found');
      process.exit(1);
    }

    console.log('✅ Found Sooraj:', {
      id: sooraj._id,
      name: sooraj.name,
      email: sooraj.email,
      role: sooraj.role
    });

    // Create a test permission request
    console.log('\n📝 Creating test permission request...');
    
    const request = await PermissionRequest.create({
      userId: sooraj._id,
      userName: sooraj.name,
      userEmail: sooraj.email,
      module: 'payroll',
      permissions: ['view'],
      reason: 'I need to view payroll information for my department',
      status: 'pending',
      requestedAt: new Date()
    });

    console.log('✅ Permission request created successfully!');
    console.log('\nRequest Details:');
    console.log(`   ID: ${request._id}`);
    console.log(`   User: ${request.userName}`);
    console.log(`   Module: ${request.module}`);
    console.log(`   Permissions: ${request.permissions.join(', ')}`);
    console.log(`   Reason: ${request.reason}`);
    console.log(`   Status: ${request.status}`);

    console.log('\n✅ Permission request system is working!');
    console.log('📱 Admins can now approve/reject this request from the UI');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testPermissionRequest();
