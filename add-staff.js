import { connectDB, Staff } from './database.js';

async function addStaff() {
  await connectDB();

  try {
    // Create 3 staff members with comprehensive details
    const staffData = [
      {
        code: 'EMP006',
        name: 'Dr. Meera Sharma',
        role: 'Teacher',
        department: 'Physics',
        status: 'active',
        phone: '9876543215',
        email: 'meera.sharma@school.com',
        joinDate: '2023-06-15',
        address: '45, Green Park Extension, New Delhi, 110016',
        
        // Personal Details
        dob: '1988-03-22',
        gender: 'Female',
        fatherName: 'Ramesh Sharma',
        bloodGroup: 'B+',
        maritalStatus: 'Married',
        employmentType: 'Full-time',
        emergencyContact: 'Rajesh Sharma (Husband)',
        emergencyPhone: '9876543299',
        emergencyContacts: [
          {
            name: 'Rajesh Sharma',
            relationship: 'Husband',
            phone: '9876543299'
          },
          {
            name: 'Ramesh Sharma',
            relationship: 'Father',
            phone: '9876543298'
          }
        ],
        whatsappNumber: '9876543215',
        isWhatsapp: true,
        
        // Qualifications
        professionalQualifications: [
          {
            name: 'Ph.D. in Physics',
            year: '2015',
            documents: []
          },
          {
            name: 'M.Sc. Physics',
            year: '2010',
            documents: []
          },
          {
            name: 'B.Ed.',
            year: '2011',
            documents: []
          }
        ],
        totalExperience: '8 years',
        previousOrganization: 'Delhi Public School',
        roleInOrganization: 'Senior Physics Teacher',
        
        // Staff Info
        staffNumber: 'STF006',
        staffType: 'Teaching',
        assignedClasses: ['Class 11', 'Class 12'],
        isClassTeacher: true,
        classTeacherOf: 'Class 11-A',
        
        // Bank & Salary
        accountNumber: '1234567890123',
        ifscCode: 'HDFC0001234',
        bankName: 'HDFC Bank',
        branchName: 'Green Park Branch',
        salary: 65000,
        salaryTemplate: 'Senior Teacher',
        salaryBreakdown: [
          { component: 'Basic Salary', amount: 40000 },
          { component: 'HRA', amount: 15000 },
          { component: 'Special Allowance', amount: 10000 }
        ],
        
        // Login credentials
        username: 'meera.sharma',
        password: 'password123',
        
        // Teacher Assignments
        teacherAssignments: [
          {
            subject: 'Physics',
            classes: []
          }
        ]
      },
      {
        code: 'EMP007',
        name: 'Arjun Malhotra',
        role: 'Teacher',
        department: 'Computer Science',
        status: 'active',
        phone: '9876543216',
        email: 'arjun.malhotra@school.com',
        joinDate: '2022-08-01',
        address: '78, Cyber City, Sector 29, Gurgaon, Haryana, 122001',
        
        // Personal Details
        dob: '1992-11-10',
        gender: 'Male',
        fatherName: 'Vikram Malhotra',
        bloodGroup: 'O+',
        maritalStatus: 'Single',
        employmentType: 'Full-time',
        emergencyContact: 'Vikram Malhotra (Father)',
        emergencyPhone: '9876543297',
        emergencyContacts: [
          {
            name: 'Vikram Malhotra',
            relationship: 'Father',
            phone: '9876543297'
          },
          {
            name: 'Sunita Malhotra',
            relationship: 'Mother',
            phone: '9876543296'
          }
        ],
        whatsappNumber: '9876543216',
        isWhatsapp: true,
        
        // Qualifications
        professionalQualifications: [
          {
            name: 'M.Tech in Computer Science',
            year: '2016',
            documents: []
          },
          {
            name: 'B.Tech in Computer Science',
            year: '2014',
            documents: []
          },
          {
            name: 'B.Ed.',
            year: '2017',
            documents: []
          }
        ],
        totalExperience: '6 years',
        previousOrganization: 'Ryan International School',
        roleInOrganization: 'Computer Science Teacher',
        
        // Staff Info
        staffNumber: 'STF007',
        staffType: 'Teaching',
        assignedClasses: ['Class 9', 'Class 10', 'Class 11', 'Class 12'],
        isClassTeacher: true,
        classTeacherOf: 'Class 10-B',
        
        // Bank & Salary
        accountNumber: '9876543210987',
        ifscCode: 'ICIC0001234',
        bankName: 'ICICI Bank',
        branchName: 'Cyber City Branch',
        salary: 58000,
        salaryTemplate: 'Teacher',
        salaryBreakdown: [
          { component: 'Basic Salary', amount: 35000 },
          { component: 'HRA', amount: 13000 },
          { component: 'Special Allowance', amount: 10000 }
        ],
        
        // Login credentials
        username: 'arjun.malhotra',
        password: 'password123',
        
        // Teacher Assignments
        teacherAssignments: [
          {
            subject: 'Computer Science',
            classes: []
          },
          {
            subject: 'Information Technology',
            classes: []
          }
        ]
      },
      {
        code: 'EMP008',
        name: 'Kavita Nair',
        role: 'Admin',
        department: 'Administration',
        status: 'active',
        phone: '9876543217',
        email: 'kavita.nair@school.com',
        joinDate: '2021-04-10',
        address: '23, Palm Avenue, Koramangala, Bangalore, Karnataka, 560034',
        
        // Personal Details
        dob: '1985-07-18',
        gender: 'Female',
        fatherName: 'Krishnan Nair',
        bloodGroup: 'A+',
        maritalStatus: 'Married',
        employmentType: 'Full-time',
        emergencyContact: 'Suresh Nair (Husband)',
        emergencyPhone: '9876543295',
        emergencyContacts: [
          {
            name: 'Suresh Nair',
            relationship: 'Husband',
            phone: '9876543295'
          },
          {
            name: 'Krishnan Nair',
            relationship: 'Father',
            phone: '9876543294'
          }
        ],
        whatsappNumber: '9876543217',
        isWhatsapp: true,
        
        // Qualifications
        professionalQualifications: [
          {
            name: 'MBA in Human Resources',
            year: '2009',
            documents: []
          },
          {
            name: 'B.Com',
            year: '2007',
            documents: []
          }
        ],
        totalExperience: '12 years',
        previousOrganization: 'Greenwood High School',
        roleInOrganization: 'HR Manager',
        
        // Staff Info
        staffNumber: 'STF008',
        staffType: 'Administrative',
        assignedClasses: [],
        isClassTeacher: false,
        
        // Bank & Salary
        accountNumber: '5678901234567',
        ifscCode: 'SBIN0001234',
        bankName: 'State Bank of India',
        branchName: 'Koramangala Branch',
        salary: 55000,
        salaryTemplate: 'Administrative Staff',
        salaryBreakdown: [
          { component: 'Basic Salary', amount: 33000 },
          { component: 'HRA', amount: 12000 },
          { component: 'Special Allowance', amount: 10000 }
        ],
        
        // Login credentials
        username: 'kavita.nair',
        password: 'password123',
        
        // Teacher Assignments
        teacherAssignments: []
      }
    ];

    // Save each staff member individually to trigger password hashing
    const createdStaff = [];
    for (const data of staffData) {
      const staff = new Staff(data);
      await staff.save();
      createdStaff.push(staff);
      console.log(`✅ Created staff: ${staff.name} (${staff.code})`);
    }

    console.log('\n=== STAFF MEMBERS ADDED SUCCESSFULLY ===');
    console.log('\nLogin Credentials:');
    createdStaff.forEach(staff => {
      console.log(`\n${staff.name} (${staff.role})`);
      console.log(`  Username: ${staff.username}`);
      console.log(`  Password: password123`);
      console.log(`  Email: ${staff.email}`);
      console.log(`  Phone: ${staff.phone}`);
      console.log(`  Department: ${staff.department}`);
    });

    console.log('\n✅ All 3 staff members added successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding staff:', error);
    process.exit(1);
  }
}

addStaff();
