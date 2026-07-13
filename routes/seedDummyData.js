import express from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  Staff,
  Class,
  Student,
  Attendance,
  ExamSchedule,
  Exam,
  Result,
  Timetable,
  FeeTemplate,
  FeeStructure,
  FeePayment,
  Appointment,
  Feedback,
  CallLog,
  SchoolSettings,
} from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../middleware/validation.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

import Announcement from '../models/Announcement.js';
import Conversation from '../models/Conversation.js';
import FeeHead from '../models/FeeHead.js';
import Message from '../models/Message.js';
import Parent from '../models/Parent.js';
import Visitor from '../models/Visitor.js';

const router = express.Router();
router.use(authenticate);

// ─── Validation ───────────────────────────────────────────────
const SEED_CATEGORIES = [
  'staff',
  'classes',
  'students',
  'attendance',
  'academics',
  'fees',
  'frontDesk',
  'messaging',
  'all',
];

const seedSchema = z.object({
  categories: z.array(z.enum(SEED_CATEGORIES)).min(1, 'At least one category must be selected'),
});

// ─── Indian Dummy Data Pools ──────────────────────────────────
const FIRST_NAMES_MALE = [
  'Aarav',
  'Vivaan',
  'Aditya',
  'Vihaan',
  'Arjun',
  'Reyansh',
  'Sai',
  'Arnav',
  'Dhruv',
  'Kabir',
  'Ritvik',
  'Anirudh',
  'Harsh',
  'Rohan',
  'Karthik',
  'Pranav',
  'Ishaan',
  'Shaurya',
  'Lakshay',
  'Dev',
];

const FIRST_NAMES_FEMALE = [
  'Aanya',
  'Diya',
  'Saanvi',
  'Ananya',
  'Pari',
  'Aadhya',
  'Myra',
  'Sara',
  'Ira',
  'Navya',
  'Anika',
  'Kiara',
  'Nisha',
  'Priya',
  'Riya',
  'Kavya',
  'Tanvi',
  'Meera',
  'Zara',
  'Siya',
];

const LAST_NAMES = [
  'Sharma',
  'Patel',
  'Verma',
  'Singh',
  'Kumar',
  'Gupta',
  'Reddy',
  'Joshi',
  'Nair',
  'Mehta',
  'Iyer',
  'Rao',
  'Desai',
  'Pillai',
  'Choudhary',
  'Mishra',
  'Das',
  'Bhat',
  'Kulkarni',
  'Menon',
];

const CITIES = [
  { city: 'Mumbai', state: 'Maharashtra', zip: '400001' },
  { city: 'Delhi', state: 'Delhi', zip: '110001' },
  { city: 'Bangalore', state: 'Karnataka', zip: '560001' },
  { city: 'Chennai', state: 'Tamil Nadu', zip: '600001' },
  { city: 'Hyderabad', state: 'Telangana', zip: '500001' },
  { city: 'Pune', state: 'Maharashtra', zip: '411001' },
  { city: 'Ahmedabad', state: 'Gujarat', zip: '380001' },
  { city: 'Jaipur', state: 'Rajasthan', zip: '302001' },
  { city: 'Lucknow', state: 'Uttar Pradesh', zip: '226001' },
  { city: 'Kochi', state: 'Kerala', zip: '682001' },
];

const STREETS = [
  'MG Road',
  'Gandhi Nagar',
  'Nehru Street',
  'Park Avenue',
  'Station Road',
  'Temple Street',
  'Lake View Colony',
  'Hill Road',
  'Bazaar Street',
  'Ring Road',
];

const SUBJECTS = [
  'English',
  'Hindi',
  'Mathematics',
  'Science',
  'Social Studies',
  'Computer Science',
  'Physical Education',
  'Art',
];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const OCCUPATIONS = [
  'Engineer',
  'Doctor',
  'Teacher',
  'Business Owner',
  'Accountant',
  'Lawyer',
  'Government Employee',
  'Farmer',
  'Shopkeeper',
  'IT Professional',
];

