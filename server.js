import express from 'express';
import cors from 'cors';
import mongoose from './database.js';
import { connectDB, Staff, Student, Class, Attendance, getNextStaffCode, Timetable, IntakeForm, FormAssignment, FormSubmission, Notification } from './database.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

await connectDB();

// Helper function to generate random password
function generatePassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// ============ AUTH ROUTES ============
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const staff = await Staff.findOne({ phone, password, status: 'active' });
    if (!staff) return res.status(401).json({ error: 'Invalid credentials' });
    
    // Get classes where this staff is class teacher
    const classes = await Class.find({ classTeacherId: staff._id });
    
    res.json({
      id: staff._id,
      code: staff.code,
      name: staff.name,
      role: staff.role,
      email: staff.email,
      classes: classes.map(c => ({ id: c._id, name: c.name, section: c.section })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ STAFF ROUTES ============
app.get('/api/staff', async (req, res) => {
  try {
    const staff = await Staff.find().populate('reporterId', 'name').sort({ createdAt: 1 });
    const formatted = await Promise.all(staff.map(async s => {
      const assignedClass = await Class.findOne({ classTeacherId: s._id });
      return {
        id: s._id, code: s.code, name: s.name, role: s.role, department: s.department,
        status: s.status, phone: s.phone, email: s.email, joinDate: s.joinDate, address: s.address,
        username: s.username,
        password: s.password, // Include password for admin to view
        assignedClass: assignedClass ? `${assignedClass.name} ${assignedClass.section}` : null,
        assignedClassId: assignedClass?._id,
        reporterId: s.reporterId?._id,
        reporterName: s.reporterId?.name,
      };
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/staff/:id', async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id).populate('reporterId', 'name');
    if (!staff) return res.status(404).json({ error: 'Staff not found' });
    const assignedClass = await Class.findOne({ classTeacherId: staff._id });
    res.json({
      id: staff._id, 
      code: staff.code,
      name: staff.name,
      role: staff.role,
      department: staff.department,
      status: staff.status,
      phone: staff.phone,
      email: staff.email,
      joinDate: staff.joinDate,
      address: staff.address,
      username: staff.username,
      password: staff.password, // Include for admin to view/edit
      assignedClass: assignedClass ? `${assignedClass.name} ${assignedClass.section}` : null,
      assignedClassId: assignedClass?._id,
      reporterId: staff.reporterId?._id,
      reporterName: staff.reporterId?.name,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/staff', async (req, res) => {
  try {
    const { name, role, department, status, phone, email, joinDate, address, assignedClassId, reporterId } = req.body;
    const code = await getNextStaffCode();
    
    // Validate circular reference
    if (reporterId) {
      const reporter = await Staff.findById(reporterId);
      if (!reporter) {
        return res.status(400).json({ error: 'Reporter not found' });
      }
    }
    
    // Auto-generate username from email or code
    const username = email ? email.split('@')[0].toLowerCase() : code.toLowerCase();
    // Auto-generate random password
    const password = generatePassword(8);
    
    const staff = new Staff({
      code, name, role, department, status: status || 'active',
      phone, email, joinDate, address, username, password,
      reporterId: reporterId || null,
    });
    await staff.save();
    
    // If class teacher, assign to class
    if (role === 'Teacher' && assignedClassId) {
      await Class.findByIdAndUpdate(assignedClassId, { classTeacherId: staff._id });
    }
    
    const assignedClass = assignedClassId ? await Class.findById(assignedClassId) : null;
    
    res.status(201).json({ 
      id: staff._id, 
      code: staff.code,
      name: staff.name,
      role: staff.role,
      department: staff.department,
      status: staff.status,
      phone: staff.phone,
      email: staff.email,
      joinDate: staff.joinDate,
      address: staff.address,
      username,
      password, // Return the generated password so admin can share it
      assignedClass: assignedClass ? `${assignedClass.name} ${assignedClass.section}` : null,
      assignedClassId: assignedClass?._id,
      reporterId: staff.reporterId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/staff/:id', async (req, res) => {
  try {
    const { name, role, department, status, phone, email, joinDate, address, assignedClassId, username, password, reporterId } = req.body;
    
    // Validate circular reference if reporterId is being updated
    if (reporterId !== undefined && reporterId !== null) {
      // Check if reporter exists
      const reporter = await Staff.findById(reporterId);
      if (!reporter) {
        return res.status(400).json({ error: 'Reporter not found' });
      }
      
      // Check for circular reference
      const checkCircular = async (currentId, targetId, visited = new Set()) => {
        if (currentId === targetId) return true;
        if (visited.has(currentId)) return false;
        visited.add(currentId);
        
        const current = await Staff.findById(currentId);
        if (!current || !current.reporterId) return false;
        
        return checkCircular(current.reporterId.toString(), targetId, visited);
      };
      
      const hasCircular = await checkCircular(reporterId, req.params.id);
      if (hasCircular) {
        return res.status(400).json({ error: 'Cannot assign reporter: This would create a circular reference' });
      }
    }
    
    // Build update object - only include password if provided
    const updateData = { name, role, department, status, phone, email, joinDate, address };
    if (username) updateData.username = username;
    if (password) updateData.password = password;
    if (reporterId !== undefined) updateData.reporterId = reporterId || null;
    
    const staff = await Staff.findByIdAndUpdate(req.params.id, updateData, { new: true }).populate('reporterId', 'name');
    if (!staff) return res.status(404).json({ error: 'Staff not found' });
    
    // Update class assignment
    await Class.updateMany({ classTeacherId: staff._id }, { $unset: { classTeacherId: 1 } });
    if (assignedClassId) {
      await Class.findByIdAndUpdate(assignedClassId, { classTeacherId: staff._id });
    }
    
    const assignedClass = await Class.findOne({ classTeacherId: staff._id });
    res.json({ 
      id: staff._id, 
      ...staff.toObject(),
      assignedClass: assignedClass ? `${assignedClass.name} ${assignedClass.section}` : null,
      assignedClassId: assignedClass?._id,
      reporterId: staff.reporterId?._id,
      reporterName: staff.reporterId?.name,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update staff credentials
app.put('/api/staff/:id/credentials', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username && !password) {
      return res.status(400).json({ error: 'Username or password required' });
    }
    
    const updateData = {};
    if (username) updateData.username = username;
    if (password) updateData.password = password;
    
    const staff = await Staff.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!staff) return res.status(404).json({ error: 'Staff not found' });
    
    res.json({ success: true, username: staff.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/staff/:id', async (req, res) => {
  try {
    await Class.updateMany({ classTeacherId: req.params.id }, { $unset: { classTeacherId: 1 } });
    const result = await Staff.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Staff not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============ CLASS ROUTES ============
app.get('/api/classes', async (req, res) => {
  try {
    const { teacherId } = req.query;
    const query = teacherId ? { classTeacherId: teacherId } : {};
    const classes = await Class.find(query).populate('classTeacherId', 'name').sort({ name: 1, section: 1 });
    
    const formatted = await Promise.all(classes.map(async c => {
      const studentCount = await Student.countDocuments({ classId: c._id });
      return {
        id: c._id, name: c.name, section: c.section, subjects: c.subjects,
        classTeacherId: c.classTeacherId?._id, classTeacherName: c.classTeacherId?.name,
        studentCount, academicYear: c.academicYear,
      };
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/classes/:id', async (req, res) => {
  try {
    const cls = await Class.findById(req.params.id).populate('classTeacherId', 'name');
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    const studentCount = await Student.countDocuments({ classId: cls._id });
    res.json({
      id: cls._id, name: cls.name, section: cls.section, subjects: cls.subjects,
      classTeacherId: cls.classTeacherId?._id, classTeacherName: cls.classTeacherId?.name,
      studentCount, academicYear: cls.academicYear,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/classes', async (req, res) => {
  try {
    const { name, section, classTeacherId, subjects, academicYear } = req.body;
    const cls = new Class({ name, section, classTeacherId, subjects, academicYear });
    await cls.save();
    res.status(201).json({ id: cls._id, ...cls.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/classes/:id', async (req, res) => {
  try {
    const { name, section, classTeacherId, subjects, academicYear } = req.body;
    const cls = await Class.findByIdAndUpdate(req.params.id,
      { name, section, classTeacherId, subjects, academicYear }, { new: true }
    );
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    res.json({ id: cls._id, ...cls.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/classes/:id', async (req, res) => {
  try {
    const studentCount = await Student.countDocuments({ classId: req.params.id });
    if (studentCount > 0) return res.status(400).json({ error: 'Cannot delete class with students' });
    const result = await Class.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Class not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/classes/:id/students', async (req, res) => {
  try {
    const students = await Student.find({ classId: req.params.id }).sort({ rollNo: 1 });
    res.json(students.map(s => ({ id: s._id, ...s.toObject() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============ STUDENT ROUTES ============
app.get('/api/students', async (req, res) => {
  try {
    const { classId } = req.query;
    const query = classId ? { classId } : {};
    const students = await Student.find(query).populate('classId', 'name section').sort({ rollNo: 1 });
    const formatted = students.map(s => {
      const classInfo = s.classId ? `${s.classId.name.replace('Class ', '')}-${s.classId.section}` : null;
      return {
        id: s._id,
        name: s.name,
        admissionId: s.admissionId,
        academicYear: s.academicYear,
        rollNo: s.rollNo,
        classId: s.classId?._id,
        class: classInfo,
        className: s.classId ? `${s.classId.name} ${s.classId.section}` : null,
        
        // Personal Information
        gender: s.gender,
        dateOfBirth: s.dateOfBirth,
        bloodGroup: s.bloodGroup,
        nationality: s.nationality,
        religion: s.religion,
        category: s.category,
        motherTongue: s.motherTongue,
        
        // Contact Information
        phone: s.phone,
        email: s.email,
        address: s.address,
        
        // Parent Information
        parentName: s.parentName,
        parentPhone: s.parentPhone,
        parentEmail: s.parentEmail,
        parentRelationship: s.parentRelationship,
        parentOccupation: s.parentOccupation,
        alternatePhone: s.alternatePhone,
        parents: s.parents,
        
        // Academic Information
        previousSchool: s.previousSchool,
        tcNumber: s.tcNumber,
        mediumOfInstruction: s.mediumOfInstruction,
        house: s.house,
        
        // Health & Safety
        medicalConditions: s.medicalConditions,
        emergencyContactName: s.emergencyContactName,
        emergencyContactPhone: s.emergencyContactPhone,
        
        // Requirements
        transportRequired: s.transportRequired,
        hostelRequired: s.hostelRequired,
        
        // Status
        feeStatus: s.feeStatus,
        status: s.status,
        
        // Documents
        documents: s.documents,
        photo: s.photo,
      };
    });
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/:id', async (req, res) => {
  try {
    const student = await Student.findById(req.params.id).populate('classId', 'name section');
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const classInfo = student.classId ? `${student.classId.name.replace('Class ', '')}-${student.classId.section}` : null;
    res.json({
      id: student._id,
      ...student.toObject(),
      class: classInfo,
      className: student.classId ? `${student.classId.name} ${student.classId.section}` : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/students', async (req, res) => {
  try {
    const studentData = {
      // Basic Information
      name: req.body.name,
      admissionId: req.body.admissionId,
      academicYear: req.body.academicYear,
      rollNo: req.body.rollNo,
      classId: req.body.classId,
      
      // Personal Information
      gender: req.body.gender,
      dateOfBirth: req.body.dateOfBirth,
      bloodGroup: req.body.bloodGroup,
      nationality: req.body.nationality,
      religion: req.body.religion,
      category: req.body.category,
      motherTongue: req.body.motherTongue,
      aadhaarNumber: req.body.aadhaarNumber,
      
      // Contact Information
      phone: req.body.phone,
      email: req.body.email,
      address: req.body.address,
      
      // Parent Information
      parentName: req.body.parentName,
      parentPhone: req.body.parentPhone,
      parentEmail: req.body.parentEmail,
      parentRelationship: req.body.parentRelationship,
      parentOccupation: req.body.parentOccupation,
      alternatePhone: req.body.alternatePhone,
      parents: req.body.parents || [],
      
      // Academic Information
      previousSchool: req.body.previousSchool,
      tcNumber: req.body.tcNumber,
      mediumOfInstruction: req.body.mediumOfInstruction,
      house: req.body.house,
      
      // Health & Safety
      medicalConditions: req.body.medicalConditions,
      emergencyContactName: req.body.emergencyContactName,
      emergencyContactPhone: req.body.emergencyContactPhone,
      
      // Requirements
      transportRequired: req.body.transportRequired || false,
      hostelRequired: req.body.hostelRequired || false,
      
      // Status
      feeStatus: req.body.feeStatus || 'pending',
      status: req.body.status || 'active',
      
      // Photo
      photo: req.body.photo,
      
      // Documents
      documents: req.body.documents || []
    };
    
    const student = new Student(studentData);
    await student.save();
    res.status(201).json({ id: student._id, ...student.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/students/:id', async (req, res) => {
  try {
    const updateData = {
      // Basic Information
      name: req.body.name,
      admissionId: req.body.admissionId,
      academicYear: req.body.academicYear,
      rollNo: req.body.rollNo,
      classId: req.body.classId,
      
      // Personal Information
      gender: req.body.gender,
      dateOfBirth: req.body.dateOfBirth,
      bloodGroup: req.body.bloodGroup,
      nationality: req.body.nationality,
      religion: req.body.religion,
      category: req.body.category,
      motherTongue: req.body.motherTongue,
      aadhaarNumber: req.body.aadhaarNumber,
      
      // Contact Information
      phone: req.body.phone,
      email: req.body.email,
      address: req.body.address,
      
      // Parent Information
      parentName: req.body.parentName,
      parentPhone: req.body.parentPhone,
      parentEmail: req.body.parentEmail,
      parentRelationship: req.body.parentRelationship,
      parentOccupation: req.body.parentOccupation,
      alternatePhone: req.body.alternatePhone,
      parents: req.body.parents,
      
      // Academic Information
      previousSchool: req.body.previousSchool,
      tcNumber: req.body.tcNumber,
      mediumOfInstruction: req.body.mediumOfInstruction,
      house: req.body.house,
      
      // Health & Safety
      medicalConditions: req.body.medicalConditions,
      emergencyContactName: req.body.emergencyContactName,
      emergencyContactPhone: req.body.emergencyContactPhone,
      
      // Requirements
      transportRequired: req.body.transportRequired,
      hostelRequired: req.body.hostelRequired,
      
      // Status
      feeStatus: req.body.feeStatus,
      status: req.body.status,
      
      // Photo
      photo: req.body.photo,
      
      // Documents
      documents: req.body.documents
    };
    
    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });
    
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({ id: student._id, ...student.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    const result = await Student.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Student not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============ ATTENDANCE ROUTES ============
app.post('/api/attendance', async (req, res) => {
  try {
    const { studentId, classId, date, status, markedBy } = req.body;
    await Attendance.findOneAndUpdate(
      { studentId, date },
      { studentId, classId, date, status, markedBy },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/attendance/bulk', async (req, res) => {
  try {
    const { classId, date, attendance, markedBy } = req.body;
    // attendance is array of { studentId, status }
    const ops = attendance.map(a => ({
      updateOne: {
        filter: { studentId: a.studentId, date },
        update: { studentId: a.studentId, classId, date, status: a.status, markedBy },
        upsert: true
      }
    }));
    await Attendance.bulkWrite(ops);
    res.json({ success: true, count: attendance.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/attendance/:classId/:date', async (req, res) => {
  try {
    const { classId, date } = req.params;
    const records = await Attendance.find({ classId, date }).populate('studentId', 'name rollNo');
    res.json(records.map(r => ({
      studentId: r.studentId?._id,
      studentName: r.studentId?.name,
      rollNo: r.studentId?.rollNo,
      status: r.status,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ TIMETABLE ROUTES ============
// Get timetable for a class
app.get('/api/timetable/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear } = req.query;
    const query = { classId };
    if (academicYear) query.academicYear = academicYear;
    
    const timetable = await Timetable.findOne(query).populate('schedule.Monday.teacherId schedule.Tuesday.teacherId schedule.Wednesday.teacherId schedule.Thursday.teacherId schedule.Friday.teacherId schedule.Saturday.teacherId', 'name');
    
    if (!timetable) {
      return res.json(null);
    }
    
    res.json({
      id: timetable._id,
      classId: timetable.classId,
      academicYear: timetable.academicYear,
      periods: timetable.periods,
      schedule: timetable.schedule
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create or update timetable
app.post('/api/timetable', async (req, res) => {
  try {
    const { classId, academicYear, periods, schedule } = req.body;
    
    const timetable = await Timetable.findOneAndUpdate(
      { classId, academicYear: academicYear || '2024-25' },
      { classId, academicYear: academicYear || '2024-25', periods, schedule },
      { upsert: true, new: true }
    );
    
    res.json({
      id: timetable._id,
      classId: timetable.classId,
      academicYear: timetable.academicYear,
      periods: timetable.periods,
      schedule: timetable.schedule
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update specific period slot
app.put('/api/timetable/:classId/slot', async (req, res) => {
  try {
    const { classId } = req.params;
    const { day, periodIndex, subject, teacherId, room, academicYear } = req.body;
    
    const updatePath = `schedule.${day}.${periodIndex}`;
    const timetable = await Timetable.findOneAndUpdate(
      { classId, academicYear: academicYear || '2024-25' },
      { 
        $set: { 
          [updatePath]: { subject, teacherId, room }
        }
      },
      { new: true, upsert: true }
    );
    
    res.json({ success: true, timetable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update periods configuration
app.put('/api/timetable/:classId/periods', async (req, res) => {
  try {
    const { classId } = req.params;
    const { periods, academicYear } = req.body;
    
    const timetable = await Timetable.findOneAndUpdate(
      { classId, academicYear: academicYear || '2024-25' },
      { periods },
      { new: true, upsert: true }
    );
    
    res.json({ success: true, periods: timetable.periods });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete timetable
app.delete('/api/timetable/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear } = req.query;
    await Timetable.findOneAndDelete({ classId, academicYear: academicYear || '2024-25' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: 'mongodb', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


// ============ INTAKE FORMS ROUTES ============

// Helper function to generate unique access token
function generateAccessToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Forms CRUD
app.get('/api/intake-forms', async (req, res) => {
  try {
    const { type, status } = req.query;
    const query = {};
    if (type) query.formType = type;
    if (status) query.status = status;
    
    const forms = await IntakeForm.find(query)
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });
    
    // Get assignment and submission counts for each form
    const formatted = await Promise.all(forms.map(async form => {
      const assignmentCount = await FormAssignment.countDocuments({ formId: form._id });
      const submissionCount = await FormSubmission.countDocuments({ formId: form._id });
      
      return {
        id: form._id,
        formName: form.formName,
        formType: form.formType,
        fields: form.fields,
        status: form.status,
        createdBy: form.createdBy?.name,
        createdAt: form.createdAt,
        assignmentCount,
        submissionCount,
      };
    }));
    
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intake-forms/:id', async (req, res) => {
  try {
    const form = await IntakeForm.findById(req.params.id).populate('createdBy', 'name');
    if (!form) return res.status(404).json({ error: 'Form not found' });
    
    res.json({
      id: form._id,
      formName: form.formName,
      formType: form.formType,
      fields: form.fields,
      status: form.status,
      createdBy: form.createdBy?.name,
      createdAt: form.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/intake-forms', async (req, res) => {
  try {
    const { formName, formType, fields, status, createdBy } = req.body;
    
    // Debug logging
    console.log('Received fields type:', typeof fields);
    console.log('Received fields is Array:', Array.isArray(fields));
    console.log('Received fields:', JSON.stringify(fields, null, 2));
    
    const form = new IntakeForm({
      formName,
      formType: formType || 'staff',
      fields,
      status: status || 'active',
      // Only set createdBy if it's a valid ObjectId, otherwise leave it undefined
      ...(createdBy && mongoose.Types.ObjectId.isValid(createdBy) ? { createdBy } : {}),
    });
    
    await form.save();
    
    res.status(201).json({
      id: form._id,
      formName: form.formName,
      formType: form.formType,
      fields: form.fields,
      status: form.status,
      createdAt: form.createdAt,
    });
  } catch (err) {
    console.error('Error creating intake form:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/intake-forms/:id', async (req, res) => {
  try {
    const { formName, formType, fields, status } = req.body;
    
    const form = await IntakeForm.findByIdAndUpdate(
      req.params.id,
      { formName, formType, fields, status },
      { new: true }
    );
    
    if (!form) return res.status(404).json({ error: 'Form not found' });
    
    res.json({
      id: form._id,
      formName: form.formName,
      formType: form.formType,
      fields: form.fields,
      status: form.status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/intake-forms/:id', async (req, res) => {
  try {
    // Check if form has submissions
    const submissionCount = await FormSubmission.countDocuments({ formId: req.params.id });
    if (submissionCount > 0) {
      // Archive instead of delete
      await IntakeForm.findByIdAndUpdate(req.params.id, { status: 'archived' });
      return res.json({ success: true, archived: true });
    }
    
    // Delete form and its assignments
    await FormAssignment.deleteMany({ formId: req.params.id });
    const result = await IntakeForm.findByIdAndDelete(req.params.id);
    
    if (!result) return res.status(404).json({ error: 'Form not found' });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/intake-forms/:id/duplicate', async (req, res) => {
  try {
    const originalForm = await IntakeForm.findById(req.params.id);
    if (!originalForm) return res.status(404).json({ error: 'Form not found' });
    
    console.log('Duplicating form:', originalForm.formName);
    console.log('Original fields type:', typeof originalForm.fields);
    console.log('Original fields is Array:', Array.isArray(originalForm.fields));
    
    // Generate a unique name with numbered suffix
    let baseName = originalForm.formName;
    // Remove existing " (Copy)" or " Copy X" suffixes
    baseName = baseName.replace(/\s*\(Copy\)(\s*\(Copy\))*/g, '').replace(/\s*Copy\s*\d*$/g, '').trim();
    
    // Find existing copies to determine the next number
    const existingCopies = await IntakeForm.find({
      formName: new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( Copy \\d+)?$`)
    });
    
    let copyNumber = 1;
    const existingNumbers = existingCopies
      .map(f => {
        const match = f.formName.match(/Copy (\d+)$/);
        return match ? parseInt(match[1]) : (f.formName === baseName ? 0 : null);
      })
      .filter(n => n !== null);
    
    if (existingNumbers.length > 0) {
      copyNumber = Math.max(...existingNumbers) + 1;
    }
    
    const newFormName = `${baseName} Copy ${copyNumber}`;
    
    const newForm = new IntakeForm({
      formName: newFormName,
      formType: originalForm.formType,
      fields: originalForm.fields,
      status: 'active',
      // Only set createdBy if it's a valid ObjectId, otherwise leave it undefined
      ...(req.body.createdBy && mongoose.Types.ObjectId.isValid(req.body.createdBy) ? { createdBy: req.body.createdBy } : {}),
    });
    
    await newForm.save();
    
    res.status(201).json({
      id: newForm._id,
      formName: newForm.formName,
      formType: newForm.formType,
      fields: newForm.fields,
      status: newForm.status,
    });
  } catch (err) {
    console.error('Error duplicating form:', err);
    res.status(500).json({ error: err.message });
  }
});

// Form Assignment
app.post('/api/intake-forms/:id/assign', async (req, res) => {
  try {
    const { emails, phones, expiresInDays, assignedBy } = req.body;
    const formId = req.params.id;
    
    // Validate formId
    if (!mongoose.Types.ObjectId.isValid(formId)) {
      return res.status(400).json({ error: 'Invalid form ID' });
    }
    
    const form = await IntakeForm.findById(formId);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    
    // Validate assignedBy if provided
    if (assignedBy && !mongoose.Types.ObjectId.isValid(assignedBy)) {
      return res.status(400).json({ error: 'Invalid assignedBy ID' });
    }
    
    const assignments = [];
    const recipients = [];
    
    // Process emails
    if (emails && emails.length > 0) {
      for (const email of emails) {
        const accessToken = generateAccessToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + (expiresInDays || 30));
        
        const assignment = new FormAssignment({
          formId,
          assignedToEmail: email.trim(),
          assignedBy: assignedBy || undefined,
          accessToken,
          expiresAt,
        });
        
        await assignment.save();
        assignments.push(assignment);
        recipients.push(email.trim());
        
        // Create notification
        const notification = new Notification({
          userEmail: email.trim(),
          notificationType: 'form_assignment',
          title: 'New Form Assignment',
          message: `You have been assigned to fill the form: ${form.formName}`,
          data: {
            formId: form._id,
            assignmentId: assignment._id,
            accessToken,
            formName: form.formName,
          },
        });
        await notification.save();
      }
    }
    
    // Process phones
    if (phones && phones.length > 0) {
      for (const phone of phones) {
        const accessToken = generateAccessToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + (expiresInDays || 30));
        
        const assignment = new FormAssignment({
          formId,
          assignedToPhone: phone.trim(),
          assignedBy: assignedBy || undefined,
          accessToken,
          expiresAt,
        });
        
        await assignment.save();
        assignments.push(assignment);
        recipients.push(phone.trim());
        
        // Create notification
        const notification = new Notification({
          userPhone: phone.trim(),
          notificationType: 'form_assignment',
          title: 'New Form Assignment',
          message: `You have been assigned to fill the form: ${form.formName}`,
          data: {
            formId: form._id,
            assignmentId: assignment._id,
            accessToken,
            formName: form.formName,
          },
        });
        await notification.save();
      }
    }
    
    res.status(201).json({
      success: true,
      assignmentCount: assignments.length,
      assignments: assignments.map(a => ({
        id: a._id,
        accessToken: a.accessToken,
        assignedTo: a.assignedToEmail || a.assignedToPhone,
        expiresAt: a.expiresAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/form-assignments', async (req, res) => {
  try {
    const { formId, status } = req.query;
    const query = {};
    if (formId) query.formId = formId;
    if (status) query.status = status;
    
    const assignments = await FormAssignment.find(query)
      .populate('formId', 'formName formType')
      .populate('assignedBy', 'name')
      .sort({ assignedAt: -1 });
    
    const formatted = assignments.map(a => ({
      id: a._id,
      formName: a.formId?.formName,
      formType: a.formId?.formType,
      assignedTo: a.assignedToEmail || a.assignedToPhone,
      assignedBy: a.assignedBy?.name,
      status: a.status,
      accessToken: a.accessToken,
      expiresAt: a.expiresAt,
      assignedAt: a.assignedAt,
    }));
    
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/form-assignments/:id', async (req, res) => {
  try {
    const assignment = await FormAssignment.findById(req.params.id)
      .populate('formId')
      .populate('assignedBy', 'name');
    
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    
    res.json({
      id: assignment._id,
      form: assignment.formId,
      assignedTo: assignment.assignedToEmail || assignment.assignedToPhone,
      assignedBy: assignment.assignedBy?.name,
      status: assignment.status,
      accessToken: assignment.accessToken,
      expiresAt: assignment.expiresAt,
      assignedAt: assignment.assignedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/form-assignments/:id/resend', async (req, res) => {
  try {
    const assignment = await FormAssignment.findById(req.params.id).populate('formId', 'formName');
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    
    // Create new notification
    const notification = new Notification({
      userEmail: assignment.assignedToEmail,
      userPhone: assignment.assignedToPhone,
      notificationType: 'form_reminder',
      title: 'Form Reminder',
      message: `Reminder: Please complete the form: ${assignment.formId.formName}`,
      data: {
        formId: assignment.formId._id,
        assignmentId: assignment._id,
        accessToken: assignment.accessToken,
        formName: assignment.formId.formName,
      },
    });
    await notification.save();
    
    res.json({ success: true, message: 'Notification resent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/form-assignments/:id', async (req, res) => {
  try {
    const result = await FormAssignment.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Assignment not found' });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Form Submissions
app.get('/api/form-submissions', async (req, res) => {
  try {
    const { formId, reviewStatus } = req.query;
    const query = {};
    if (formId) query.formId = formId;
    if (reviewStatus) query.reviewStatus = reviewStatus;
    
    const submissions = await FormSubmission.find(query)
      .populate('formId', 'formName formType')
      .populate('reviewedBy', 'name')
      .sort({ submittedAt: -1 });
    
    const formatted = submissions.map(s => ({
      id: s._id,
      formName: s.formId?.formName,
      formType: s.formId?.formType,
      submittedBy: s.submittedByEmail || s.submittedByPhone,
      submittedAt: s.submittedAt,
      reviewStatus: s.reviewStatus,
      reviewedBy: s.reviewedBy?.name,
      reviewedAt: s.reviewedAt,
      staffId: s.staffId,
    }));
    
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/form-submissions/:id', async (req, res) => {
  try {
    const submission = await FormSubmission.findById(req.params.id)
      .populate('formId')
      .populate('assignmentId')
      .populate('reviewedBy', 'name')
      .populate('staffId');
    
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    
    res.json({
      id: submission._id,
      form: submission.formId,
      assignment: submission.assignmentId,
      submissionData: submission.submissionData,
      submittedBy: submission.submittedByEmail || submission.submittedByPhone,
      submittedAt: submission.submittedAt,
      reviewStatus: submission.reviewStatus,
      reviewedBy: submission.reviewedBy?.name,
      reviewedAt: submission.reviewedAt,
      reviewNotes: submission.reviewNotes,
      staff: submission.staffId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/form-submissions/:id/review', async (req, res) => {
  try {
    const { status, notes, reviewedBy } = req.body;
    const submission = await FormSubmission.findById(req.params.id)
      .populate('formId')
      .populate('assignmentId');
    
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    
    submission.reviewStatus = status;
    submission.reviewNotes = notes;
    submission.reviewedBy = reviewedBy;
    submission.reviewedAt = new Date();
    
    // If approved, create staff record
    if (status === 'approved') {
      const form = submission.formId;
      const data = submission.submissionData;
      
      // Map form fields to staff data
      const staffData = {
        code: await getNextStaffCode(),
        name: data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : data.name || 'New Staff',
        role: data.designation || 'Teacher',
        department: data.department,
        status: 'active',
        phone: data.phone,
        email: data.email,
        joinDate: data.dateOfJoining,
        address: data.address,
      };
      
      // Auto-generate credentials
      staffData.username = data.email ? data.email.split('@')[0].toLowerCase() : staffData.code.toLowerCase();
      staffData.password = generatePassword(8);
      
      const newStaff = new Staff(staffData);
      await newStaff.save();
      
      submission.staffId = newStaff._id;
      
      // Update assignment status
      await FormAssignment.findByIdAndUpdate(submission.assignmentId._id, { status: 'approved' });
      
      // Create approval notification
      const notification = new Notification({
        userEmail: submission.submittedByEmail,
        userPhone: submission.submittedByPhone,
        notificationType: 'form_approved',
        title: 'Form Approved',
        message: `Your ${form.formName} has been approved. Welcome to the team!`,
        data: {
          formId: form._id,
          submissionId: submission._id,
          staffId: newStaff._id,
          username: staffData.username,
          password: staffData.password,
        },
      });
      await notification.save();
    } else if (status === 'rejected') {
      // Update assignment status
      await FormAssignment.findByIdAndUpdate(submission.assignmentId._id, { status: 'rejected' });
      
      // Create rejection notification
      const notification = new Notification({
        userEmail: submission.submittedByEmail,
        userPhone: submission.submittedByPhone,
        notificationType: 'form_rejected',
        title: 'Form Needs Revision',
        message: `Your form submission needs revision. Reason: ${notes || 'Please review and resubmit.'}`,
        data: {
          formId: submission.formId._id,
          submissionId: submission._id,
          notes,
        },
      });
      await notification.save();
    }
    
    await submission.save();
    
    res.json({
      success: true,
      submission: {
        id: submission._id,
        reviewStatus: submission.reviewStatus,
        reviewNotes: submission.reviewNotes,
        reviewedAt: submission.reviewedAt,
        staffId: submission.staffId,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/form-submissions/:id', async (req, res) => {
  try {
    const result = await FormSubmission.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Submission not found' });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ PUBLIC/TOKEN-BASED ROUTES (Teacher App) ============

// Get form by access token
app.get('/api/public/form-assignment/:token', async (req, res) => {
  try {
    const assignment = await FormAssignment.findOne({ accessToken: req.params.token })
      .populate('formId');
    
    if (!assignment) return res.status(404).json({ error: 'Invalid or expired token' });
    
    // Check if expired
    if (new Date() > assignment.expiresAt) {
      return res.status(410).json({ error: 'This form link has expired' });
    }
    
    // Check if already submitted
    const existingSubmission = await FormSubmission.findOne({ assignmentId: assignment._id });
    if (existingSubmission) {
      return res.status(400).json({ 
        error: 'Form already submitted',
        submissionId: existingSubmission._id,
        status: existingSubmission.reviewStatus,
      });
    }
    
    res.json({
      id: assignment._id,
      form: {
        id: assignment.formId._id,
        formName: assignment.formId.formName,
        formType: assignment.formId.formType,
        fields: assignment.formId.fields,
      },
      assignedTo: assignment.assignedToEmail || assignment.assignedToPhone,
      expiresAt: assignment.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit form
app.post('/api/public/form-submission/:token', async (req, res) => {
  try {
    const { submissionData } = req.body;
    
    const assignment = await FormAssignment.findOne({ accessToken: req.params.token })
      .populate('formId');
    
    if (!assignment) return res.status(404).json({ error: 'Invalid or expired token' });
    
    // Check if expired
    if (new Date() > assignment.expiresAt) {
      return res.status(410).json({ error: 'This form link has expired' });
    }
    
    // Check if already submitted
    const existingSubmission = await FormSubmission.findOne({ assignmentId: assignment._id });
    if (existingSubmission) {
      return res.status(400).json({ error: 'Form already submitted' });
    }
    
    // Create submission
    const submission = new FormSubmission({
      assignmentId: assignment._id,
      formId: assignment.formId._id,
      submissionData,
      submittedByEmail: assignment.assignedToEmail,
      submittedByPhone: assignment.assignedToPhone,
    });
    
    await submission.save();
    
    // Update assignment status
    assignment.status = 'submitted';
    await assignment.save();
    
    // Create notification for admin
    const notification = new Notification({
      notificationType: 'form_submission',
      title: 'New Form Submission',
      message: `New submission received for ${assignment.formId.formName}`,
      data: {
        formId: assignment.formId._id,
        submissionId: submission._id,
        assignmentId: assignment._id,
      },
    });
    await notification.save();
    
    res.status(201).json({
      success: true,
      submissionId: submission._id,
      message: 'Form submitted successfully. Your submission is under review.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check submission status
app.get('/api/public/form-submission/:token/status', async (req, res) => {
  try {
    const assignment = await FormAssignment.findOne({ accessToken: req.params.token });
    
    if (!assignment) return res.status(404).json({ error: 'Invalid token' });
    
    const submission = await FormSubmission.findOne({ assignmentId: assignment._id })
      .populate('formId', 'formName');
    
    if (!submission) {
      return res.json({
        status: 'not_submitted',
        message: 'Form not yet submitted',
      });
    }
    
    res.json({
      status: submission.reviewStatus,
      submittedAt: submission.submittedAt,
      reviewedAt: submission.reviewedAt,
      reviewNotes: submission.reviewNotes,
      formName: submission.formId.formName,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ SETTINGS ROUTES ============

// School Settings
app.get('/api/settings/school', async (req, res) => {
  try {
    // Return default school settings - in production, store in database
    res.json({
      schoolName: 'Demo School',
      schoolCode: 'SCH001',
      address: '123 School Street',
      phone: '+1234567890',
      email: 'info@demoschool.com',
      website: 'www.demoschool.com',
      academicYear: '2024-25',
      currency: 'USD',
      timezone: 'UTC',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/school', async (req, res) => {
  try {
    // In production, save to database
    res.json({ success: true, settings: req.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Holidays
app.get('/api/settings/holidays', async (req, res) => {
  try {
    // Return default holidays - in production, store in database
    res.json([
      { id: 1, name: 'New Year', date: '2025-01-01', type: 'public' },
      { id: 2, name: 'Independence Day', date: '2025-07-04', type: 'public' },
    ]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/holidays', async (req, res) => {
  try {
    // In production, save to database
    res.status(201).json({ success: true, holiday: req.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/holidays/:id', async (req, res) => {
  try {
    // In production, update in database
    res.json({ success: true, holiday: req.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/settings/holidays/:id', async (req, res) => {
  try {
    // In production, delete from database
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leave Types
app.get('/api/settings/leave-types', async (req, res) => {
  try {
    // Return default leave types - in production, store in database
    res.json([
      { id: 1, name: 'Sick Leave', maxDays: 10, requiresApproval: true },
      { id: 2, name: 'Casual Leave', maxDays: 15, requiresApproval: true },
      { id: 3, name: 'Earned Leave', maxDays: 20, requiresApproval: true },
    ]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/leave-types', async (req, res) => {
  try {
    // In production, save to database
    res.status(201).json({ success: true, leaveType: req.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/leave-types/:id', async (req, res) => {
  try {
    // In production, update in database
    res.json({ success: true, leaveType: req.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/settings/leave-types/:id', async (req, res) => {
  try {
    // In production, delete from database
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fee Heads
app.get('/api/settings/fee-heads', async (req, res) => {
  try {
    // Return default fee heads - in production, store in database
    res.json([
      { id: 1, name: 'Tuition Fee', amount: 5000, frequency: 'monthly', mandatory: true },
      { id: 2, name: 'Transport Fee', amount: 1000, frequency: 'monthly', mandatory: false },
      { id: 3, name: 'Library Fee', amount: 500, frequency: 'annual', mandatory: true },
    ]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/fee-heads', async (req, res) => {
  try {
    // In production, save to database
    res.status(201).json({ success: true, feeHead: req.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/fee-heads/:id', async (req, res) => {
  try {
    // In production, update in database
    res.json({ success: true, feeHead: req.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/settings/fee-heads/:id', async (req, res) => {
  try {
    // In production, delete from database
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subjects
app.get('/api/settings/subjects', async (req, res) => {
  try {
    // Return default subjects - in production, store in database
    res.json([
      { id: 1, name: 'Mathematics', code: 'MATH', category: 'Core' },
      { id: 2, name: 'English', code: 'ENG', category: 'Core' },
      { id: 3, name: 'Science', code: 'SCI', category: 'Core' },
      { id: 4, name: 'Social Studies', code: 'SS', category: 'Core' },
      { id: 5, name: 'Physical Education', code: 'PE', category: 'Elective' },
    ]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/subjects', async (req, res) => {
  try {
    // In production, save to database
    res.status(201).json({ success: true, subject: req.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/subjects/:id', async (req, res) => {
  try {
    // In production, update in database
    res.json({ success: true, subject: req.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/settings/subjects/:id', async (req, res) => {
  try {
    // In production, delete from database
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ NOTIFICATIONS ROUTES ============

app.get('/api/notifications', async (req, res) => {
  try {
    const { email, phone } = req.query;
    const query = {};
    
    if (email) query.userEmail = email;
    if (phone) query.userPhone = phone;
    
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true }
    );
    
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/read-all', async (req, res) => {
  try {
    const { email, phone } = req.body;
    const query = {};
    
    if (email) query.userEmail = email;
    if (phone) query.userPhone = phone;
    
    await Notification.updateMany(query, { isRead: true });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
