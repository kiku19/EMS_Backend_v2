import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, Staff } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend directory
dotenv.config({ path: path.join(__dirname, '.env') });

const staffData = [
  {
    code: 'EMP001',
    name: 'Dr. Rajesh Kumar',
    role: 'Principal',
    department: 'Administration',
    status: 'active',
    
    // Login Credentials
    username: 'rajesh.kumar',
    password: 'admin123',
    email: 'rajesh.kumar@school.com',
    phone: '9876543210',
    
    // Personal Details
    dob: '1975-05-15',
    gender: 'Male',
    fatherName: 'Ramesh Kumar',
    bloodGroup: 'O+',
    maritalStatus: 'Married',
    employmentType: 'Permanent',
    
    // Contact
    emergencyContact: 'Sunita Kumar',
    emergencyPhone: '9876543211',
    whatsappNumber: '9876543210',
    address: '123, MG Road, Bangalore, Karnataka - 560001',
    
    // Documents
    picture: 'https://i.pravatar.cc/150?img=12',
    idDocuments: ['https://example.com/aadhaar-rajesh.pdf', 'https://example.com/pan-rajesh.pdf'],
    
    // Qualifications
    professionalQualifications: [
      {
        name: 'Ph.D. in Education - Educational Leadership',
        year: '2005',
        documents: ['https://example.com/phd-cert.pdf']
      },
      {
        name: 'M.Ed - Educational Administration',
        year: '1998',
        documents: ['https://example.com/med-cert.pdf']
      }
    ],
    totalExperience: '25 years',
    previousOrganization: 'St. Mary\'s School, Delhi',
    qualificationDocs: ['https://example.com/phd-cert.pdf', 'https://example.com/med-cert.pdf'],
    
    // Staff Info
    staffNumber: 'STF001',
    staffType: 'Administrative',
    expertise: 'Educational Leadership, School Management, Curriculum Development',
    assignedClasses: [],
    isClassTeacher: false,
    classTeacherOf: null,
    
    // Bank & Salary
    accountNumber: '1234567890',
    ifscCode: 'SBIN0001234',
    bankName: 'State Bank of India',
    branchName: 'MG Road Branch',
    salaryTemplate: 'Principal Grade A',
    salaryBreakdown: [
      { component: 'Basic', amount: 80000 },
      { component: 'HRA', amount: 32000 },
      { component: 'DA', amount: 16000 },
      { component: 'TA', amount: 8000 },
      { component: 'Special Allowance', amount: 20000 }
    ],
    
    joinDate: '2015-06-01',
    reporterId: null
  },
  
  {
    code: 'EMP002',
    name: 'Priya Sharma',
    role: 'Vice Principal',
    department: 'Administration',
    status: 'active',
    
    // Login Credentials
    username: 'priya.sharma',
    password: 'admin123',
    email: 'priya.sharma@school.com',
    phone: '9876543220',
    
    // Personal Details
    dob: '1980-08-22',
    gender: 'Female',
    fatherName: 'Vijay Sharma',
    bloodGroup: 'A+',
    maritalStatus: 'Married',
    employmentType: 'Permanent',
    
    // Contact
    emergencyContact: 'Amit Sharma',
    emergencyPhone: '9876543221',
    whatsappNumber: '9876543220',
    address: '456, Brigade Road, Bangalore, Karnataka - 560025',
    
    // Documents
    picture: 'https://i.pravatar.cc/150?img=5',
    idDocuments: ['https://example.com/aadhaar-priya.pdf', 'https://example.com/pan-priya.pdf'],
    
    // Qualifications
    professionalQualifications: [
      {
        name: 'M.Ed - Educational Psychology',
        year: '2003',
        documents: ['https://example.com/med-cert2.pdf']
      },
      {
        name: 'B.Ed - Secondary Education',
        year: '2001',
        documents: ['https://example.com/bed-cert2.pdf']
      }
    ],
    totalExperience: '20 years',
    previousOrganization: 'Delhi Public School, Bangalore',
    qualificationDocs: ['https://example.com/med-cert2.pdf', 'https://example.com/bed-cert2.pdf'],
    
    // Staff Info
    staffNumber: 'STF002',
    staffType: 'Administrative',
    expertise: 'Academic Coordination, Student Counseling, Teacher Training',
    assignedClasses: [],
    isClassTeacher: false,
    classTeacherOf: null,
    
    // Bank & Salary
    accountNumber: '2345678901',
    ifscCode: 'HDFC0001234',
    bankName: 'HDFC Bank',
    branchName: 'Brigade Road Branch',
    salaryTemplate: 'Vice Principal Grade A',
    salaryBreakdown: [
      { component: 'Basic', amount: 65000 },
      { component: 'HRA', amount: 26000 },
      { component: 'DA', amount: 13000 },
      { component: 'TA', amount: 6500 },
      { component: 'Special Allowance', amount: 15000 }
    ],
    
    joinDate: '2016-07-15',
    reporterId: null // Will be set to Principal's ID after creation
  },
  
  {
    code: 'EMP003',
    name: 'Amit Verma',
    role: 'Teacher',
    department: 'Mathematics',
    status: 'active',
    
    // Login Credentials
    username: 'amit.verma',
    password: 'teacher123',
    email: 'amit.verma@school.com',
    phone: '9876543230',
    
    // Personal Details
    dob: '1985-03-10',
    gender: 'Male',
    fatherName: 'Suresh Verma',
    bloodGroup: 'B+',
    maritalStatus: 'Single',
    employmentType: 'Permanent',
    
    // Contact
    emergencyContact: 'Suresh Verma',
    emergencyPhone: '9876543231',
    whatsappNumber: '9876543230',
    address: '789, Indiranagar, Bangalore, Karnataka - 560038',
    
    // Documents
    picture: 'https://i.pravatar.cc/150?img=33',
    idDocuments: ['https://example.com/aadhaar-amit.pdf', 'https://example.com/pan-amit.pdf'],
    
    // Qualifications
    professionalQualifications: [
      {
        name: 'M.Sc Mathematics - Applied Mathematics',
        year: '2008',
        documents: ['https://example.com/msc-cert.pdf']
      },
      {
        name: 'B.Ed - Mathematics Education',
        year: '2009',
        documents: ['https://example.com/bed-cert3.pdf']
      }
    ],
    totalExperience: '12 years',
    previousOrganization: 'National Public School, Bangalore',
    qualificationDocs: ['https://example.com/msc-cert.pdf', 'https://example.com/bed-cert3.pdf'],
    
    // Staff Info
    staffNumber: 'STF003',
    staffType: 'Teaching',
    expertise: 'Advanced Mathematics, Competitive Exam Preparation, Olympiad Training',
    assignedClasses: ['Class 10-A', 'Class 10-B'],
    isClassTeacher: true,
    classTeacherOf: 'Class 10-A',
    
    // Bank & Salary
    accountNumber: '3456789012',
    ifscCode: 'ICIC0001234',
    bankName: 'ICICI Bank',
    branchName: 'Indiranagar Branch',
    salaryTemplate: 'Senior Teacher Grade B',
    salaryBreakdown: [
      { component: 'Basic', amount: 45000 },
      { component: 'HRA', amount: 18000 },
      { component: 'DA', amount: 9000 },
      { component: 'TA', amount: 4500 },
      { component: 'Special Allowance', amount: 8000 }
    ],
    
    joinDate: '2018-06-01',
    reporterId: null // Will be set to Vice Principal's ID
  },
  
  {
    code: 'EMP004',
    name: 'Sunita Reddy',
    role: 'Teacher',
    department: 'Science',
    status: 'active',
    
    // Login Credentials
    username: 'sunita.reddy',
    password: 'teacher123',
    email: 'sunita.reddy@school.com',
    phone: '9876543240',
    
    // Personal Details
    dob: '1988-11-25',
    gender: 'Female',
    fatherName: 'Ramesh Reddy',
    bloodGroup: 'AB+',
    maritalStatus: 'Married',
    employmentType: 'Permanent',
    
    // Contact
    emergencyContact: 'Krishna Reddy',
    emergencyPhone: '9876543241',
    whatsappNumber: '9876543240',
    address: '321, Koramangala, Bangalore, Karnataka - 560034',
    
    // Documents
    picture: 'https://i.pravatar.cc/150?img=9',
    idDocuments: ['https://example.com/aadhaar-sunita.pdf', 'https://example.com/pan-sunita.pdf'],
    
    // Qualifications
    professionalQualifications: [
      {
        name: 'M.Sc Physics - Quantum Physics',
        year: '2010',
        documents: ['https://example.com/msc-physics.pdf']
      },
      {
        name: 'B.Ed - Science Education',
        year: '2011',
        documents: ['https://example.com/bed-cert4.pdf']
      }
    ],
    totalExperience: '10 years',
    previousOrganization: 'Bishop Cotton School, Bangalore',
    qualificationDocs: ['https://example.com/msc-physics.pdf', 'https://example.com/bed-cert4.pdf'],
    
    // Staff Info
    staffNumber: 'STF004',
    staffType: 'Teaching',
    expertise: 'Physics, Chemistry, Science Lab Management',
    assignedClasses: ['Class 9-A', 'Class 9-B', 'Class 10-A'],
    isClassTeacher: true,
    classTeacherOf: 'Class 9-A',
    
    // Bank & Salary
    accountNumber: '4567890123',
    ifscCode: 'SBIN0005678',
    bankName: 'State Bank of India',
    branchName: 'Koramangala Branch',
    salaryTemplate: 'Senior Teacher Grade B',
    salaryBreakdown: [
      { component: 'Basic', amount: 42000 },
      { component: 'HRA', amount: 16800 },
      { component: 'DA', amount: 8400 },
      { component: 'TA', amount: 4200 },
      { component: 'Special Allowance', amount: 7000 }
    ],
    
    joinDate: '2019-07-01',
    reporterId: null // Will be set to Vice Principal's ID
  },
  
  {
    code: 'EMP005',
    name: 'Vikram Patel',
    role: 'Teacher',
    department: 'English',
    status: 'active',
    
    // Login Credentials
    username: 'vikram.patel',
    password: 'password123',
    email: 'vikram@school.com',
    phone: '9876543250',
    
    // Personal Details
    dob: '1990-07-18',
    gender: 'Male',
    fatherName: 'Mahesh Patel',
    bloodGroup: 'O-',
    maritalStatus: 'Single',
    employmentType: 'Contract',
    
    // Contact
    emergencyContact: 'Mahesh Patel',
    emergencyPhone: '9876543251',
    whatsappNumber: '9876543250',
    address: '654, Whitefield, Bangalore, Karnataka - 560066',
    
    // Documents
    picture: 'https://i.pravatar.cc/150?img=15',
    idDocuments: ['https://example.com/aadhaar-vikram.pdf', 'https://example.com/pan-vikram.pdf'],
    
    // Qualifications
    professionalQualifications: [
      {
        name: 'MA English Literature - British Literature',
        year: '2013',
        documents: ['https://example.com/ma-english.pdf']
      },
      {
        name: 'B.Ed - English Education',
        year: '2014',
        documents: ['https://example.com/bed-cert5.pdf']
      }
    ],
    totalExperience: '8 years',
    previousOrganization: 'Greenwood High School, Bangalore',
    qualificationDocs: ['https://example.com/ma-english.pdf', 'https://example.com/bed-cert5.pdf'],
    
    // Staff Info
    staffNumber: 'STF005',
    staffType: 'Teaching',
    expertise: 'English Literature, Creative Writing, Public Speaking',
    assignedClasses: ['Class 8-A', 'Class 8-B', 'Class 9-A'],
    isClassTeacher: true,
    classTeacherOf: 'Class 8-A',
    
    // Bank & Salary
    accountNumber: '5678901234',
    ifscCode: 'HDFC0005678',
    bankName: 'HDFC Bank',
    branchName: 'Whitefield Branch',
    salaryTemplate: 'Teacher Grade C',
    salaryBreakdown: [
      { component: 'Basic', amount: 38000 },
      { component: 'HRA', amount: 15200 },
      { component: 'DA', amount: 7600 },
      { component: 'TA', amount: 3800 },
      { component: 'Special Allowance', amount: 5000 }
    ],
    
    joinDate: '2020-08-01',
    reporterId: null // Will be set to Vice Principal's ID
  }
];