// ─── Helpers ──────────────────────────────────────────────────
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickN(arr, n) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomPhone() {
  return `9${randomInt(100000000, 999999999)}`;
}
function randomAadhaar() {
  return String(randomInt(100000000000, 999999999999));
}
function randomDate(startYear, endYear) {
  const y = randomInt(startYear, endYear);
  const m = String(randomInt(1, 12)).padStart(2, '0');
  const d = String(randomInt(1, 28)).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function randomName(gender) {
  const first = gender === 'Male' ? pick(FIRST_NAMES_MALE) : pick(FIRST_NAMES_FEMALE);
  return `${first} ${pick(LAST_NAMES)}`;
}

// ─── Seed Generators ─────────────────────────────────────────

export async function seedStaff(schoolId, creatorId) {
  const staffList = [];
  const roles = [
    {
      name: 'Rajesh Kumar',
      role: ['Admin', 'Teacher'],
      designation: 'Principal',
      department: 'Administration',
    },
    {
      name: 'Sunita Sharma',
      role: ['Vice Principal', 'Teacher'],
      designation: 'Vice Principal',
      department: 'Administration',
    },
    {
      name: 'Anita Verma',
      role: ['Teacher'],
      designation: 'Senior Teacher',
      department: 'Mathematics',
    },
    {
      name: 'Ramesh Patel',
      role: ['Teacher'],
      designation: 'Senior Teacher',
      department: 'Science',
    },
    {
      name: 'Priya Nair',
      role: ['Teacher'],
      designation: 'Teacher',
      department: 'English',
    },
    {
      name: 'Suresh Reddy',
      role: ['Teacher'],
      designation: 'Teacher',
      department: 'Hindi',
    },
    {
      name: 'Kavita Joshi',
      role: ['Teacher'],
      designation: 'Teacher',
      department: 'Social Studies',
    },
    {
      name: 'Deepak Mehta',
      role: ['Teacher'],
      designation: 'Teacher',
      department: 'Computer Science',
    },
    {
      name: 'Meena Iyer',
      role: ['Accountant', 'Administrative'],
      designation: 'Accountant',
      department: 'Accounts',
    },
    {
      name: 'Vikram Singh',
      role: ['Receptionist', 'Administrative'],
      designation: 'Front Desk',
      department: 'Administration',
    },
  ];

  const hashedPassword = await bcrypt.hash('Demo@1234', 10);

  for (let i = 0; i < roles.length; i++) {
    const r = roles[i];
    const gender = ['Sunita', 'Anita', 'Priya', 'Kavita', 'Meena'].some((n) => r.name.startsWith(n))
      ? 'Female'
      : 'Male';
    const loc = pick(CITIES);

    staffList.push({
      schoolId,
      code: `STF${String(i + 1).padStart(3, '0')}`,
      name: r.name,
      role: r.role,
      department: r.department,
      designation: r.designation,
      status: 'active',
      phone: randomPhone(),
      email: `${r.name.toLowerCase().replace(/\s+/g, '.')}@demo.school.in`,
      username: `${r.name.toLowerCase().replace(/\s+/g, '.')}`,
      gender,
      dob: randomDate(1975, 1995),
      joinDate: randomDate(2018, 2025),
      nationality: 'Indian',
      bloodGroup: pick(BLOOD_GROUPS),
      maritalStatus: pick(['Single', 'Married']),
      employmentType: i < 2 ? 'Permanent' : pick(['Permanent', 'Contract']),
      address: `${randomInt(1, 200)}, ${pick(STREETS)}, ${loc.city}`,
      password: hashedPassword,
      salary: randomInt(25000, 60000),
    });
  }

  const created = await Staff.insertMany(staffList);
  return created;
}

export async function seedClasses(schoolId, staffIds) {
  const classData = [
    {
      name: 'Class 1',
      section: 'A',
      subjects: ['English', 'Hindi', 'Mathematics', 'Science', 'Art'],
    },
    {
      name: 'Class 2',
      section: 'A',
      subjects: ['English', 'Hindi', 'Mathematics', 'Science', 'Art'],
    },
    {
      name: 'Class 3',
      section: 'A',
      subjects: ['English', 'Hindi', 'Mathematics', 'Science', 'Social Studies'],
    },
    {
      name: 'Class 4',
      section: 'A',
      subjects: [
        'English',
        'Hindi',
        'Mathematics',
        'Science',
        'Social Studies',
        'Computer Science',
      ],
    },
    {
      name: 'Class 5',
      section: 'A',
      subjects: [
        'English',
        'Hindi',
        'Mathematics',
        'Science',
        'Social Studies',
        'Computer Science',
      ],
    },
  ];

  // Assign teachers as class teachers (skip admin roles)
  const teachers = staffIds.filter((_, i) => i >= 2 && i < 7);

  const classes = classData.map((c, i) => ({
    schoolId,
    name: c.name,
    section: c.section,
    subjects: c.subjects,
    academicYear: CURRENT_ACADEMIC_YEAR,
    classTeacherId: teachers[i] || teachers[0],
    strengthLimit: { current: 40, default: 40 },
    room: `Room ${101 + i}`,
    block: 'Block A',
  }));

  const created = await Class.insertMany(classes);
  return created;
}

export async function seedStudents(schoolId, classes) {
  const students = [];
  const parents = [];
  let rollCounter = 1;
  let admissionCounter = 1;

  for (const cls of classes) {
    const count = randomInt(8, 12); // 8-12 students per class
    for (let i = 0; i < count; i++) {
      const gender = Math.random() > 0.5 ? 'Male' : 'Female';
      const studentName = randomName(gender);
      const loc = pick(CITIES);
      const parentGender = Math.random() > 0.5 ? 'Male' : 'Female';
      const parentName = randomName(parentGender);
      const parentPhone = randomPhone();
      const parentRelationship = parentGender === 'Male' ? 'father' : 'mother';

      students.push({
        schoolId,
        name: studentName,
        admissionId: `ADM${String(admissionCounter++).padStart(4, '0')}`,
        academicYear: CURRENT_ACADEMIC_YEAR,
        rollNo: rollCounter++,
        classId: cls._id,
        gender,
        dateOfBirth: randomDate(2012, 2019),
        bloodGroup: pick(BLOOD_GROUPS),
        nationality: 'Indian',
        religion: pick(['Hindu', 'Muslim', 'Christian', 'Sikh', 'Jain']),
        category: pick(['General', 'OBC', 'SC', 'ST', 'EWS']),
        motherTongue: pick([
          'Hindi',
          'Tamil',
          'Telugu',
          'Kannada',
          'Malayalam',
          'Marathi',
          'Bengali',
          'Gujarati',
        ]),
        aadhaarNumber: randomAadhaar(),
        phone: randomPhone(),
        email: `${studentName.toLowerCase().replace(/\s+/g, '.')}@student.demo`,
        isWhatsapp: true,
        address: `${randomInt(1, 500)}, ${pick(STREETS)}`,
        city: loc.city,
        state: loc.state,
        zipCode: loc.zip,
        parents: [
          {
            name: parentName,
            relationship: parentRelationship,
            phone: parentPhone,
            email: `${parentName.toLowerCase().replace(/\s+/g, '.')}@parent.demo`,
            occupation: pick(OCCUPATIONS),
            isWhatsapp: true,
          },
        ],
        status: 'active',
        feeStatus: pick(['pending', 'partial', 'paid']),
        feeDetails: {
          totalFee: 50000,
          paidAmount: randomInt(0, 50000),
          balanceAmount: 0,
          discountApplied: 0,
        },
        _parentPhone: parentPhone,
        _parentName: parentName,
        _parentRelationship: parentRelationship,
      });
    }
  }

  // Fix balance amounts
  students.forEach((s) => {
    s.feeDetails.balanceAmount = s.feeDetails.totalFee - s.feeDetails.paidAmount;
  });

  const createdStudents = await Student.insertMany(students);

  // Create parent accounts
  const parentMap = new Map();
  for (const student of createdStudents) {
    const original = students.find((s) => s.admissionId === student.admissionId);
    const phone = original._parentPhone;

    if (parentMap.has(phone)) {
      // Add sibling
      parentMap.get(phone).children.push({
        studentId: student._id,
        relationship: original._parentRelationship,
        isPrimary: false,
      });
    } else {
      parentMap.set(phone, {
        schoolId,
        phone,
        name: original._parentName,
        email: `${original._parentName.toLowerCase().replace(/\s+/g, '.')}@parent.demo`,
        password: 'Demo@1234',
        status: 'active',
        children: [
          {
            studentId: student._id,
            relationship: original._parentRelationship,
            isPrimary: true,
          },
        ],
      });
    }
  }

  const createdParents = await Parent.insertMany([...parentMap.values()]);

  return { students: createdStudents, parents: createdParents };
}

export async function seedAttendance(schoolId, students, classes, staffIds) {
  const records = [];
  const today = new Date();

  // Generate 7 days of attendance
  for (let d = 1; d <= 7; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() - d);
    if (date.getDay() === 0) continue; // Skip Sundays

    const dateStr = date.toISOString().split('T')[0];

    for (const student of students) {
      records.push({
        schoolId,
        studentId: student._id,
        classId: student.classId,
        date: dateStr,
        status: pick(['present', 'present', 'present', 'present', 'absent', 'late']), // 66% present
        markedBy: staffIds[randomInt(2, 6)],
      });
    }
  }

  const created = await Attendance.insertMany(records);
  return created;
}

