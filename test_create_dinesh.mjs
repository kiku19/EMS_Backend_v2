import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

// MongoDB connection string
const MONGODB_URI = process.env.MONGO_URI || 'mongodb+srv://eguser1:dummy123@cluster0.vy5smtv.mongodb.net/school_db?retryWrites=true&w=majority&appName=Cluster0';

// Staff Schema
const staffSchema = new mongoose.Schema({
  code: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  role: { type: String, required: true },
  department: String,
  status: { type: String, default: 'active' },
  phone: String,
  email: String,
  joinDate: String,
  address: String,

  // Personal Details
  dob: String,
  gender: String,
  fatherName: String,
  bloodGroup: String,
  maritalStatus: String,
  employmentType: String,
  emergencyContact: String,
  emergencyPhone: String,
  emergencyContacts: [{
    name: String,
    relationship: String,
    phone: String
  }],
  whatsappNumber: String,
  isWhatsapp: { type: Boolean, default: false },

  // Documents
  picture: String,
  idDocuments: [{
    type: String,
    url: String,
    name: String
  }],

  // Qualifications
  professionalQualifications: [{
    name: String,
    year: String,
    documents: [String]
  }],
  totalExperience: String,
  previousOrganization: String,
  roleInOrganization: String,
  qualificationDocs: [String],
  customDocuments: [String],

  // Staff Info
  staffNumber: String,
  staffType: String,
  assignedClasses: [String],
  isClassTeacher: Boolean,
  classTeacherOf: String,

  // Bank & Salary
  accountNumber: String,
  ifscCode: String,
  bankName: String,
  branchName: String,
  salary: { type: Number, default: 0 },
  salaryTemplate: String,
  salaryBreakdown: [{
    component: String,
    amount: Number
  }],

  // Login credentials
  username: { type: String, unique: true, sparse: true },
  password: { type: String, required: true },

  // Hierarchy
  reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
}, { timestamps: true });

// Hash password before saving
staffSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

const Staff = mongoose.model('Staff', staffSchema);

// DINESH data
const dineshData = {
  code: 'STF-2025-DINESH',
  name: 'DINESH KUMAR',
  role: 'Teacher',
  department: 'Mathematics',
  status: 'active',
  phone: '9876543210',
  email: 'dinesh.kumar@school.com',
  joinDate: '2025-01-01',
  address: '123, Main Street, Chennai',

  // Personal Details
  dob: '1990-05-15',
  gender: 'Male',
  fatherName: 'Rajendra Kumar',
  bloodGroup: 'B+',
  maritalStatus: 'Married',
  employmentType: 'Full-time',
  whatsappNumber: '9876543210',
  isWhatsapp: true,

  // Emergency Contact
  emergencyContacts: [{
    name: 'Priya Kumar',
    relationship: 'Spouse',
    phone: '9876543211'
  }],

  // Qualifications
  professionalQualifications: [
    {
      name: 'M.Sc Mathematics',
      year: '2015',
      documents: []
    },
    {
      name: 'B.Ed',
      year: '2017',
      documents: []
    }
  ],
  totalExperience: '8 years',
  previousOrganization: 'ABC Public School',
  roleInOrganization: 'Senior Mathematics Teacher',

  // Staff Info
  staffNumber: 'STF-2025-DINESH',
  staffType: 'Teacher',
  assignedClasses: ['10-A', '10-B'],
  isClassTeacher: true,
  classTeacherOf: '10-A',

  // Bank & Salary
  accountNumber: '1234567890',
  ifscCode: 'SBIN0001234',
  bankName: 'SBI',
  branchName: 'Chennai Main',
  salary: 38000,
  salaryBreakdown: [
    { component: 'Basic', amount: 25000 },
    { component: 'HRA', amount: 8000 },
    { component: 'DA', amount: 5000 }
  ],

  // Login credentials (password will be hashed by pre-save hook)
  username: 'dinesh.kumar',
  password: 'Dinesh@123' // This will be hashed before saving
};

// Main function to create DINESH
async function createDinesh() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB successfully');

    // Check if DINESH already exists
    console.log('Checking if DINESH already exists...');
    const existingStaff = await Staff.findOne({
      $or: [
        { code: 'STF-2025-DINESH' },
        { email: 'dinesh.kumar@school.com' },
        { username: 'dinesh.kumar' }
      ]
    });

    if (existingStaff) {
      console.log('⚠️ Staff member already exists with code/email/username:');
      console.log('   - Code:', existingStaff.code);
      console.log('   - Name:', existingStaff.name);
      console.log('   - Email:', existingStaff.email);
      console.log('   - MongoDB _id:', existingStaff._id.toString());
      await mongoose.connection.close();
      return;
    }

    // Create new staff member
    console.log('Creating DINESH KUMAR...');
    const dinesh = new Staff(dineshData);
    const savedDinesh = await dinesh.save();

    console.log('\n✅ DINESH created successfully!');
    console.log('\n========================================');
    console.log('STAFF DETAILS');
    console.log('========================================');
    console.log('MongoDB _id:', savedDinesh._id.toString());
    console.log('Code:', savedDinesh.code);
    console.log('Name:', savedDinesh.name);
    console.log('Email:', savedDinesh.email);
    console.log('Username:', savedDinesh.username);
    console.log('Role:', savedDinesh.role);
    console.log('Department:', savedDinesh.department);
    console.log('Staff Number:', savedDinesh.staffNumber);
    console.log('Staff Type:', savedDinesh.staffType);
    console.log('Status:', savedDinesh.status);
    console.log('Mobile:', savedDinesh.phone);
    console.log('WhatsApp:', savedDinesh.whatsappNumber);
    console.log('Is Class Teacher:', savedDinesh.isClassTeacher);
    console.log('Class Teacher Of:', savedDinesh.classTeacherOf);
    console.log('Assigned Classes:', savedDinesh.assignedClasses.join(', '));
    console.log('Salary:', savedDinesh.salary);
    console.log('Salary Breakdown:');
    savedDinesh.salaryBreakdown.forEach(item => {
      console.log(`  - ${item.component}: ${item.amount}`);
    });
    console.log('Bank:', savedDinesh.bankName, '-', savedDinesh.branchName);
    console.log('Account Number:', savedDinesh.accountNumber);
    console.log('IFSC Code:', savedDinesh.ifscCode);
    console.log('========================================\n');

    console.log('You can now use these credentials to login:');
    console.log('Username: dinesh.kumar');
    console.log('Password: Dinesh@123');

  } catch (error) {
    console.error('❌ Error creating DINESH:', error.message);
    if (error.code === 11000) {
      console.error('Duplicate key error. A staff member with this code/email/username already exists.');
    }
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
  }
}

// Run the function
createDinesh();
