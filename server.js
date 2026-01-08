import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import mongoose from './database.js';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { connectDB, Staff, Student, Class, Attendance, getNextStaffCode, Timetable, IntakeForm, FormAssignment, FormSubmission, Notification, Visitor, Admission, GatePass, Appointment, Feedback, CallLog, FeeStructure, FeePayment, FeeRefund, Substitution, getNextReceiptNumber, getNextRefundNumber, AdmissionFormConfig, AdmissionIdConfig, RollNumberConfig, DocumentConfig, getNextAdmissionId, getNextRollNumber, SchoolSettings, FeeTemplate, StaffAttendance } from './database.js';
import messageRoutes from './routes/messages.js';
import feeHeadsRoutes from './routes/feeHeads.js';
import studentFeesRoutes from './routes/studentFees.js';
import feeSettingsRoutes from './routes/feeSettings.js';
import { initializeChatHandlers } from './socket/chatHandler.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Create HTTP server and wrap Express app
const httpServer = createServer(app);

// Initialize Socket.IO with CORS
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
      'https://school-dashboard-ivory.vercel.app'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  },
  transports: ['websocket', 'polling']
});

console.log('✅ Socket.IO initialized');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Configure CORS to allow requests from Vercel frontend
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'https://school-dashboard-ivory.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Increase body size limit to handle large file uploads (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

await connectDB();

// Initialize Socket.IO chat handlers
initializeChatHandlers(io);
console.log('✅ Chat handlers initialized');

// Mount message routes
app.use('/api/messages', messageRoutes);
console.log('✅ Message routes mounted');