export async function seedAcademics(schoolId, classes, students, staffIds) {
  const results = { examSchedules: 0, exams: 0, results: 0 };

  // Create an exam schedule
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 14);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 7);

  const schedule = await ExamSchedule.create({
    schoolId,
    name: `Mid-Term Examination ${CURRENT_ACADEMIC_YEAR}`,
    type: 'midterm',
    academicYear: CURRENT_ACADEMIC_YEAR,
    classIds: classes.map((c) => c._id),
    startDate,
    endDate,
    status: 'scheduled',
    createdBy: staffIds[0],
  });
  results.examSchedules = 1;

  // Create exams per class per subject
  const examDocs = [];
  for (const cls of classes) {
    const subjects = cls.subjects.slice(0, 4); // First 4 subjects
    for (const subject of subjects) {
      examDocs.push({
        schoolId,
        name: `Mid-Term - ${subject}`,
        type: 'midterm',
        classId: cls._id,
        subjectName: subject,
        academicYear: CURRENT_ACADEMIC_YEAR,
        startDate,
        endDate,
        maxMarks: 100,
        passingMarks: 35,
        status: 'completed',
        isPublished: true,
        createdBy: staffIds[0],
        examScheduleId: schedule._id,
      });
    }
  }

  const createdExams = await Exam.insertMany(examDocs);
  results.exams = createdExams.length;

  // Create results for each student-exam
  const resultDocs = [];
  for (const exam of createdExams) {
    const classStudents = students.filter((s) => s.classId.toString() === exam.classId.toString());
    for (const student of classStudents) {
      const marks = randomInt(25, 98);
      const status = marks >= 35 ? 'passed' : 'failed';
      resultDocs.push({
        schoolId,
        examId: exam._id,
        studentId: student._id,
        classId: exam.classId,
        academicYear: CURRENT_ACADEMIC_YEAR,
        marksObtained: marks,
        maxMarks: 100,
        percentage: marks,
        grade:
          marks >= 90
            ? 'A+'
            : marks >= 80
              ? 'A'
              : marks >= 70
                ? 'B+'
                : marks >= 60
                  ? 'B'
                  : marks >= 50
                    ? 'C'
                    : marks >= 35
                      ? 'D'
                      : 'F',
        status,
        isPublished: true,
        enteredBy: staffIds[randomInt(2, 6)],
        enteredAt: new Date(),
      });
    }
  }

  const createdResults = await Result.insertMany(resultDocs);
  results.results = createdResults.length;

  return results;
}

