import { connectDB, Staff, Student, Class, Counter, Attendance } from './database.js';

async function seed() {
  await connectDB();

  // Clear existing data
  await Staff.deleteMany({});
  await Student.deleteMany({});
  await Class.deleteMany({});
  await Attendance.deleteMany({});
  await Counter.deleteMany({});
  await Counter.create({ _id: 'staffCode', seq: 5 });

  // Create 5 teachers with login credentials
  // Use .save() instead of insertMany to trigger password hashing
  const teachersData = [
    { code: 'EMP001', name: 'Rajesh Kumar', role: 'Teacher', department: 'Mathematics', status: 'active', phone: '9876543210', email: 'rajesh@school.com', username: 'rajesh', password: 'password123' },
    { code: 'EMP002', name: 'Priya Singh', role: 'Teacher', department: 'English', status: 'active', phone: '9876543211', email: 'priya@school.com', username: 'priya', password: 'password123' },
    { code: 'EMP003', name: 'Amit Verma', role: 'Teacher', department: 'Science', status: 'active', phone: '9876543212', email: 'amit@school.com', username: 'amit', password: 'password123' },
    { code: 'EMP004', name: 'Sunita Devi', role: 'Teacher', department: 'Hindi', status: 'active', phone: '9876543213', email: 'sunita@school.com', username: 'sunita', password: 'password123' },
    { code: 'EMP005', name: 'Vikram Patel', role: 'Admin', department: 'Administration', status: 'active', phone: '9876543214', email: 'vikram@school.com', username: 'vikram', password: 'password123' },
  ];
  
  const teachers = [];
  for (const teacherData of teachersData) {
    const teacher = new Staff(teacherData);
    await teacher.save(); // This will trigger the pre-save hook to hash the password
    teachers.push(teacher);
  }
  console.log(`Created ${teachers.length} staff members`);


  // Create 10 classes (1-10) with 2 sections each (A and B)
  const classes = [];
  const teacherCount = teachers.filter(t => t.role === 'Teacher').length;

  for (let classNum = 1; classNum <= 10; classNum++) {
    for (const section of ['A', 'B']) {
      const teacherIndex = (classNum - 1) % teacherCount;
      classes.push({
        name: `Class ${classNum}`,
        section: section,
        classTeacherId: teachers[teacherIndex]._id,
        subjects: ['Math', 'English', 'Science', 'Hindi']
      });
    }
  }

  const insertedClasses = await Class.insertMany(classes);
  // Store the inserted classes with their _id for student creation
  classes.length = 0; // Clear the array
  classes.push(...insertedClasses);
  console.log(`Created ${classes.length} classes`);

  // Generate 40 students (10 per class) with comprehensive data
  const firstNames = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Ananya', 'Diya', 'Myra', 'Sara', 'Aanya', 'Aadhya', 'Pari', 'Kiara', 'Riya', 'Anvi'];
  const lastNames = ['Sharma', 'Patel', 'Kumar', 'Singh', 'Gupta', 'Verma', 'Reddy', 'Joshi', 'Mehta', 'Shah'];
  const genders = ['Male', 'Female'];
  const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const mediums = ['English', 'Hindi', 'Regional'];
  const houses = ['Red House', 'Blue House', 'Green House', 'Yellow House'];
  const relationships = ['Father', 'Mother', 'Guardian'];

  const students = [];
  for (let classIdx = 0; classIdx < classes.length; classIdx++) {
    for (let i = 0; i < 10; i++) {
      const firstName = firstNames[(classIdx * 10 + i) % firstNames.length];
      const lastName = lastNames[(classIdx + i) % lastNames.length];
      const gender = genders[i % 2];
      const studentNum = classIdx * 10 + i + 1;
      
      students.push({
        name: `${firstName} ${lastName}`,
        admissionId: `ADM${String(2024000 + studentNum).padStart(7, '0')}`,
        academicYear: '2024-25',
        rollNo: i + 1,
        classId: classes[classIdx]._id,
        
        // Personal Information
        gender,
        dateOfBirth: `201${(classIdx % 3) + 5}-0${(i % 9) + 1}-15`,
        bloodGroup: bloodGroups[i % bloodGroups.length],
        nationality: 'Indian',
        religion: i % 3 === 0 ? 'Hindu' : i % 3 === 1 ? 'Muslim' : 'Christian',
        category: i % 4 === 0 ? 'General' : i % 4 === 1 ? 'OBC' : i % 4 === 2 ? 'SC' : 'ST',
        motherTongue: i % 3 === 0 ? 'Hindi' : i % 3 === 1 ? 'Tamil' : 'Telugu',
        
        // Contact Information
        phone: i % 3 === 0 ? `98765${String(10000 + studentNum).padStart(5, '0')}` : '',
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@school.com`,
        address: `${i + 1}, ${lastName} Street, ${['Mumbai', 'Delhi', 'Bangalore', 'Chennai'][classIdx % 4]}, India`,
        
        // Parent/Guardian Information
        parentName: `${relationships[i % 3]} ${lastName}`,
        parentPhone: `98765${String(10000 + studentNum).padStart(5, '0')}`,
        parentEmail: `${lastName.toLowerCase()}@email.com`,
        parentRelationship: relationships[i % 3],
        parentOccupation: ['Engineer', 'Doctor', 'Teacher', 'Business', 'Government Employee'][i % 5],
        alternatePhone: i % 2 === 0 ? `98765${String(20000 + studentNum).padStart(5, '0')}` : '',
        
        // Additional Parents
        parents: [
          {
            name: `${relationships[i % 3]} ${lastName}`,
            relationship: relationships[i % 3],
            phone: `98765${String(10000 + studentNum).padStart(5, '0')}`,
            email: `${lastName.toLowerCase()}@email.com`,
            occupation: ['Engineer', 'Doctor', 'Teacher', 'Business', 'Government Employee'][i % 5]
          }
        ],
        
        // Academic Information
        previousSchool: i % 2 === 0 ? `${['ABC', 'XYZ', 'PQR'][i % 3]} Public School` : '',
        tcNumber: i % 2 === 0 ? `TC${String(1000 + studentNum).padStart(4, '0')}` : '',
        mediumOfInstruction: mediums[i % mediums.length],
        house: houses[i % houses.length],
        
        // Health & Safety
        medicalConditions: i % 5 === 0 ? 'Asthma' : i % 7 === 0 ? 'Allergies to peanuts' : '',
        emergencyContactName: `Emergency ${lastName}`,
        emergencyContactPhone: `98765${String(30000 + studentNum).padStart(5, '0')}`,
        
        // Requirements
        transportRequired: i % 3 === 0,
        hostelRequired: i % 10 === 0,
        
        // Status
        feeStatus: i < 7 ? 'paid' : i < 9 ? 'pending' : 'overdue',
        status: i < 9 ? 'active' : 'inactive',
      });
    }
  }

  await Student.insertMany(students);
  console.log(`Created ${students.length} students with comprehensive data`);

  console.log('\n=== TEACHER LOGIN CREDENTIALS ===');
  teachers.filter(t => t.role === 'Teacher').forEach(t => {
    const cls = classes.find(c => c.classTeacherId.equals(t._id));
    console.log(`${t.name} (${cls?.name} ${cls?.section}): phone="${t.phone}", password="password123"`);
  });

  console.log('\nDatabase seeded successfully!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
