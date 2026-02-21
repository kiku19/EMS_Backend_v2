/**
 * Script to create 20 staff members and assign them as class teachers
 * Usage: node seed-staff-and-assign.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db';

// Staff Schema
const staffSchema = new mongoose.Schema({
  code: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  role: { type: [String], required: true },
  department: String,
  status: { type: String, default: 'active' },
  phone: String,
  email: String,
  joinDate: String,
  address: String,
  picture: String,
  staffType: [String],
  isClassTeacher: Boolean,
  classTeacherOf: String,
  password: { type: String, required: true },
  username: { type: String, unique: true, sparse: true },
}, { timestamps: true, strict: false });

// Hash password before saving
staffSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Class Schema
const classSchema = new mongoose.Schema({
  name: { type: String, required: true },
  section: { type: String, required: true },
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  subjects: [String],
  academicYear: { type: String, default: '2025-26' },
}, { timestamps: true });

classSchema.index({ name: 1, section: 1, academicYear: 1 }, { unique: true });

const Staff = mongoose.model('Staff', staffSchema);
const Class = mongoose.model('Class', classSchema);

// Staff data to create
const staffData = [
  { name: 'Rajesh Kumar', department: 'Mathematics', phone: '9876543210', email: 'rajesh.kumar@school.edu' },
  { name: 'Priya Sharma', department: 'Science', phone: '9876543211', email: 'priya.sharma@school.edu' },
  { name: 'Amit Verma', department: 'English', phone: '9876543212', email: 'amit.verma@school.edu' },
  { name: 'Sunita Singh', department: 'Hindi', phone: '9876543213', email: 'sunita.singh@school.edu' },
  { name: 'Rakesh Gupta', department: 'Social Studies', phone: '9876543214', email: 'rakesh.gupta@school.edu' },
  { name: 'Meena Devi', department: 'Science', phone: '9876543215', email: 'meena.devi@school.edu' },
  { name: 'Vikram Patel', department: 'Mathematics', phone: '9876543216', email: 'vikram.patel@school.edu' },
  { name: 'Anjali Rao', department: 'English', phone: '9876543217', email: 'anjali.rao@school.edu' },
  { name: 'Suresh Nair', department: 'Computer Science', phone: '9876543218', email: 'suresh.nair@school.edu' },
  { name: 'Kavita Menon', department: 'Science', phone: '9876543219', email: 'kavita.menon@school.edu' },
  { name: 'Deepak Sharma', department: 'Mathematics', phone: '9876543220', email: 'deepak.sharma@school.edu' },
  { name: 'Lakshmi Iyer', department: 'Hindi', phone: '9876543221', email: 'lakshmi.iyer@school.edu' },
  { name: 'Ramesh Pillai', department: 'Social Studies', phone: '9876543222', email: 'ramesh.pillai@school.edu' },
  { name: 'Geeta Das', department: 'English', phone: '9876543223', email: 'geeta.das@school.edu' },
  { name: 'Mohan Reddy', department: 'Science', phone: '9876543224', email: 'mohan.reddy@school.edu' },
  { name: 'Rekha Joshi', department: 'Mathematics', phone: '9876543225', email: 'rekha.joshi@school.edu' },
  { name: 'Anil Kumar', department: 'Physical Education', phone: '9876543226', email: 'anil.kumar@school.edu' },
  { name: 'Sarojini Naidu', department: 'Art', phone: '9876543227', email: 'sarojini.naidu@school.edu' },
  { name: 'Prakash Mishra', department: 'Computer Science', phone: '9876543228', email: 'prakash.mishra@school.edu' },
  { name: 'Usha Rani', department: 'Science', phone: '9876543229', email: 'usha.rani@school.edu' },
];

async function seedStaffAndAssign() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get existing classes
    const classes = await Class.find({}).sort({ name: 1, section: 1 });
    console.log(`📚 Found ${classes.length} classes`);

    if (classes.length === 0) {
      console.log('❌ No classes found. Please create classes first.');
      process.exit(1);
    }

    // Get existing staff count
    const existingStaffCount = await Staff.countDocuments();
    console.log(`👥 Found ${existingStaffCount} existing staff members`);

    // Create staff members
    const createdStaff = [];
    const defaultPassword = 'password123'; // Default password for all new staff

    for (let i = 0; i < staffData.length; i++) {
      const data = staffData[i];
      const staffCode = `EMP${String(existingStaffCount + i + 1).padStart(3, '0')}`;
      const username = data.name.toLowerCase().replace(/\s+/g, '.').substring(0, 20);

      try {
        const staff = new Staff({
          code: staffCode,
          name: data.name,
          role: ['Teacher'],
          staffType: ['Teacher'],
          department: data.department,
          phone: data.phone,
          email: data.email,
          username: username,
          password: defaultPassword,
          status: 'active',
          joinDate: new Date().toISOString().split('T')[0],
          isClassTeacher: false,
        });

        await staff.save();
        createdStaff.push(staff);
        console.log(`✅ Created staff: ${staff.name} (${staff.code})`);
      } catch (err) {
        if (err.code === 11000) {
          console.log(`⚠️ Staff already exists: ${data.name}`);
          // Try to find existing staff
          const existingStaff = await Staff.findOne({ name: data.name });
          if (existingStaff) {
            createdStaff.push(existingStaff);
          }
        } else {
          console.error(`❌ Error creating staff ${data.name}:`, err.message);
        }
      }
    }

    console.log(`\n👥 Total staff available: ${createdStaff.length}`);

    // Assign staff as class teachers
    let assignedCount = 0;
    for (let i = 0; i < Math.min(classes.length, createdStaff.length); i++) {
      const cls = classes[i];
      const staff = createdStaff[i];

      // Check if class already has a teacher
      if (cls.classTeacherId) {
        console.log(`⏭️ Class ${cls.name}-${cls.section} already has a teacher, skipping...`);
        continue;
      }

      // Update class with teacher
      cls.classTeacherId = staff._id;
      await cls.save();

      // Update staff with class teacher info
      staff.isClassTeacher = true;
      staff.classTeacherOf = `${cls.name}-${cls.section}`;
      await staff.save();

      assignedCount++;
      console.log(`✅ Assigned ${staff.name} as class teacher for ${cls.name}-${cls.section}`);
    }

    console.log(`\n🎉 Summary:`);
    console.log(`   - Created ${createdStaff.length} staff members`);
    console.log(`   - Assigned ${assignedCount} class teachers`);
    console.log(`   - Default password for all new staff: ${defaultPassword}`);
    console.log('\n✅ Done!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

seedStaffAndAssign();