export async function seedFees(schoolId, classes, students) {
  const results = { feeHeads: 0, feeTemplates: 0, feeStructures: 0, payments: 0 };

  // Create fee heads
  const heads = [
    {
      name: 'Tuition Fee',
      category: 'Academic',
      headType: 'tuition',
      amount: 25000,
      frequency: 'yearly',
      mandatory: true,
    },
    {
      name: 'Exam Fee',
      category: 'Academic',
      headType: 'exam_development',
      amount: 5000,
      frequency: 'yearly',
      mandatory: true,
    },
    {
      name: 'Lab Fee',
      category: 'Academic',
      headType: 'lab',
      amount: 3000,
      frequency: 'yearly',
      mandatory: false,
    },
    {
      name: 'Library Fee',
      category: 'Academic',
      headType: 'library',
      amount: 2000,
      frequency: 'yearly',
      mandatory: true,
    },
    {
      name: 'Sports Fee',
      category: 'Extra-curricular',
      headType: 'sports',
      amount: 4000,
      frequency: 'yearly',
      mandatory: true,
    },
    {
      name: 'Computer Fee',
      category: 'Academic',
      headType: 'computer',
      amount: 3000,
      frequency: 'yearly',
      mandatory: false,
    },
    {
      name: 'Transport Fee',
      category: 'Transport',
      headType: 'transport',
      amount: 8000,
      frequency: 'yearly',
      mandatory: false,
    },
  ];

  const createdHeads = await FeeHead.insertMany(
    heads.map((h) => ({
      ...h,
      schoolId,
      isActive: true,
      autoApply: true,
      applicableClasses: ['1', '2', '3', '4', '5'],
    }))
  );
  results.feeHeads = createdHeads.length;

  // Create a fee template
  const template = await FeeTemplate.create({
    schoolId,
    name: 'Standard Fee Template',
    description: 'Default fee structure for all classes',
    section: 'A',
    feeHeads: heads.map((h) => ({
      name: h.name,
      category: h.category,
      amount: h.amount,
      frequency: h.frequency,
      mandatory: h.mandatory,
    })),
    totalAnnualFee: heads.reduce((sum, h) => sum + h.amount, 0),
    isActive: true,
    academicYear: CURRENT_ACADEMIC_YEAR,
  });
  results.feeTemplates = 1;

  // Create fee structures per class
  for (const cls of classes) {
    await FeeStructure.create({
      schoolId,
      classId: cls._id,
      academicYear: CURRENT_ACADEMIC_YEAR,
      templateId: template._id,
      feeHeads: heads.map((h) => ({
        name: h.name,
        category: h.category,
        amount: h.amount,
        frequency: h.frequency,
        mandatory: h.mandatory,
      })),
      totalAnnualFee: heads.reduce((sum, h) => sum + h.amount, 0),
    });
    results.feeStructures++;
  }

  // Create some payments
  let receiptNo = 1001;
  const payments = [];
  const payingStudents = students.filter((s) => s.feeDetails?.paidAmount > 0).slice(0, 15);

  for (const student of payingStudents) {
    payments.push({
      schoolId,
      studentId: student._id,
      classId: student.classId,
      academicYear: CURRENT_ACADEMIC_YEAR,
      receiptNumber: `RCP${String(receiptNo++).padStart(5, '0')}`,
      paymentDate: randomDate(2025, 2026),
      amount: student.feeDetails?.paidAmount || randomInt(5000, 25000),
      paymentMode: pick(['cash', 'online', 'cheque', 'card']),
      feeHeads: [{ name: 'Tuition Fee', amount: randomInt(5000, 25000) }],
      status: 'completed',
    });
  }

  if (payments.length > 0) {
    await FeePayment.insertMany(payments);
    results.payments = payments.length;
  }

  return results;
}