async function seedStaff() {
  try {
    console.log('🔌 Connecting to database...');
    await connectDB();
    
    console.log('🗑️  Deleting all existing staff...');
    const deleteResult = await Staff.deleteMany({});
    console.log(`✅ Deleted ${deleteResult.deletedCount} staff members`);
    
    console.log('\n📝 Creating 5 new staff members...');
    
    // Create Principal first
    const principal = await Staff.create(staffData[0]);
    console.log(`✅ Created: ${principal.name} (${principal.role})`);
    
    // Create Vice Principal and set reporterId to Principal
    staffData[1].reporterId = principal._id;
    const vicePrincipal = await Staff.create(staffData[1]);
    console.log(`✅ Created: ${vicePrincipal.name} (${vicePrincipal.role})`);
    
    // Create Teachers and set reporterId to Vice Principal
    for (let i = 2; i < staffData.length; i++) {
      staffData[i].reporterId = vicePrincipal._id;
      const teacher = await Staff.create(staffData[i]);
      console.log(`✅ Created: ${teacher.name} (${teacher.role} - ${teacher.department})`);
    }
    
    console.log('\n✅ Staff seeding completed successfully!');
    console.log('\n📋 Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('1. Principal:');
    console.log('   Email: rajesh.kumar@school.com');
    console.log('   Password: admin123');
    console.log('');
    console.log('2. Vice Principal:');
    console.log('   Email: priya.sharma@school.com');
    console.log('   Password: admin123');
    console.log('');
    console.log('3. Math Teacher:');
    console.log('   Email: amit.verma@school.com');
    console.log('   Password: teacher123');
    console.log('');
    console.log('4. Science Teacher:');
    console.log('   Email: sunita.reddy@school.com');
    console.log('   Password: teacher123');
    console.log('');
    console.log('5. English Teacher:');
    console.log('   Email: vikram@school.com');
    console.log('   Password: password123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding staff:', error);
    process.exit(1);
  }
}

seedStaff();
