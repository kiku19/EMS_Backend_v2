import dotenv from 'dotenv';
import mongoose, { connectDB } from '../database.js';
import { Staff } from '../database.js';
import bcrypt from 'bcryptjs';
import { ensureDefaultSchool } from '../utils/schoolContext.js';

dotenv.config();

async function createAdmin() {
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB');

    // Ensure school exists
    const school = await ensureDefaultSchool();
    console.log('✅ School ensured:', school.name);

    // Check if admin already exists
    const existingAdmin = await Staff.findOne({
      email: 'admin@school.com',
      schoolId: school._id,
    });

    if (existingAdmin) {
      console.log('⚠️  Admin user already exists');
      console.log('Email:', existingAdmin.email);
      console.log('Name:', existingAdmin.name);
      await mongoose.disconnect();
      process.exit(0);
    }

    // Create admin user
    const hashedPassword = await bcrypt.hash('admin123', 10);

    const admin = await Staff.create({
      schoolId: school._id,
      code: 'ADMIN001',
      name: 'Admin User',
      email: 'admin@school.com',
      phone: '1234567890',
      password: hashedPassword,
      role: ['Admin'],
      department: 'Administration',
      status: 'active',
      joiningDate: new Date(),
    });

    console.log('✅ Admin user created successfully!');
    console.log('');
    console.log('Login credentials:');
    console.log('Email: admin@school.com');
    console.log('Password: admin123');
    console.log('');
    console.log('⚠️  Please change the password after first login!');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to create admin:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

createAdmin();