export async function seedFrontDesk(schoolId, staffIds) {
  const results = { visitors: 0, appointments: 0, feedback: 0, callLogs: 0 };

  // Visitors
  const visitors = [];
  for (let i = 0; i < 8; i++) {
    const gender = Math.random() > 0.5 ? 'Male' : 'Female';
    visitors.push({
      schoolId,
      visitorName: randomName(gender),
      phoneNumber: randomPhone(),
      reasonForVisit: pick([
        'PARENT_MEETING',
        'SCHOOL_VISIT_INQUIRY',
        'DELIVERY_VENDOR',
        'OFFICIAL_BUSINESS',
        'OTHER',
      ]),
      checkedInBy: staffIds[randomInt(0, staffIds.length - 1)],
      toMeet: staffIds[randomInt(0, staffIds.length - 1)],
      status: pick(['ACTIVE', 'CHECKED_OUT']),
      checkInTime: new Date(),
      idType: pick(['Aadhaar', 'PAN', 'Driving License']),
      idNumber: randomAadhaar().slice(0, 10),
    });
  }
  await Visitor.insertMany(visitors);
  results.visitors = visitors.length;

  // Appointments
  const appointments = [];
  for (let i = 0; i < 5; i++) {
    const from = new Date();
    from.setDate(from.getDate() + randomInt(1, 14));
    from.setHours(randomInt(9, 15), 0, 0, 0);
    const to = new Date(from);
    to.setHours(to.getHours() + 1);

    appointments.push({
      schoolId,
      visitorName: randomName(Math.random() > 0.5 ? 'Male' : 'Female'),
      phoneNumber: randomPhone(),
      purpose: pick([
        'Parent-Teacher Meeting',
        'Admission Discussion',
        'Fee Discussion',
        'Principal Meeting',
      ]),
      fromDateTime: from,
      toDateTime: to,
      meetingWith: pick(['Principal', 'Vice Principal', 'Class Teacher', 'Accountant']),
      status: pick(['scheduled', 'completed']),
    });
  }
  await Appointment.insertMany(appointments);
  results.appointments = appointments.length;

  // Feedback
  const feedbackItems = [];
  for (let i = 0; i < 4; i++) {
    feedbackItems.push({
      name: randomName(Math.random() > 0.5 ? 'Male' : 'Female'),
      phoneNumber: randomPhone(),
      category: pick(['STAFF', 'FACILITIES', 'ACADEMIC', 'SUGGESTION']),
      notes: pick([
        'Excellent teaching quality. Very satisfied with the school.',
        'Playground needs better maintenance.',
        'Would like more extracurricular activities.',
        'Very happy with the new computer lab.',
      ]),
      status: pick(['open', 'resolved']),
      assignedStaff: staffIds[randomInt(0, 1)],
    });
  }
  await Feedback.insertMany(feedbackItems);
  results.feedback = feedbackItems.length;

  // Call Logs
  const callLogs = [];
  for (let i = 0; i < 5; i++) {
    callLogs.push({
      callerName: randomName(Math.random() > 0.5 ? 'Male' : 'Female'),
      phoneNumber: randomPhone(),
      dateTime: new Date().toISOString(),
      purpose: pick([
        'Admission Inquiry',
        'Fee Query',
        'Leave Information',
        'Transport Query',
        'General Inquiry',
      ]),
      keyNotes: pick([
        'Parent asked about admission process for Class 3.',
        'Inquiry about bus route for Sector 15.',
        'Asked about pending fee balance.',
        'Requested leave approval status.',
      ]),
      loggedBy: staffIds[randomInt(0, staffIds.length - 1)],
    });
  }
  await CallLog.insertMany(callLogs);
  results.callLogs = callLogs.length;

  return results;
}

