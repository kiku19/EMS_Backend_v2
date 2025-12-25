import express from 'express';
import cors from 'cors';
import { connectDB, Staff, Student, Class, Attendance, getNextStaffCode, Timetable } from './database.js';

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
    const staff = await Staff.find().sort({ createdAt: 1 });
    const formatted = await Promise.all(staff.map(async s => {
      const assignedClass = await Class.findOne({ classTeacherId: s._id });
      return {
        id: s._id, code: s.code, name: s.name, role: s.role, department: s.department,
        status: s.status, phone: s.phone, email: s.email, joinDate: s.joinDate, address: s.address,
        username: s.username,
        password: s.password, // Include password for admin to view
        assignedClass: assignedClass ? `${assignedClass.name} ${assignedClass.section}` : null,
        assignedClassId: assignedClass?._id,
      };
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/staff/:id', async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id);
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
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/staff', async (req, res) => {
  try {
    const { name, role, department, status, phone, email, joinDate, address, assignedClassId } = req.body;
    const code = await getNextStaffCode();
    
    // Auto-generate username from email or code
    const username = email ? email.split('@')[0].toLowerCase() : code.toLowerCase();
    // Auto-generate random password
    const password = generatePassword(8);
    
    const staff = new Staff({
      code, name, role, department, status: status || 'active',
      phone, email, joinDate, address, username, password,
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
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/staff/:id', async (req, res) => {
  try {
    const { name, role, department, status, phone, email, joinDate, address, assignedClassId, username, password } = req.body;
    
    // Build update object - only include password if provided
    const updateData = { name, role, department, status, phone, email, joinDate, address };
    if (username) updateData.username = username;
    if (password) updateData.password = password;
    
    const staff = await Staff.findByIdAndUpdate(req.params.id, updateData, { new: true });
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