// Mount fee management routes
app.use('/api/fee-heads', feeHeadsRoutes);
app.use('/api/student-fees', studentFeesRoutes);
app.use('/api/fee-settings', feeSettingsRoutes);
console.log('✅ Fee management routes mounted');

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
    const { phone, email, password } = req.body;
    
    // Allow login with either phone or email
    let query = { password, status: 'active' };
    if (phone) {
      query.phone = phone;
    } else if (email) {
      query.email = email;
    } else {
      return res.status(400).json({ error: 'Phone or email is required' });
    }
    
    const staff = await Staff.findOne(query);
    if (!staff) return res.status(401).json({ error: 'Invalid credentials' });

    // Get classes where this staff is class teacher
    const classes = await Class.find({ classTeacherId: staff._id });

    res.json({
      id: staff._id,
      code: staff.code,
      name: staff.name,
      role: staff.role,
      email: staff.email,
      phone: staff.phone,
      classes: classes.map(c => ({ id: c._id, name: c.name, section: c.section })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ UPLOAD ROUTE ============
app.post('/api/upload', upload.single('file'), async (req, res) => {
  console.log('📤 Upload request received');
  try {
    if (!req.file) {
      console.log('❌ No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📄 File received:', req.file.originalname, 'Size:', req.file.size, 'bytes', 'Type:', req.file.mimetype);

    // Check file size
    if (req.file.size > 10 * 1024 * 1024) {
      console.log('❌ File too large:', req.file.size);
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }

    // Convert buffer to Base64
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    let dataURI = "data:" + req.file.mimetype + ";base64," + b64;

    // Try Cloudinary upload, fallback to base64 if it fails
    try {
      console.log('☁️ Attempting Cloudinary upload...');
      
      // Determine resource type based on mime type
      let resourceType = 'auto';
      if (req.file.mimetype === 'application/pdf') {
        resourceType = 'raw'; // PDFs use 'raw' type
      } else if (req.file.mimetype.startsWith('image/')) {
        resourceType = 'image';
      } else if (req.file.mimetype.startsWith('video/')) {
        resourceType = 'video';
      } else {
        resourceType = 'raw'; // Default to raw for other documents
      }
      
      console.log('📄 File type:', req.file.mimetype, '→ Resource type:', resourceType);
      
      const uploadOptions = {
        resource_type: resourceType,
        folder: 'school_documents',
        public_id: `doc_${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9]/g, '_')}`,
        timeout: 60000, // 60 second timeout
        type: 'upload', // Ensure it's a regular upload, not authenticated
        access_mode: 'public' // Make sure the file is publicly accessible
      };
      
      const result = await cloudinary.uploader.upload(dataURI, uploadOptions);

      console.log('✅ Cloudinary upload successful:', result.secure_url);
      
      // Use URL as-is - simple and works
      let finalUrl = result.secure_url;
      
      console.log('✅ Final URL:', finalUrl);
      
      res.json({
        url: finalUrl,
        public_id: result.public_id,
        name: req.file.originalname,
        size: (result.bytes / 1024).toFixed(1) + ' KB',
        format: result.format,
        resource_type: result.resource_type
      });
    } catch (cloudinaryError) {
      console.warn('⚠️ Cloudinary upload failed, using base64 fallback:', cloudinaryError.message);
      console.error('Cloudinary error details:', cloudinaryError);
      
      // Fallback: return base64 data URI
      res.json({
        url: dataURI,
        public_id: `local_${Date.now()}`,
        name: req.file.originalname,
        size: (req.file.size / 1024).toFixed(1) + ' KB',
        format: req.file.mimetype
      });
    }

  } catch (error) {
    console.error('❌ Upload Error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Upload failed: ' + (error.message || 'Unknown error'),
      details: error.message
    });
  }
});

// ============ DOCUMENT MANAGEMENT ROUTES ============
// Add document to student
app.post('/api/students/:id/documents', async (req, res) => {
  try {
    console.log('📄 Adding document to student:', req.params.id);
    console.log('📄 Document data:', JSON.stringify(req.body, null, 2));
    
    const { name, type, url, uploadDate } = req.body;
    
    const newDoc = {
      id: new mongoose.Types.ObjectId().toString(), // Generate unique ID
      name,
      type,
      url,
      uploadDate: uploadDate || new Date().toISOString(),
      size: req.body.size || 'Unknown',
      date: new Date().toLocaleDateString()
    };
    
    // Use direct MongoDB update to bypass Mongoose schema caching issues
    const result = await Student.collection.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(req.params.id) },
      { $push: { documents: newDoc } },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    console.log('✅ Document added successfully');
    console.log('✅ Total documents now:', result.documents?.length || 0);
    console.log('✅ New document:', newDoc);
    
    res.json({ 
      success: true, 
      documents: result.documents || []
    });
  } catch (error) {
    console.error('❌ Error adding document:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete document from student
app.delete('/api/students/:id/documents/:docIndex', async (req, res) => {
  try {
    console.log('🗑️ DELETE request - Student ID:', req.params.id, 'Doc Index:', req.params.docIndex);
    
    // Use direct MongoDB query to avoid Mongoose caching issues
    const student = await Student.collection.findOne({ _id: new mongoose.Types.ObjectId(req.params.id) });
    
    if (!student) {
      console.log('❌ Student not found');
      return res.status(404).json({ error: 'Student not found' });
    }
    
    console.log('📄 Student found, documents array:', student.documents);
    console.log('📄 Documents count:', student.documents?.length || 0);
    
    const docIndex = parseInt(req.params.docIndex);
    console.log('📄 Parsed docIndex:', docIndex);
    console.log('📄 Document at index:', student.documents?.[docIndex]);
    
    if (student.documents && student.documents[docIndex]) {
      const deletedDoc = student.documents[docIndex];
      console.log('✅ Deleting document:', deletedDoc.name || deletedDoc);
      
      // Remove the document at the specified index
      student.documents.splice(docIndex, 1);
      
      // Update using direct MongoDB
      const result = await Student.collection.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(req.params.id) },
        { $set: { documents: student.documents } },
        { returnDocument: 'after' }
      );
      
      console.log('✅ Document deleted, remaining:', result.documents?.length || 0);
      res.json({ success: true, documents: result.documents || [] });
    } else {
      console.log('❌ Document not found at index', docIndex);
      console.log('❌ Available indices: 0 to', (student.documents?.length || 0) - 1);
      res.status(404).json({ error: 'Document not found' });
    }
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update student photo
app.put('/api/students/:id/photo', async (req, res) => {
  try {
    console.log('📸 Updating photo for student:', req.params.id);
    console.log('📸 Photo URL:', req.body.photo);
    
    const { photo } = req.body;
    
    // Use direct MongoDB update
    const result = await Student.collection.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(req.params.id) },
      { $set: { photo } },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    console.log('✅ Photo updated successfully');
    
    res.json({ 
      success: true, 
      photo: result.photo 
    });
  } catch (error) {
    console.error('❌ Error updating photo:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fix corrupted documents field (migration endpoint)
app.post('/api/students/:id/fix-documents', async (req, res) => {
  try {
    console.log('🔧 Fixing documents field for student:', req.params.id);
    
    // Get the student
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Fix documents: add IDs to documents that don't have them, remove corrupted ones
    const fixedDocuments = (student.documents || [])
      .filter(doc => doc.url && doc.name) // Remove corrupted documents
      .map(doc => ({
        ...doc,
        id: doc.id || new mongoose.Types.ObjectId().toString(), // Add ID if missing
        date: doc.date || new Date(doc.uploadDate || Date.now()).toLocaleDateString(),
        size: doc.size || 'Unknown'
      }));
    
    // Update using direct MongoDB
    const result = await Student.collection.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(req.params.id) },
      { $set: { documents: fixedDocuments } },
      { returnDocument: 'after' }
    );
    
    console.log('✅ Documents field fixed:', fixedDocuments.length, 'valid documents');
    res.json({ 
      success: true, 
      message: 'Documents field fixed',
      documents: result.documents || []
    });
  } catch (error) {
    console.error('❌ Error fixing documents:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ STAFF ROUTES ============
app.get('/api/staff', async (req, res) => {
  try {
    const staff = await Staff.find().populate('reporterId', 'name').sort({ createdAt: 1 });
    const formatted = await Promise.all(staff.map(async s => {
      const assignedClass = await Class.findOne({ classTeacherId: s._id });
      return {
        // Basic Info
        id: s._id,
        code: s.code,
        name: s.name,
        role: s.role,
        department: s.department,
        status: s.status,
        phone: s.phone,
        email: s.email,
        joinDate: s.joinDate,
        address: s.address,
        username: s.username,
        password: s.password,
        
        // Personal Details
        dob: s.dob,
        dateOfBirth: s.dob, // Alias for compatibility
        gender: s.gender,
        fatherName: s.fatherName,
        bloodGroup: s.bloodGroup,
        maritalStatus: s.maritalStatus,
        employmentType: s.employmentType,
        nationality: 'Indian', // Default
        
        // Contact
        emergencyContact: s.emergencyContact,
        emergencyPhone: s.emergencyPhone,
        whatsappNumber: s.whatsappNumber,
        
        // Documents
        picture: s.picture,
        idDocuments: s.idDocuments,
        
        // Qualifications
        professionalQualifications: s.professionalQualifications,
        qualification: s.professionalQualifications?.map(q => q.name).join(', ') || '', // Formatted string
        totalExperience: s.totalExperience,
        experience: parseInt(s.totalExperience) || 0, // Numeric value
        previousOrganization: s.previousOrganization,
        qualificationDocs: s.qualificationDocs,
        
        // Staff Info
        staffNumber: s.staffNumber,
        staffType: s.staffType,
        designation: s.role, // Use role as designation
        expertise: s.expertise,
        assignedClasses: s.assignedClasses,
        isClassTeacher: s.isClassTeacher,
        classTeacherOf: s.classTeacherOf,
        classes: s.assignedClasses, // Alias
        shift: 'Morning', // Default
        
        // Bank & Salary
        accountNumber: s.accountNumber,
        accountHolder: s.name, // Use name as account holder
        ifscCode: s.ifscCode,
        bankName: s.bankName,
        branchName: s.branchName,
        panNumber: s.accountNumber ? 'ABCDE1234F' : '', // Mock PAN
        salaryTemplate: s.salaryTemplate,
        salaryBreakdown: s.salaryBreakdown,
        
        // Class Assignment
        assignedClass: assignedClass ? `${assignedClass.name} ${assignedClass.section}` : null,
        assignedClassId: assignedClass?._id,
        
        // Hierarchy
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
      // Basic Info
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
      password: staff.password,
      
      // Personal Details
      dob: staff.dob,
      dateOfBirth: staff.dob, // Alias for compatibility
      gender: staff.gender,
      fatherName: staff.fatherName,
      bloodGroup: staff.bloodGroup,
      maritalStatus: staff.maritalStatus,
      employmentType: staff.employmentType,
      nationality: 'Indian', // Default
      
      // Contact
      emergencyContact: staff.emergencyContact,
      emergencyPhone: staff.emergencyPhone,
      whatsappNumber: staff.whatsappNumber,
      
      // Documents
      picture: staff.picture,
      idDocuments: staff.idDocuments,
      
      // Qualifications
      professionalQualifications: staff.professionalQualifications,
      qualification: staff.professionalQualifications?.map(q => q.name).join(', ') || '', // Formatted string
      totalExperience: staff.totalExperience,
      experience: parseInt(staff.totalExperience) || 0, // Numeric value
      previousOrganization: staff.previousOrganization,
      qualificationDocs: staff.qualificationDocs,
      
      // Staff Info
      staffNumber: staff.staffNumber,
      staffType: staff.staffType,
      designation: staff.role, // Use role as designation
      expertise: staff.expertise,
      assignedClasses: staff.assignedClasses,
      isClassTeacher: staff.isClassTeacher,
      classTeacherOf: staff.classTeacherOf,
      classes: staff.assignedClasses, // Alias
      shift: 'Morning', // Default
      
      // Bank & Salary
      accountNumber: staff.accountNumber,
      accountHolder: staff.name, // Use name as account holder
      ifscCode: staff.ifscCode,
      bankName: staff.bankName,
      branchName: staff.branchName,
      panNumber: staff.accountNumber ? 'ABCDE1234F' : '', // Mock PAN
      salaryTemplate: staff.salaryTemplate,
      salaryBreakdown: staff.salaryBreakdown,
      
      // Class Assignment
      assignedClass: assignedClass ? `${assignedClass.name} ${assignedClass.section}` : null,
      assignedClassId: assignedClass?._id,
      
      // Hierarchy
      reporterId: staff.reporterId?._id,
      reporterName: staff.reporterId?.name,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/staff', async (req, res) => {
  try {
    const {
      name, role, department, status, phone, email, joinDate, address, assignedClassId, reporterId,
      // Personal Details
      dob, gender, fatherName, bloodGroup, maritalStatus, employmentType,
      emergencyContact, emergencyPhone, whatsappNumber,
      // Documents
      picture, idDocuments,
      // Qualifications
      professionalQualifications, totalExperience, previousOrganization, qualificationDocs,
      // Staff Info
      staffNumber, staffType, expertise, assignedClasses, isClassTeacher, classTeacherOf,
      // Bank & Salary
      accountNumber, ifscCode, bankName, branchName, salaryTemplate, salaryBreakdown
    } = req.body;
    
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
      code, name, role: role || staffType, department: department || expertise, 
      status: status || 'active',
      phone, email, joinDate, address, username, password,
      reporterId: reporterId || null,
      // Personal Details
      dob, gender, fatherName, bloodGroup, maritalStatus, employmentType,
      emergencyContact, emergencyPhone, whatsappNumber,
      // Documents
      picture, idDocuments,
      // Qualifications
      professionalQualifications, totalExperience, previousOrganization, qualificationDocs,
      // Staff Info
      staffNumber, staffType, expertise, assignedClasses, isClassTeacher, classTeacherOf,
      // Bank & Salary
      accountNumber, ifscCode, bankName, branchName, salaryTemplate, salaryBreakdown
    });
    await staff.save();

    // If class teacher, assign to class
    if ((role === 'Teacher' || staffType === 'Teaching') && assignedClassId) {
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
      // Return all the new fields
      dob, gender, fatherName, bloodGroup, maritalStatus, employmentType,
      emergencyContact, emergencyPhone, whatsappNumber,
      picture, idDocuments,
      professionalQualifications, totalExperience, previousOrganization, qualificationDocs,
      staffNumber, staffType, expertise, assignedClasses, isClassTeacher, classTeacherOf,
      accountNumber, ifscCode, bankName, branchName, salaryTemplate, salaryBreakdown
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


// ============ STAFF ID CONFIGURATION ROUTES ============
app.get('/api/staff-id-config', async (req, res) => {
  try {
    const StaffIdConfig = mongoose.model('StaffIdConfig');
    let config = await StaffIdConfig.findOne();
    
    // Create default config if doesn't exist
    if (!config) {
      config = new StaffIdConfig({
        prefix: 'EMP',
        separator: '',
        includeYear: false,
        startingNumber: 1,
        digits: 3,
        currentNumber: 0
      });
      await config.save();
    }
    
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/staff-id-config', async (req, res) => {
  try {
    const { prefix, separator, includeYear, startingNumber, digits } = req.body;
    const StaffIdConfig = mongoose.model('StaffIdConfig');
    
    let config = await StaffIdConfig.findOne();
    
    if (!config) {
      config = new StaffIdConfig({
        prefix,
        separator,
        includeYear,
        startingNumber,
        digits,
        currentNumber: 0
      });
    } else {
      config.prefix = prefix;
      config.separator = separator;
      config.includeYear = includeYear;
      config.startingNumber = startingNumber;
      config.digits = digits;
    }
    
    await config.save();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============ STAFF ATTENDANCE ROUTES ============
// Get all attendance for a staff member
app.get('/api/staff-attendance/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;
    const attendance = await StaffAttendance.find({ staffId }).sort({ date: -1 });
    
    // Convert to object format { date: { status, inTime, outTime, reason } }
    const attendanceObj = {};
    attendance.forEach(att => {
      attendanceObj[att.date] = {
        status: att.status,
        inTime: att.inTime,
        outTime: att.outTime,
        reason: att.reason
      };
    });
    
    res.json(attendanceObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all staff attendance for a specific date
app.get('/api/staff-attendance/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const attendance = await StaffAttendance.find({ date });
    
    // Convert to object format { staffId: { status, inTime, outTime, reason } }
    const attendanceObj = {};
    attendance.forEach(att => {
      attendanceObj[att.staffId.toString()] = {
        status: att.status,
        inTime: att.inTime,
        outTime: att.outTime,
        reason: att.reason
      };
    });
    
    res.json(attendanceObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark/Update staff attendance
app.post('/api/staff-attendance', async (req, res) => {
  try {
    const { staffId, date, status, inTime, outTime, reason } = req.body;
    
    // Upsert (update if exists, create if not)
    const attendance = await StaffAttendance.findOneAndUpdate(
      { staffId, date },
      { status, inTime, outTime, reason },
      { new: true, upsert: true }
    );
    
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get attendance for all staff (for loading initial data)
app.get('/api/staff-attendance', async (req, res) => {
  try {
    const attendance = await StaffAttendance.find().sort({ date: -1 });
    
    // Convert to nested object format { staffId: { date: { status, inTime, outTime, reason } } }
    const attendanceObj = {};
    attendance.forEach(att => {
      const staffIdStr = att.staffId.toString();
      if (!attendanceObj[staffIdStr]) {
        attendanceObj[staffIdStr] = {};
      }
      attendanceObj[staffIdStr][att.date] = {
        status: att.status,
        inTime: att.inTime,
        outTime: att.outTime,
        reason: att.reason
      };
    });
    
    res.json(attendanceObj);
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

// Generate next admission ID (MUST be before /:id route)
app.get('/api/students/next-admission-id', async (req, res) => {
  try {
    console.log('🔄 Generating next admission ID...');
    const admissionId = await getNextAdmissionId();
    console.log('✅ Generated admission ID:', admissionId);
    res.json({ admissionId });
  } catch (err) {
    console.error('❌ Error generating admission ID:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/:id', async (req, res) => {
  try {
    console.log('📖 GET /api/students/:id -', req.params.id);
    
    // Use direct MongoDB query to bypass Mongoose schema issues
    const student = await Student.collection.findOne({ 
      _id: new mongoose.Types.ObjectId(req.params.id) 
    });
    
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    // Get class info if classId exists
    let classInfo = null;
    let className = null;
    if (student.classId) {
      const classDoc = await Class.findById(student.classId);
      if (classDoc) {
        classInfo = `${classDoc.name.replace('Class ', '')}-${classDoc.section}`;
        className = `${classDoc.name} ${classDoc.section}`;
      }
    }
    
    console.log('📖 Student documents:', student.documents);
    console.log('📸 Student photo:', student.photo);
    
    res.json({
      id: student._id,
      ...student,
      class: classInfo,
      className: className,
    });
  } catch (err) {
    console.error('❌ Error fetching student:', err);
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

    // Remove undefined values and empty objects to prevent MongoDB cast errors
    Object.keys(studentData).forEach(key => {
      if (studentData[key] === undefined) {
        delete studentData[key];
      }
      // Remove empty objects (like photo: {})
      if (typeof studentData[key] === 'object' && 
          studentData[key] !== null && 
          !Array.isArray(studentData[key]) && 
          Object.keys(studentData[key]).length === 0) {
        delete studentData[key];
      }
    });

    console.log('📝 Student data after cleanup:', JSON.stringify(studentData, null, 2));

    const student = new Student(studentData);
    await student.save();
    res.status(201).json({ id: student._id, ...student.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/students/:id', async (req, res) => {
  try {
    console.log('📝 PUT /api/students/:id - Request body:', JSON.stringify(req.body, null, 2));
    console.log('📝 Documents field type:', typeof req.body.documents);
    console.log('📝 Documents field is array:', Array.isArray(req.body.documents));
    
    if (req.body.documents) {
      console.log('📝 Documents field value:', JSON.stringify(req.body.documents, null, 2));
    }
    
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

      // Documents - ensure it's an array
      documents: Array.isArray(req.body.documents) ? req.body.documents : undefined
    };

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
      // Also remove empty objects (like photo: {})
      if (typeof updateData[key] === 'object' && updateData[key] !== null && !Array.isArray(updateData[key]) && Object.keys(updateData[key]).length === 0) {
        delete updateData[key];
      }
    });

    console.log('📝 Update data after cleanup:', JSON.stringify(updateData, null, 2));
    console.log('📸 Photo URL being saved:', updateData.photo);

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: false }
    );

    if (!student) return res.status(404).json({ error: 'Student not found' });
    console.log('✅ Student updated successfully');
    console.log('📸 Photo in updated student:', student.photo);
    res.json({ id: student._id, ...student.toObject() });
  } catch (err) {
    console.error('❌ Error updating student:', err);
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

// ============ SUBSTITUTION ROUTES ============
// Get substitutions for a date
app.get('/api/substitutions', async (req, res) => {
  try {
    const { date, classId, teacherId } = req.query;
    const filter = {};

    if (date) filter.date = date;
    if (classId) filter.classId = classId;
    if (teacherId) {
      filter.$or = [
        { absentTeacherId: teacherId },
        { substituteTeacherId: teacherId }
      ];
    }

    const substitutions = await Substitution.find(filter)
      .populate('classId', 'name section')
      .populate('absentTeacherId', 'name department')
      .populate('substituteTeacherId', 'name department')
      .sort({ date: -1, period: 1 });

    res.json(substitutions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create substitution
app.post('/api/substitutions', async (req, res) => {
  try {
    const {
      date,
      classId,
      period,
      absentTeacherId,
      substituteTeacherId,
      reason,
      type,
      notes
    } = req.body;

    // Check if substitution already exists for this class and period
    const existing = await Substitution.findOne({ date, classId, period });
    if (existing) {
      return res.status(400).json({
        message: 'Substitution already exists for this class and period'
      });
    }

    const substitution = new Substitution({
      date,
      classId,
      period,
      absentTeacherId,
      substituteTeacherId,
      reason,
      type: type || 'manual',
      notes
    });

    await substitution.save();

    const populated = await Substitution.findById(substitution._id)
      .populate('classId', 'name section')
      .populate('absentTeacherId', 'name department')
      .populate('substituteTeacherId', 'name department');

    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update substitution
app.put('/api/substitutions/:id', async (req, res) => {
  try {
    const { substituteTeacherId, reason, status, notes } = req.body;

    const substitution = await Substitution.findByIdAndUpdate(
      req.params.id,
      { substituteTeacherId, reason, status, notes },
      { new: true, runValidators: true }
    )
      .populate('classId', 'name section')
      .populate('absentTeacherId', 'name department')
      .populate('substituteTeacherId', 'name department');

    if (!substitution) {
      return res.status(404).json({ message: 'Substitution not found' });
    }

    res.json(substitution);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete substitution
app.delete('/api/substitutions/:id', async (req, res) => {
  try {
    const result = await Substitution.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ message: 'Substitution not found' });
    }
    res.json({ message: 'Substitution deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ FEE MANAGEMENT ROUTES ============

// Get all payments with student details
app.get('/api/fees/payments', async (req, res) => {
  try {
    const { studentId, classId, academicYear, startDate, endDate } = req.query;
    const query = {};

    if (studentId) query.studentId = studentId;
    if (classId) query.classId = classId;
    if (academicYear) query.academicYear = academicYear;
    if (startDate && endDate) {
      query.paymentDate = { $gte: startDate, $lte: endDate };
    }

    const payments = await FeePayment.find(query)
      .populate('studentId', 'name rollNo admissionId')
      .populate('classId', 'name section')
      .populate('collectedBy', 'name')
      .sort({ paymentDate: -1, createdAt: -1 });

    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get payment by ID
app.get('/api/fees/payments/:id', async (req, res) => {
  try {
    const payment = await FeePayment.findById(req.params.id)
      .populate('studentId', 'name rollNo admissionId parentName parentPhone')
      .populate('classId', 'name section')
      .populate('collectedBy', 'name');

    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    res.json(payment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new payment
app.post('/api/fees/payments', async (req, res) => {
  try {
    const {
      studentId,
      classId,
      academicYear,
      paymentDate,
      amount,
      paymentMode,
      feeHeads,
      transactionId,
      chequeNumber,
      bankName,
      lateFee,
      discount,
      collectedBy,
      remarks
    } = req.body;

    // Generate receipt number
    const receiptNumber = await getNextReceiptNumber();

    const payment = new FeePayment({
      studentId,
      classId,
      academicYear: academicYear || '2024-25',
      receiptNumber,
      paymentDate,
      amount,
      paymentMode,
      feeHeads,
      transactionId,
      chequeNumber,
      bankName,
      lateFee: lateFee || 0,
      discount: discount || 0,
      status: 'completed',
      collectedBy,
      remarks
    });

    await payment.save();

    // Get StudentFeeStructure to check actual balance
    const StudentFeeStructure = mongoose.model('StudentFeeStructure');
    const feeStructure = await StudentFeeStructure.findOne({
      studentId,
      academicYear: academicYear || '2024-25'
    });

    // Update student fee status based on actual fee structure
    if (feeStructure) {
      const feeStatus = feeStructure.totalBalance <= 0 ? 'paid' : 'pending';
      await Student.findByIdAndUpdate(studentId, { feeStatus });
      console.log(`Payment created: ${receiptNumber}, Balance: ${feeStructure.totalBalance}, Status: ${feeStatus}`);
    } else {
      // Fallback to old calculation if no fee structure exists
      const allPayments = await FeePayment.find({
        studentId,
        academicYear: academicYear || '2024-25',
        status: 'completed'
      });
      const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);
      await Student.findByIdAndUpdate(studentId, {
        feeStatus: totalPaid > 0 ? 'paid' : 'pending'
      });
      console.log(`Payment created: ${receiptNumber}, Total paid: ${totalPaid}`);
    }

    const populatedPayment = await FeePayment.findById(payment._id)
      .populate('studentId', 'name rollNo')
      .populate('classId', 'name section')
      .populate('collectedBy', 'name');

    res.status(201).json(populatedPayment);
  } catch (err) {
    console.error('Error creating payment:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update payment
app.put('/api/fees/payments/:id', async (req, res) => {
  try {
    const payment = await FeePayment.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    )
      .populate('studentId', 'name rollNo')
      .populate('classId', 'name section')
      .populate('collectedBy', 'name');

    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    res.json(payment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete payment
app.delete('/api/fees/payments/:id', async (req, res) => {
  try {
    const result = await FeePayment.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Payment not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get fee defaulters
app.get('/api/fees/defaulters', async (req, res) => {
  try {
    const { classId, academicYear } = req.query;

    // Get all active students (not just those with pending status)
    const query = { status: 'active' };
    if (classId) query.classId = classId;
    if (academicYear) query.academicYear = academicYear;

    const students = await Student.find(query)
      .populate('classId', 'name section')
      .sort({ classId: 1, rollNo: 1 });

    console.log(`Found ${students.length} active students for defaulters check`);

    // For each student, calculate pending amount and days overdue
    const defaulters = await Promise.all(students.map(async (student) => {
      // Get total payments made
      const payments = await FeePayment.find({
        studentId: student._id,
        academicYear: academicYear || '2024-25',
        status: 'completed'
      }).sort({ paymentDate: -1 });

      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

      // Get fee structure for the class (simplified - using fixed amount)
      // In production, fetch from FeeStructure collection
      const totalAnnualFee = 60000; // Example: 5000/month * 12 months
      const pendingAmount = totalAnnualFee - totalPaid;

      // Calculate days overdue (simplified - assuming due date is 5th of each month)
      const today = new Date();
      const currentMonth = today.getMonth();
      const dueDate = new Date(today.getFullYear(), currentMonth, 5);
      const daysOverdue = Math.max(0, Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)));

      return {
        id: student._id,
        student: student.name,
        admissionId: student.admissionId,
        rollNo: student.rollNo,
        class: student.classId ? `${student.classId.name.replace('Class ', '')} ${student.classId.section}` : '',
        classId: student.classId?._id,
        phone: student.parentPhone,
        email: student.parentEmail,
        pending: pendingAmount > 0 ? pendingAmount : 0,
        paid: totalPaid,
        dueDate: dueDate.toISOString().split('T')[0],
        days: daysOverdue,
        lastPayment: payments.length > 0 ? payments[0].paymentDate : null
      };
    }));

    // Filter out students with no pending amount
    const actualDefaulters = defaulters.filter(d => d.pending > 0);

    console.log(`Returning ${actualDefaulters.length} defaulters`);
    res.json(actualDefaulters);
  } catch (err) {
    console.error('Error fetching defaulters:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get student payment summary
app.get('/api/fees/students/:studentId/summary', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { academicYear } = req.query;

    const student = await Student.findById(studentId).populate('classId', 'name section');
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Get all payments
    const payments = await FeePayment.find({
      studentId,
      academicYear: academicYear || '2024-25'
    }).sort({ paymentDate: -1 });

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    // Get fee structure (simplified)
    const totalAnnualFee = 60000;
    const pending = totalAnnualFee - totalPaid;

    res.json({
      student: {
        id: student._id,
        name: student.name,
        admissionId: student.admissionId,
        class: student.classId ? `${student.classId.name} ${student.classId.section}` : '',
        parentName: student.parentName,
        parentPhone: student.parentPhone
      },
      summary: {
        totalAnnualFee,
        totalPaid,
        pending: pending > 0 ? pending : 0,
        status: pending > 0 ? 'pending' : 'paid'
      },
      payments
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ REFUND ROUTES ============

// Get all refunds
app.get('/api/fees/refunds', async (req, res) => {
  try {
    const { studentId, status, academicYear } = req.query;
    const query = {};

    if (studentId) query.studentId = studentId;
    if (status) query.status = status;
    if (academicYear) query.academicYear = academicYear;

    const refunds = await FeeRefund.find(query)
      .populate('studentId', 'name rollNo admissionId')
      .populate('classId', 'name section')
      .populate('requestedBy', 'name')
      .populate('approvedBy', 'name')
      .populate('processedBy', 'name')
      .sort({ createdAt: -1 });

    res.json(refunds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get refund by ID
app.get('/api/fees/refunds/:id', async (req, res) => {
  try {
    const refund = await FeeRefund.findById(req.params.id)
      .populate('studentId', 'name rollNo admissionId parentName parentPhone')
      .populate('classId', 'name section')
      .populate('originalPaymentId')
      .populate('requestedBy', 'name')
      .populate('approvedBy', 'name')
      .populate('processedBy', 'name');

    if (!refund) return res.status(404).json({ error: 'Refund not found' });

    res.json(refund);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new refund request
app.post('/api/fees/refunds', async (req, res) => {
  try {
    const {
      studentId,
      classId,
      academicYear,
      refundDate,
      amount,
      reason,
      originalPaymentId,
      refundMode,
      transactionId,
      chequeNumber,
      bankName,
      accountNumber,
      requestedBy,
      remarks
    } = req.body;

    // Generate refund number
    const refundNumber = await getNextRefundNumber();

    const refund = new FeeRefund({
      studentId,
      classId,
      academicYear: academicYear || '2024-25',
      refundNumber,
      refundDate,
      amount,
      reason,
      originalPaymentId,
      refundMode,
      transactionId,
      chequeNumber,
      bankName,
      accountNumber,
      requestedBy,
      status: 'pending',
      remarks
    });

    await refund.save();

    const populatedRefund = await FeeRefund.findById(refund._id)
      .populate('studentId', 'name rollNo')
      .populate('classId', 'name section')
      .populate('requestedBy', 'name');

    res.status(201).json(populatedRefund);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve refund
app.put('/api/fees/refunds/:id/approve', async (req, res) => {
  try {
    const { approvedBy, remarks } = req.body;

    const refund = await FeeRefund.findByIdAndUpdate(
      req.params.id,
      {
        status: 'approved',
        approvedBy,
        approvedAt: new Date(),
        remarks: remarks || refund.remarks
      },
      { new: true }
    )
      .populate('studentId', 'name rollNo')
      .populate('classId', 'name section')
      .populate('approvedBy', 'name');

    if (!refund) return res.status(404).json({ error: 'Refund not found' });

    res.json(refund);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Process refund (mark as completed)
app.put('/api/fees/refunds/:id/process', async (req, res) => {
  try {
    const { processedBy, transactionId, remarks } = req.body;

    const refund = await FeeRefund.findByIdAndUpdate(
      req.params.id,
      {
        status: 'processed',
        processedBy,
        processedAt: new Date(),
        transactionId: transactionId || refund.transactionId,
        remarks: remarks || refund.remarks
      },
      { new: true }
    )
      .populate('studentId', 'name rollNo')
      .populate('classId', 'name section')
      .populate('processedBy', 'name');

    if (!refund) return res.status(404).json({ error: 'Refund not found' });

    res.json(refund);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reject refund
app.put('/api/fees/refunds/:id/reject', async (req, res) => {
  try {
    const { approvedBy, rejectionReason } = req.body;

    const refund = await FeeRefund.findByIdAndUpdate(
      req.params.id,
      {
        status: 'rejected',
        approvedBy,
        approvedAt: new Date(),
        rejectionReason
      },
      { new: true }
    )
      .populate('studentId', 'name rollNo')
      .populate('classId', 'name section')
      .populate('approvedBy', 'name');

    if (!refund) return res.status(404).json({ error: 'Refund not found' });

    res.json(refund);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update refund
app.put('/api/fees/refunds/:id', async (req, res) => {
  try {
    const refund = await FeeRefund.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    )
      .populate('studentId', 'name rollNo')
      .populate('classId', 'name section');

    if (!refund) return res.status(404).json({ error: 'Refund not found' });

    res.json(refund);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete refund
app.delete('/api/fees/refunds/:id', async (req, res) => {
  try {
    const result = await FeeRefund.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Refund not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ FEE STRUCTURE ROUTES ============

// Get fee structure for a class
app.get('/api/fees/structure/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear } = req.query;

    const structure = await FeeStructure.findOne({
      classId,
      academicYear: academicYear || '2024-25'
    }).populate('classId', 'name section');

    if (!structure) {
      // Return default structure if not found
      return res.json({
        classId,
        academicYear: academicYear || '2024-25',
        feeHeads: [
          { name: 'Tuition Fee', amount: 5000, frequency: 'monthly', mandatory: true },
          { name: 'Transport Fee', amount: 2000, frequency: 'monthly', mandatory: false },
          { name: 'Library Fee', amount: 500, frequency: 'annual', mandatory: true },
        ],
        totalAnnualFee: 60000
      });
    }

    res.json(structure);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create or update fee structure
app.post('/api/fees/structure', async (req, res) => {
  try {
    const { classId, academicYear, feeHeads, totalAnnualFee } = req.body;

    const structure = await FeeStructure.findOneAndUpdate(
      { classId, academicYear: academicYear || '2024-25' },
      { classId, academicYear: academicYear || '2024-25', feeHeads, totalAnnualFee },
      { upsert: true, new: true }
    ).populate('classId', 'name section');

    res.json(structure);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: 'mongodb', timestamp: new Date().toISOString() });
});

// ============ ADMISSION CONFIGURATION ROUTES ============

// Get admission form field configuration
app.get('/api/settings/admission-form-config', async (req, res) => {
  try {
    const { fieldType } = req.query;
    const query = fieldType ? { fieldType } : {};
    const configs = await AdmissionFormConfig.find(query).sort({ fieldOrder: 1 });
    res.json(configs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create or update field configuration
app.post('/api/settings/admission-form-config', async (req, res) => {
  try {
    const { fieldName, fieldType, isVisible, isMandatory, autoGenerate, defaultValue, fieldOrder } = req.body;

    const config = await AdmissionFormConfig.findOneAndUpdate(
      { fieldName, fieldType },
      { fieldName, fieldType, isVisible, isMandatory, autoGenerate, defaultValue, fieldOrder },
      { upsert: true, new: true }
    );

    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk update field configurations
app.put('/api/settings/admission-form-config/bulk', async (req, res) => {
  try {
    const { configs } = req.body;

    const operations = configs.map(config => ({
      updateOne: {
        filter: { fieldName: config.fieldName, fieldType: config.fieldType },
        update: config,
        upsert: true
      }
    }));

    await AdmissionFormConfig.bulkWrite(operations);

    const updated = await AdmissionFormConfig.find().sort({ fieldOrder: 1 });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete field configuration
app.delete('/api/settings/admission-form-config/:id', async (req, res) => {
  try {
    const result = await AdmissionFormConfig.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Configuration not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get admission ID configuration
app.get('/api/settings/admission-id-config', async (req, res) => {
  try {
    let config = await AdmissionIdConfig.findOne();

    // Create default if doesn't exist
    if (!config) {
      config = new AdmissionIdConfig({
        prefix: 'ADM',
        yearFormat: 'YYYY',
        separator: '-',
        numberPadding: 4,
        startingNumber: 1,
        currentNumber: 0,
        resetFrequency: 'yearly'
      });
      await config.save();
    }

    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update admission ID configuration
app.put('/api/settings/admission-id-config', async (req, res) => {
  try {
    const { prefix, yearFormat, separator, numberPadding, startingNumber, resetFrequency } = req.body;

    let config = await AdmissionIdConfig.findOne();

    if (!config) {
      config = new AdmissionIdConfig({
        prefix,
        yearFormat,
        separator,
        numberPadding,
        startingNumber,
        currentNumber: 0,
        resetFrequency
      });
    } else {
      config.prefix = prefix;
      config.yearFormat = yearFormat;
      config.separator = separator;
      config.numberPadding = numberPadding;
      config.startingNumber = startingNumber;
      config.resetFrequency = resetFrequency;
    }

    await config.save();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate preview of admission ID
app.post('/api/settings/admission-id-config/preview', async (req, res) => {
  try {
    const { prefix, yearFormat, separator, numberPadding, currentNumber } = req.body;

    const now = new Date();
    let admissionId = prefix || 'ADM';

    if (yearFormat && yearFormat !== 'none') {
      if (separator) admissionId += separator;
      admissionId += yearFormat === 'YYYY' ? now.getFullYear() : String(now.getFullYear()).slice(-2);
    }

    if (separator) admissionId += separator;
    admissionId += String(currentNumber || 1).padStart(numberPadding || 4, '0');

    res.json({ preview: admissionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ ROLL NUMBER CONFIGURATION ROUTES ============

// Get roll number configuration
app.get('/api/settings/roll-number-config', async (req, res) => {
  try {
    let config = await RollNumberConfig.findOne();
    if (!config) {
      config = new RollNumberConfig({
        format: 'sequential',
        startingNumber: 1,
        resetPerClass: true
      });
      await config.save();
    }
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update roll number configuration
app.put('/api/settings/roll-number-config', async (req, res) => {
  try {
    const { format, startingNumber, resetPerClass } = req.body;

    let config = await RollNumberConfig.findOne();
    if (!config) {
      config = new RollNumberConfig();
    }

    config.format = format;
    config.startingNumber = startingNumber;
    config.resetPerClass = resetPerClass;

    await config.save();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get next roll number for a class
app.get('/api/classes/:classId/next-roll-number', async (req, res) => {
  try {
    const { classId } = req.params;
    const nextRollNo = await getNextRollNumber(classId);
    res.json({ rollNumber: nextRollNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get document configuration
app.get('/api/settings/document-config', async (req, res) => {
  try {
    const configs = await DocumentConfig.find().sort({ displayOrder: 1 });

    // Return default if empty
    if (configs.length === 0) {
      return res.json([
        { documentName: 'Birth Certificate', isRequired: true, uploadType: 'single', allowedFormats: ['pdf', 'jpg', 'png'], maxFileSize: 5242880, displayOrder: 1, description: 'Student birth certificate' },
        { documentName: 'Transfer Certificate', isRequired: false, uploadType: 'single', allowedFormats: ['pdf', 'jpg', 'png'], maxFileSize: 5242880, displayOrder: 2, description: 'TC from previous school' },
        { documentName: 'Aadhaar Card', isRequired: false, uploadType: 'front-back', allowedFormats: ['pdf', 'jpg', 'png'], maxFileSize: 5242880, displayOrder: 3, description: 'Aadhaar card (front and back)' },
        { documentName: 'Student Photograph', isRequired: true, uploadType: 'single', allowedFormats: ['jpg', 'png'], maxFileSize: 2097152, displayOrder: 4, description: 'Passport size photo' },
        { documentName: 'Other Documents', isRequired: false, uploadType: 'multiple', allowedFormats: ['pdf', 'jpg', 'png'], maxFileSize: 5242880, displayOrder: 5, description: 'Any other relevant documents' }
      ]);
    }

    res.json(configs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create or update document configuration
app.post('/api/settings/document-config', async (req, res) => {
  try {
    const { documentName, isRequired, uploadType, allowedFormats, maxFileSize, displayOrder, description } = req.body;

    const config = new DocumentConfig({
      documentName,
      isRequired,
      uploadType,
      allowedFormats,
      maxFileSize,
      displayOrder,
      description
    });

    await config.save();
    res.status(201).json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update document configuration
app.put('/api/settings/document-config/:id', async (req, res) => {
  try {
    const config = await DocumentConfig.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!config) return res.status(404).json({ error: 'Configuration not found' });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk update document configurations
app.put('/api/settings/document-config/bulk', async (req, res) => {
  try {
    const { configs } = req.body;

    const operations = configs.map(config => ({
      updateOne: {
        filter: { _id: config.id || config._id },
        update: config,
        upsert: false
      }
    }));

    await DocumentConfig.bulkWrite(operations);

    const updated = await DocumentConfig.find().sort({ displayOrder: 1 });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete document configuration
app.delete('/api/settings/document-config/:id', async (req, res) => {
  try {
    const result = await DocumentConfig.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Configuration not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔌 Socket.IO ready for connections`);
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

// ============ FRONT DESK ROUTES ============

// Visitors
app.get('/api/front-desk/visitors', async (req, res) => {
  try {
    const { date } = req.query;
    const query = date ? { date } : {};
    const visitors = await Visitor.find(query).sort({ checkInTime: -1 });
    res.json(visitors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/front-desk/visitors/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const visitors = await Visitor.find({ date: today }).sort({ checkInTime: -1 });
    res.json(visitors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/front-desk/visitors', async (req, res) => {
  try {
    const visitor = new Visitor(req.body);
    await visitor.save();
    res.status(201).json(visitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/front-desk/visitors/:id', async (req, res) => {
  try {
    const visitor = await Visitor.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!visitor) return res.status(404).json({ error: 'Visitor not found' });
    res.json(visitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/front-desk/visitors/:id/checkout', async (req, res) => {
  try {
    const { checkOutTime } = req.body;
    const visitor = await Visitor.findByIdAndUpdate(
      req.params.id,
      { checkOutTime, status: 'checked-out' },
      { new: true }
    );
    if (!visitor) return res.status(404).json({ error: 'Visitor not found' });
    res.json(visitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/front-desk/visitors/:id', async (req, res) => {
  try {
    const result = await Visitor.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Visitor not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admissions
app.get('/api/front-desk/admissions', async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const admissions = await Admission.find(query)
      .populate('assignedTeacher', 'name')
      .populate('decisionBy', 'name')
      .sort({ createdAt: -1 });
    res.json(admissions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/front-desk/admissions/:id', async (req, res) => {
  try {
    const admission = await Admission.findById(req.params.id)
      .populate('assignedTeacher', 'name')
      .populate('decisionBy', 'name');
    if (!admission) return res.status(404).json({ error: 'Admission not found' });
    res.json(admission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/front-desk/admissions', async (req, res) => {
  try {
    const admission = new Admission(req.body);
    await admission.save();
    res.status(201).json(admission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/front-desk/admissions/:id', async (req, res) => {
  try {
    const admission = await Admission.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('assignedTeacher', 'name')
      .populate('decisionBy', 'name');
    if (!admission) return res.status(404).json({ error: 'Admission not found' });
    res.json(admission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/front-desk/admissions/:id', async (req, res) => {
  try {
    const result = await Admission.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Admission not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gate Passes
app.get('/api/front-desk/gate-passes', async (req, res) => {
  try {
    const { date } = req.query;
    const query = date ? { date } : {};
    const gatePasses = await GatePass.find(query).sort({ outTime: -1 });
    res.json(gatePasses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/front-desk/gate-passes/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const gatePasses = await GatePass.find({ date: today }).sort({ outTime: -1 });
    res.json(gatePasses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/front-desk/gate-passes', async (req, res) => {
  try {
    const gatePass = new GatePass(req.body);
    await gatePass.save();

    // If notify parent is checked and person is student, send notification
    if (req.body.notifyParent && req.body.personType === 'student') {
      const student = await Student.findById(req.body.personId);
      if (student && student.parentPhone) {
        const notification = new Notification({
          userPhone: student.parentPhone,
          notificationType: 'gate_pass',
          title: 'Gate Pass Issued',
          message: `Gate pass issued for ${req.body.personName}. Out time: ${req.body.outTime}`,
          data: { gatePassId: gatePass._id },
        });
        await notification.save();
      }
    }

    res.status(201).json(gatePass);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/front-desk/gate-passes/:id', async (req, res) => {
  try {
    const gatePass = await GatePass.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!gatePass) return res.status(404).json({ error: 'Gate pass not found' });
    res.json(gatePass);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/front-desk/gate-passes/:id', async (req, res) => {
  try {
    const result = await GatePass.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Gate pass not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Appointments
app.get('/api/front-desk/appointments', async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const appointments = await Appointment.find(query).sort({ fromDateTime: -1 });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/front-desk/appointments/:id', async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    res.json(appointment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/front-desk/appointments', async (req, res) => {
  try {
    const appointment = new Appointment(req.body);
    await appointment.save();
    res.status(201).json(appointment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/front-desk/appointments/:id', async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    res.json(appointment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/front-desk/appointments/:id', async (req, res) => {
  try {
    const result = await Appointment.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Feedbacks
app.get('/api/front-desk/feedbacks', async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const feedbacks = await Feedback.find(query)
      .populate('assignedStaff', 'name')
      .sort({ createdAt: -1 });
    res.json(feedbacks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/front-desk/feedbacks/:id', async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.id).populate('assignedStaff', 'name');
    if (!feedback) return res.status(404).json({ error: 'Feedback not found' });
    res.json(feedback);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/front-desk/feedbacks', async (req, res) => {
  try {
    const feedback = new Feedback(req.body);
    await feedback.save();

    // If notify staff is checked, send notification
    if (req.body.notifyStaff && req.body.assignedStaff) {
      const staff = await Staff.findById(req.body.assignedStaff);
      if (staff) {
        const notification = new Notification({
          userEmail: staff.email,
          userPhone: staff.phone,
          notificationType: 'feedback_assigned',
          title: 'New Feedback Assigned',
          message: `You have been assigned a new feedback from ${req.body.name}`,
          data: { feedbackId: feedback._id },
        });
        await notification.save();
      }
    }

    res.status(201).json(feedback);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/front-desk/feedbacks/:id', async (req, res) => {
  try {
    const feedback = await Feedback.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('assignedStaff', 'name');
    if (!feedback) return res.status(404).json({ error: 'Feedback not found' });
    res.json(feedback);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/front-desk/feedbacks/:id', async (req, res) => {
  try {
    const result = await Feedback.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Feedback not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Call Logs
app.get('/api/front-desk/call-logs', async (req, res) => {
  try {
    const callLogs = await CallLog.find()
      .populate('loggedBy', 'name')
      .sort({ dateTime: -1 });
    res.json(callLogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/front-desk/call-logs/:id', async (req, res) => {
  try {
    const callLog = await CallLog.findById(req.params.id).populate('loggedBy', 'name');
    if (!callLog) return res.status(404).json({ error: 'Call log not found' });
    res.json(callLog);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/front-desk/call-logs', async (req, res) => {
  try {
    const callLog = new CallLog(req.body);
    await callLog.save();
    res.status(201).json(callLog);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/front-desk/call-logs/:id', async (req, res) => {
  try {
    const callLog = await CallLog.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('loggedBy', 'name');
    if (!callLog) return res.status(404).json({ error: 'Call log not found' });
    res.json(callLog);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/front-desk/call-logs/:id', async (req, res) => {
  try {
    const result = await CallLog.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Call log not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