export async function seedMessaging(schoolId, staffIds) {
  const results = { conversations: 0, messages: 0, announcements: 0 };

  // Create conversations between staff
  const convPairs = [
    [0, 2],
    [0, 3],
    [1, 4],
    [2, 5],
  ];
  for (const [a, b] of convPairs) {
    if (!staffIds[a] || !staffIds[b]) continue;

    const conv = await Conversation.create({
      schoolId,
      participants: [
        { userId: staffIds[a], userType: 'staff', role: 'member' },
        { userId: staffIds[b], userType: 'staff', role: 'member' },
      ],
      type: 'direct',
      lastMessage: {
        content: pick([
          'Please share the exam schedule.',
          'The parent meeting is scheduled for tomorrow.',
          'Can you update the attendance records?',
          'Lab equipment has arrived.',
        ]),
        senderId: staffIds[a],
        timestamp: new Date(),
      },
    });

    // Add messages
    const msgTexts = [
      'Good morning!',
      'Have you prepared the class report?',
      'Yes, I will share it by today evening.',
      'Great, thank you!',
      'Also, please check the homework submissions.',
      'Sure, will do.',
    ];

    const msgs = msgTexts.map((text, i) => ({
      schoolId,
      conversationId: conv._id,
      senderId: i % 2 === 0 ? staffIds[a] : staffIds[b],
      senderType: 'staff',
      content: text,
      type: 'text',
      isDeleted: false,
    }));

    await Message.insertMany(msgs);
    results.messages += msgs.length;
    results.conversations++;
  }

  // Create announcements
  const announcements = [
    {
      title: 'Annual Day Celebration',
      message:
        'Annual Day will be celebrated on March 28th. All students must participate in at least one event. Practice sessions start next week.',
    },
    {
      title: 'Parent-Teacher Meeting',
      message:
        'PTM is scheduled for this Saturday from 9 AM to 1 PM. All parents are requested to attend.',
    },
    {
      title: 'Holiday Notice',
      message:
        'School will remain closed on account of Republic Day. Classes will resume on Monday.',
    },
  ];

  for (const ann of announcements) {
    await Announcement.create({
      schoolId,
      title: ann.title,
      message: ann.message,
      type: 'general',
      priority: pick(['normal', 'high']),
      targetAudience: 'all',
      createdBy: staffIds[0],
      status: 'sent',
      sentAt: new Date(),
    });
    results.announcements++;
  }

  return results;
}

// ─── API Endpoints ────────────────────────────────────────────

/**
 * GET /api/seed-data/preview
 * Show what dummy data will be created
 */
router.get('/preview', authenticate, checkPermission('classes', 'delete'), async (req, res) => {
  try {
    const preview = {
      staff: {
        label: 'Staff',
        description: '10 staff members (Principal, VP, 6 Teachers, Accountant, Receptionist)',
        count: 10,
      },
      classes: {
        label: 'Classes',
        description: '5 classes (Class 1-5, Section A) with subjects',
        count: 5,
      },
      students: {
        label: 'Students',
        description: '40-60 students across all classes with parents',
        count: '40-60',
      },
      attendance: {
        label: 'Attendance',
        description: '7 days of attendance records for all students',
        count: '~350',
      },
      academics: {
        label: 'Academics',
        description: '1 exam schedule, 20 exams, results for all students',
        count: '~250',
      },
      fees: {
        label: 'Fees',
        description: '7 fee heads, templates, structures, and sample payments',
        count: '~30',
      },
      frontDesk: {
        label: 'Front Desk',
        description: '8 visitors, 5 appointments, 4 feedback, 5 call logs',
        count: 22,
      },
      messaging: {
        label: 'Messaging',
        description: '4 conversations with messages, 3 announcements',
        count: '~30',
      },
    };

    res.json({ success: true, preview });
  } catch (error) {
    console.error('Error generating seed preview:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to generate preview', error: error.message });
  }
});

/**
 * POST /api/seed-data/generate
 * Generate dummy data for selected categories
 */
router.post(
  '/generate',
  authenticate,
  checkPermission('classes', 'delete'),
  validateZod(seedSchema),
  async (req, res) => {
    try {
      const schoolId = extractSchoolId(req.user?.schoolId);
      if (!schoolId) {
        return res
          .status(400)
          .json({ success: false, message: req.t('common:errors.unauthorized') });
      }

      const { categories } = req.body;
      const isAll = categories.includes('all');
      const selected = isAll ? SEED_CATEGORIES.filter((c) => c !== 'all') : categories;

      const results = {};
      let staffIds = [];
      let classes = [];
      let students = [];

      // Staff must be created first (others depend on it)
      if (selected.includes('staff')) {
        const created = await seedStaff(schoolId, req.user?.id);
        staffIds = created.map((s) => s._id);
        results.staff = { label: 'Staff', created: created.length };
      }

      // If staff wasn't seeded, load existing staff
      if (staffIds.length === 0) {
        const existing = await Staff.find({ schoolId, isDeleted: { $ne: true } })
          .select('_id')
          .lean();
        staffIds = existing.map((s) => s._id);
      }

      if (staffIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No staff found. Please seed staff first or select "Staff" category.',
        });
      }

      // Classes depend on staff
      if (selected.includes('classes')) {
        const created = await seedClasses(schoolId, staffIds);
        classes = created;
        results.classes = { label: 'Classes', created: created.length };
      }

      // Load existing classes if not seeded
      if (classes.length === 0) {
        classes = await Class.find({ schoolId, isDeleted: { $ne: true } }).lean();
      }

      // Students depend on classes
      if (selected.includes('students')) {
        if (classes.length === 0) {
          results.students = {
            label: 'Students',
            created: 0,
            skipped: 'No classes found. Seed classes first.',
          };
        } else {
          const { students: s, parents: p } = await seedStudents(schoolId, classes);
          students = s;
          results.students = { label: 'Students', created: s.length, parents: p.length };
        }
      }

      // Load existing students if not seeded
      if (students.length === 0) {
        students = await Student.find({ schoolId, isDeleted: { $ne: true } }).lean();
      }

      // Attendance depends on students
      if (selected.includes('attendance')) {
        if (students.length === 0) {
          results.attendance = { label: 'Attendance', created: 0, skipped: 'No students found.' };
        } else {
          const created = await seedAttendance(schoolId, students, classes, staffIds);
          results.attendance = { label: 'Attendance', created: created.length };
        }
      }

      // Academics depends on classes and students
      if (selected.includes('academics')) {
        if (classes.length === 0 || students.length === 0) {
          results.academics = {
            label: 'Academics',
            created: 0,
            skipped: 'Need classes and students.',
          };
        } else {
          const acadResults = await seedAcademics(schoolId, classes, students, staffIds);
          results.academics = { label: 'Academics', ...acadResults };
        }
      }

      // Fees depends on classes and students
      if (selected.includes('fees')) {
        if (classes.length === 0) {
          results.fees = { label: 'Fees', created: 0, skipped: 'Need classes.' };
        } else {
          const feeResults = await seedFees(schoolId, classes, students);
          results.fees = { label: 'Fees', ...feeResults };
        }
      }

      // Front Desk
      if (selected.includes('frontDesk')) {
        const fdResults = await seedFrontDesk(schoolId, staffIds);
        results.frontDesk = { label: 'Front Desk', ...fdResults };
      }

      // Messaging
      if (selected.includes('messaging')) {
        const msgResults = await seedMessaging(schoolId, staffIds);
        results.messaging = { label: 'Messaging', ...msgResults };
      }

      res.json({
        success: true,
        message: 'Dummy data generated successfully!',
        results,
      });
    } catch (error) {
      console.error('Error generating seed data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate seed data',
        error: error.message,
      });
    }
  }
);

export default router;
