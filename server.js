import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { rateLimit } from 'express-rate-limit';
import mongoose from './database.js';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { connectDB, Staff, Student, Class, Attendance, getNextStaffCode, Timetable, Exam, Result, IntakeForm, FormAssignment, FormSubmission, Notification, Visitor, Admission, GatePass, Appointment, Feedback, CallLog, FeeStructure, FeePayment, FeeRefund, Substitution, getNextReceiptNumber, getNextRefundNumber, AdmissionFormConfig, AdmissionIdConfig, RollNumberConfig, DocumentConfig, getNextAdmissionId, getNextRollNumber, SchoolSettings, FeeTemplate, StaffAttendance, StudentFeeStructure, Remark } from './database.js';
import messageRoutes from './routes/messages.js';
import feeHeadsRoutes from './routes/feeHeads.js';
import studentFeesRoutes from './routes/studentFees.js';
import feeSettingsRoutes from './routes/feeSettings.js';
import staffAttendanceRoutes from './routes/staffAttendance.js';
import payrollRoutes from './routes/payroll.js';
import announcementRoutes from './routes/announcements.js';
import reminderRoutes from './routes/reminders.js';
import notificationRoutes from './routes/notifications.js';
import callRoutes from './routes/calls.js';
import visitorsRoutes from './routes/visitors.js';
import gatePassesRoutes from './routes/gatePasses.js';
import frontDeskRoutes from './routes/frontDesk.js';
import classesEnhancedRoutes from './routes/classesEnhanced.js';
import teacherAssignmentsRoutes from './routes/teacherAssignments.js';
import teacherTimetableRoutes from './routes/teacherTimetable.js';
import validationRoutes from './routes/validation.js';
import timetableRoutes from './routes/timetable.js';
import substitutionRoutes from './routes/substitutions.js';
import settingsRoutes from './routes/settings.js';
import { initializeChatHandlers } from './socket/chatHandler.js';
import { validate, schemas } from './middleware/validation.js';
import { validateEnvironment, config } from './config/environment.js';
import { authenticate, requireAdmin as authRequireAdmin, generateToken } from './middleware/auth.js';
import { checkPermission, requireAdmin as permRequireAdmin } from './middleware/permissions.js';
import timetableService from './services/timetableService.js';
import conflictDetectionService from './services/conflictDetectionService.js';
import batchOperationsService from './services/batchOperationsService.js';
import cacheService from './services/cacheService.js';

// Load and validate environment variables
dotenv.config();
validateEnvironment();

const app = express();
const PORT = process.env.PORT || 3001;

// Create HTTP server and wrap Express app
const httpServer = createServer(app);

// Initialize Socket.IO with CORS - FIXED: Use environment variables
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  },
  transports: ['websocket', 'polling']
});

// Attach io instance to Express app so routes can access it
app.set('io', io);

// Configure Cloudinary - FIXED: Validate configuration
if (config.cloudinary.configured) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret
  });
} else {
  console.warn('⚠️ Cloudinary not configured. File uploads will use base64 fallback.');
}

// Configure Multer
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Configure CORS - FIXED: Use environment variables
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Increase body size limit to handle large file uploads (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Rate limiting - ADDED for security
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Increased from 100 to 300 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for successful requests to certain endpoints
  skip: (req) => {
    // Don't rate limit health checks or static assets
    return req.path === '/health' || req.path.startsWith('/static');
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true, // Don't count successful requests
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // Limit each IP to 50 uploads per hour
  message: 'Too many file uploads, please try again later.',
});

// Apply rate limiting to all routes
app.use('/api/', limiter);

// Connect to database with error handling
try {
  await connectDB();
} catch (error) {
  console.error('❌ Failed to start server: Database connection failed');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// Initialize Socket.IO chat handlers
initializeChatHandlers(io);

// Mount message routes
app.use('/api/messages', messageRoutes);

// Mount fee management routes
app.use('/api/fee-heads', feeHeadsRoutes);
app.use('/api/student-fees', studentFeesRoutes);
app.use('/api/fee-settings', feeSettingsRoutes);

// Mount staff attendance routes
app.use('/api/staff-attendance', staffAttendanceRoutes);

// Payroll routes
app.use('/api/payroll', payrollRoutes);

// Permission routes
import permissionRoutes from './routes/permissions.js';
app.use('/api/permissions', permissionRoutes);

// Messages Module routes
app.use('/api/announcements', announcementRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/calls', callRoutes);

// Front Desk Module routes
app.use('/api/visitors', visitorsRoutes);
app.use('/api/gate-passes', gatePassesRoutes);
app.use('/api/front-desk', frontDeskRoutes);

// Enhanced Class Module routes
app.use('/api/classes-enhanced', classesEnhancedRoutes);

// Teacher Assignments routes
app.use('/api/teacher-assignments', teacherAssignmentsRoutes);

// Teacher Timetable routes
app.use('/api/teacher-timetable', teacherTimetableRoutes);

// Validation routes
app.use('/api/validation', validationRoutes);

// Timetable routes
app.use('/api/timetable', timetableRoutes);

// Substitutions routes
app.use('/api/substitutions', substitutionRoutes);

// Settings routes
app.use('/api/settings', settingsRoutes);

// Class Settings routes
import classSettingsRoutes from './routes/classSettings.js';
app.use('/api/class-settings', classSettingsRoutes);

// Make io and Staff available to routes
app.locals.io = io;
app.locals.Staff = Staff;

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
app.post('/api/auth/login', authLimiter, validate(schemas.login), async (req, res) => {
  try {
    const { phone, email, password } = req.body;
    
    // Validate input
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    // Build query for phone or email (don't include password in query!)
    let query = { status: 'active' };
    if (phone) {
      query.phone = phone;
    } else if (email) {
      query.email = email;
    } else {
      return res.status(400).json({ error: 'Phone or email is required' });
    }
    
    // Find staff by phone/email only
    const staff = await Staff.findOne(query);
    if (!staff) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare password using bcrypt
    const isPasswordValid = await staff.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get classes where this staff is class teacher
    const classes = await Class.find({ classTeacherId: staff._id });

    // Generate JWT token
    const token = generateToken(staff._id.toString(), staff.role);

    res.json({
      id: staff._id,
      code: staff.code,
      name: staff.name,
      role: staff.role,
      email: staff.email,
      phone: staff.phone,
      classes: classes.map(c => ({ id: c._id, name: c.name, section: c.section })),
      token // Return JWT token for authentication
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ============ UPLOAD ROUTE ============
app.post('/api/upload', authenticate, uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Check file size
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }

    // Convert buffer to Base64
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    let dataURI = "data:" + req.file.mimetype + ";base64," + b64;

    // Try Cloudinary upload, fallback to base64 if it fails
    try {
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

      const uploadOptions = {
        resource_type: resourceType,
        folder: 'school_documents',
        public_id: `doc_${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9]/g, '_')}`,
        timeout: 60000, // 60 second timeout
        type: 'upload', // Ensure it's a regular upload, not authenticated
        access_mode: 'public' // Make sure the file is publicly accessible
      };

      const result = await cloudinary.uploader.upload(dataURI, uploadOptions);

      // Use URL as-is - simple and works
      let finalUrl = result.secure_url;

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
      
      // FIXED: Proper error notification
      // Fallback: return base64 data URI with warning
      res.json({
        url: dataURI,
        public_id: `local_${Date.now()}`,
        name: req.file.originalname,
        size: (req.file.size / 1024).toFixed(1) + ' KB',
        format: req.file.mimetype,
        warning: 'File uploaded locally. Cloud storage failed.',
        cloudinaryError: cloudinaryError.message
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
// Add document to student - FIXED: Use Mongoose methods
app.post('/api/students/:id/documents', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { name, type, url, uploadDate, category, front, back } = req.body;

    const newDoc = {
      id: new mongoose.Types.ObjectId().toString(), // Generate unique ID
      name,
      type,
      category: category || type,
      uploadDate: uploadDate || new Date().toISOString(),
      size: req.body.size || 'Unknown',
      date: new Date().toLocaleDateString()
    };

    // Handle front/back documents
    if (front && back) {
      newDoc.front = { url: front.url, uploadDate: front.uploadDate || new Date().toISOString() };
      newDoc.back = { url: back.url, uploadDate: back.uploadDate || new Date().toISOString() };
    } else if (url) {
      // Legacy support for single file uploads
      newDoc.url = url;
      newDoc.uploadDate = uploadDate || new Date().toISOString();
    }

    // Use Mongoose findByIdAndUpdate with atomic operation
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { $push: { documents: newDoc } },
      { new: true, runValidators: true }
    );

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({
      success: true,
      documents: student.documents || []
    });
  } catch (error) {
    console.error('❌ Error adding document:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete document from student - FIXED: Use document ID with Mongoose
app.delete('/api/students/:id/documents/:docId', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    // Use Mongoose findByIdAndUpdate with atomic $pull operation
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { $pull: { documents: { id: req.params.docId } } },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ success: true, documents: student.documents || [] });
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update student photo
app.put('/api/students/:id/photo', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { photo } = req.body;

    // Use Mongoose findByIdAndUpdate
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { photo },
      { new: true, runValidators: true }
    );

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({
      success: true,
      photo: student.photo
    });
  } catch (error) {
    console.error('❌ Error updating photo:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fix corrupted documents field (migration endpoint)
app.post('/api/students/:id/fix-documents', async (req, res) => {
  try {
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
// All staff routes require authentication and appropriate permissions
app.get('/api/staff', authenticate, checkPermission('staff', 'view'), async (req, res) => {
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
        // password: REMOVED - Never expose password hashes to frontend
        
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
        emergencyContacts: s.emergencyContacts || [],
        whatsappNumber: s.whatsappNumber,
        isWhatsapp: s.isWhatsapp || false,
        
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
        salary: s.salary || 0,
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


app.get('/api/staff/:id', authenticate, checkPermission('staff', 'view'), async (req, res) => {
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
      // Don't return hashed password
      
      // Personal Details
      dob: staff.dob,
      dateOfBirth: staff.dob, // Alias for compatibility
      gender: staff.gender,
      fatherName: staff.fatherName,
      bloodGroup: staff.bloodGroup,
      maritalStatus: staff.maritalStatus,
      employmentType: staff.employmentType,
      nationality: staff.nationality || null,
      
      // Contact
      emergencyContact: staff.emergencyContact,
      emergencyPhone: staff.emergencyPhone,
      emergencyContacts: staff.emergencyContacts || [],
      whatsappNumber: staff.whatsappNumber,
      isWhatsapp: staff.isWhatsapp || false,
      
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
      assignedClasses: staff.assignedClasses,
      isClassTeacher: staff.isClassTeacher,
      classTeacherOf: staff.classTeacherOf,
      classes: staff.assignedClasses, // Alias
      shift: staff.shift || null,
      
      // Bank & Salary
      accountNumber: staff.accountNumber,
      accountHolder: staff.name, // Use name as account holder
      ifscCode: staff.ifscCode,
      bankName: staff.bankName,
      branchName: staff.branchName,
      panNumber: staff.panNumber || null,
      salary: staff.salary || 0,
      salaryTemplate: staff.salaryTemplate,
      salaryBreakdown: staff.salaryBreakdown,
      
      // Class Assignment
      assignedClass: assignedClass ? `${assignedClass.name} ${assignedClass.section}` : null,
      assignedClassId: assignedClass?._id,
      
      // Hierarchy
      reporterId: staff.reporterId?._id,
      reporterName: staff.reporterId?.name,
    });
    
    // Send paginated response
    res.json({
      data: formatted,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < Math.ceil(total / limitNum),
        hasPrevPage: pageNum > 1
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/staff', authenticate, checkPermission('staff', 'create'), validate(schemas.createStaff), async (req, res) => {
  try {
    const {
      name, role, department, status, phone, email, joinDate, address, assignedClassId, reporterId,
      // Personal Details
      dob, gender, fatherName, bloodGroup, maritalStatus, employmentType,
      emergencyContact, emergencyPhone, emergencyContacts, whatsappNumber, isWhatsapp,
      // Documents
      picture, idDocuments,
      // Qualifications
      professionalQualifications, totalExperience, previousOrganization, roleInOrganization, qualificationDocs, customDocuments,
      // Staff Info
      staffNumber, staffType, assignedClasses, isClassTeacher, classTeacherOf,
      // Bank & Salary
      accountNumber, ifscCode, bankName, branchName, salary, salaryTemplate, salaryBreakdown
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
      code, name,
      // Use role if provided, otherwise use staffType (they have the same values now)
      role: role || staffType,
      department: department || expertise,
      status: status || 'active',
      phone, email, joinDate, address, username, password,
      reporterId: reporterId || null,
      // Personal Details
      dob, gender, fatherName, bloodGroup, maritalStatus, employmentType,
      emergencyContact, emergencyPhone, emergencyContacts, whatsappNumber, isWhatsapp,
      // Documents
      picture, idDocuments,
      // Qualifications
      professionalQualifications, totalExperience, previousOrganization, roleInOrganization, qualificationDocs, customDocuments,
      // Staff Info
      staffNumber, staffType, assignedClasses, isClassTeacher, classTeacherOf,
      // Bank & Salary
      accountNumber, ifscCode, bankName, branchName, salary, salaryTemplate, salaryBreakdown
    });
    await staff.save();

    // If class teacher, assign to class
    if (isClassTeacher && classTeacherOf) {
      // Parse classTeacherOf (e.g., "10-A") into name and section
      const classMatch = classTeacherOf.match(/^(\d+)-([A-Za-z]+)$/);
      if (classMatch) {
        const [, className, section] = classMatch;
        const targetClass = await Class.findOne({ name: className, section: section.toUpperCase() });
        if (targetClass) {
          await Class.findByIdAndUpdate(targetClass._id, { classTeacherId: staff._id });
        }
      }
    }

    const assignedClass = (isClassTeacher && classTeacherOf) ? await Class.findOne({ name: classTeacherOf.split('-')[0], section: classTeacherOf.split('-')[1]?.toUpperCase() }) : null;

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
      emergencyContact, emergencyPhone, emergencyContacts, whatsappNumber, isWhatsapp,
      picture, idDocuments,
      professionalQualifications, totalExperience, previousOrganization, roleInOrganization, qualificationDocs, customDocuments,
      staffNumber, staffType, assignedClasses, isClassTeacher, classTeacherOf,
      accountNumber, ifscCode, bankName, branchName, salary, salaryTemplate, salaryBreakdown
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/staff/:id', authenticate, checkPermission('staff', 'edit'), async (req, res) => {
  try {
    const {
      // Basic fields
      name, role, department, status, phone, email, joinDate, address, assignedClassId, username, password, reporterId,
      // Personal Details
      dob, gender, fatherName, bloodGroup, maritalStatus, employmentType,
      // Contact
      emergencyContact, emergencyPhone, emergencyContacts, whatsappNumber, isWhatsapp,
      // Documents
      picture, idDocuments, customDocuments,
      // Qualifications
      professionalQualifications, totalExperience, previousOrganization, roleInOrganization, qualificationDocs,
      // Staff Info
      staffNumber, staffType, assignedClasses, isClassTeacher, classTeacherOf,
      // Bank & Salary
      accountNumber, ifscCode, bankName, branchName, salaryTemplate, salaryBreakdown
    } = req.body;

    // Validate circular reference if reporterId is being updated
    if (reporterId !== undefined && reporterId !== null) {
      // Check if reporter exists
      const reporter = await Staff.findById(reporterId);
      if (!reporter) {
        return res.status(400).json({ error: 'Reporter not found' });
      }

      // Check for circular reference - FIXED: Added max depth limit to prevent stack overflow
      const MAX_HIERARCHY_DEPTH = 10;
      
      const checkCircular = async (currentId, targetId, visited = new Set(), depth = 0) => {
        // Prevent infinite recursion - max 10 levels of hierarchy
        if (depth > MAX_HIERARCHY_DEPTH) {
          throw new Error('Maximum hierarchy depth exceeded. Cannot create hierarchy deeper than 10 levels.');
        }
        
        if (currentId === targetId) return true;
        if (visited.has(currentId)) return false;
        visited.add(currentId);

        const current = await Staff.findById(currentId);
        if (!current || !current.reporterId) return false;

        return checkCircular(current.reporterId.toString(), targetId, visited, depth + 1);
      };

      try {
        const hasCircular = await checkCircular(reporterId, req.params.id);
        if (hasCircular) {
          return res.status(400).json({ error: 'Cannot assign reporter: This would create a circular reference' });
        }
      } catch (hierarchyError) {
        return res.status(400).json({ error: hierarchyError.message });
      }
    }

    // Build update object - include all fields
    const updateData = {
      // Basic fields
      name, role, department, status, phone, email, joinDate, address,
      // Personal Details
      dob, gender, fatherName, bloodGroup, maritalStatus, employmentType,
      // Contact
      emergencyContact, emergencyPhone, emergencyContacts,
      whatsappNumber, isWhatsapp,
      // Documents
      picture, idDocuments, customDocuments,
      // Qualifications
      professionalQualifications, totalExperience, previousOrganization, roleInOrganization, qualificationDocs,
      // Staff Info
      staffNumber, staffType, assignedClasses, isClassTeacher, classTeacherOf,
      // Bank & Salary
      accountNumber, ifscCode, bankName, branchName, salaryTemplate, salaryBreakdown
    };
    if (username) updateData.username = username;
    if (reporterId !== undefined) updateData.reporterId = reporterId || null;

    // Remove undefined values to prevent MongoDB from saving them
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });
    
    // If password is provided, we need to hash it manually since findByIdAndUpdate bypasses pre-save hooks
    if (password) {
      const bcrypt = await import('bcrypt');
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    const staff = await Staff.findByIdAndUpdate(req.params.id, updateData, { new: true }).populate('reporterId', 'name');
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    // Update class assignment
    await Class.updateMany({ classTeacherId: staff._id }, { $unset: { classTeacherId: 1 } });
    if (assignedClassId) {
      await Class.findByIdAndUpdate(assignedClassId, { classTeacherId: staff._id });
    }

    const assignedClass = await Class.findOne({ classTeacherId: staff._id });
    
    const responseData = {
      id: staff._id,
      ...staff.toObject(),
      assignedClass: assignedClass ? `${assignedClass.name} ${assignedClass.section}` : null,
      assignedClassId: assignedClass?._id,
      reporterId: staff.reporterId?._id,
      reporterName: staff.reporterId?.name,
    };
    
    // Broadcast staff update to all connected clients via Socket.IO
    io.emit('staff_updated', {
      staffId: staff._id.toString(),
      name: staff.name,
      role: staff.role,
      department: staff.department,
      status: staff.status,
      phone: staff.phone,
      email: staff.email,
      picture: staff.picture,
      timestamp: new Date()
    });

    res.json(responseData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update staff credentials
app.put('/api/staff/:id/credentials', authenticate, authRequireAdmin, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username && !password) {
      return res.status(400).json({ error: 'Username or password required' });
    }

    const updateData = {};
    if (username) updateData.username = username;
    
    // Hash password if provided
    if (password) {
      const bcrypt = await import('bcrypt');
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    const staff = await Staff.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    res.json({ success: true, username: staff.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/staff/:id', authenticate, checkPermission('staff', 'delete'), async (req, res) => {
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


// ============ SCHOOL SETTINGS ROUTES ============
app.get('/api/school-settings', async (req, res) => {
  try {
    const SchoolSettings = mongoose.model('SchoolSettings');
    let settings = await SchoolSettings.findOne();

    // Create default settings if doesn't exist
    if (!settings) {
      settings = new SchoolSettings({
        name: 'My School',
        address: '',
        phone: '',
        email: '',
        website: '',
        academicYear: '2024-25',
        logo: ''
      });
      await settings.save();
    }

    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/school-settings', async (req, res) => {
  try {
    const SchoolSettings = mongoose.model('SchoolSettings');
    let settings = await SchoolSettings.findOne();

    if (!settings) {
      settings = new SchoolSettings(req.body);
    } else {
      Object.assign(settings, req.body);
    }

    await settings.save();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============ FEE TEMPLATES ROUTES ============
app.get('/api/fee-templates', async (req, res) => {
  try {
    const FeeTemplate = mongoose.model('FeeTemplate');
    const templates = await FeeTemplate.find().sort({ name: 1 });
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/fee-templates/:id', async (req, res) => {
  try {
    const FeeTemplate = mongoose.model('FeeTemplate');
    const template = await FeeTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Fee template not found' });
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fee-templates', async (req, res) => {
  try {
    const FeeTemplate = mongoose.model('FeeTemplate');
    const template = new FeeTemplate(req.body);
    await template.save();
    res.status(201).json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/fee-templates/:id', async (req, res) => {
  try {
    const FeeTemplate = mongoose.model('FeeTemplate');
    const template = await FeeTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!template) return res.status(404).json({ error: 'Fee template not found' });
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/fee-templates/:id', async (req, res) => {
  try {
    const FeeTemplate = mongoose.model('FeeTemplate');
    const template = await FeeTemplate.findByIdAndDelete(req.params.id);
    if (!template) return res.status(404).json({ error: 'Fee template not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============ FEE STRUCTURE ROUTES ============
app.get('/api/fee-structure/class/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear } = req.query;

    const StudentFeeStructure = mongoose.model('StudentFeeStructure');
    const feeStructures = await StudentFeeStructure.find({
      classId,
      academicYear: academicYear || '2024-25'
    }).populate('studentId', 'name admissionId rollNo');

    res.json(feeStructures);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fee-structure', async (req, res) => {
  try {
    const { classId, academicYear, name, description } = req.body;

    const StudentFeeStructure = mongoose.model('StudentFeeStructure');

    // Check if structure already exists
    const existing = await StudentFeeStructure.findOne({
      classId,
      academicYear: academicYear || '2024-25'
    });

    if (existing) {
      return res.status(400).json({ error: 'Fee structure already exists for this class and year' });
    }

    const structure = new StudentFeeStructure({
      classId,
      academicYear: academicYear || '2024-25',
      name,
      description,
      feeHeads: []
    });

    await structure.save();
    res.status(201).json(structure);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fee-structure/apply-to-students', async (req, res) => {
  try {
    const { classId, academicYear, feeStructureId } = req.body;

    const StudentFeeStructure = mongoose.model('StudentFeeStructure');
    const templateStructure = await StudentFeeStructure.findById(feeStructureId);

    if (!templateStructure) {
      return res.status(404).json({ error: 'Fee structure template not found' });
    }

    // Get all students in the class
    const students = await Student.find({
      classId,
      academicYear: academicYear || '2024-25'
    });

    let appliedCount = 0;

    for (const student of students) {
      // Check if student already has fee structure
      const existing = await StudentFeeStructure.findOne({
        studentId: student._id,
        academicYear: academicYear || '2024-25'
      });

      if (!existing) {
        // Create fee structure for student based on template
        const newStructure = new StudentFeeStructure({
          studentId: student._id,
          classId,
          academicYear: academicYear || '2024-25',
          feeHeads: templateStructure.feeHeads.map(fh => ({
            ...fh.toObject(),
            paidAmount: 0,
            balanceAmount: fh.amount,
            status: 'pending'
          }))
        });

        newStructure.totalFee = newStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
        newStructure.totalPaid = 0;
        newStructure.totalBalance = newStructure.totalFee;
        newStructure.overallStatus = 'pending';

        await newStructure.save();
        appliedCount++;
      }
    }

    res.json({
      success: true,
      message: `Fee structure applied to ${appliedCount} students`,
      appliedCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/class/:classId/fee-status', async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear } = req.query;

    const StudentFeeStructure = mongoose.model('StudentFeeStructure');
    const feeStructures = await StudentFeeStructure.find({
      classId,
      academicYear: academicYear || '2024-25'
    }).populate('studentId', 'name admissionId rollNo');

    const result = feeStructures.map(fs => ({
      studentId: fs.studentId._id,
      studentName: fs.studentId.name,
      admissionId: fs.studentId.admissionId,
      rollNo: fs.studentId.rollNo,
      totalFee: fs.totalFee,
      totalPaid: fs.totalPaid,
      totalBalance: fs.totalBalance,
      overallStatus: fs.overallStatus
    }));

    res.json(result);
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
    
    // Broadcast attendance update
    io.emit('attendance_updated', {
      type: 'staff',
      staffId,
      date,
      status,
      inTime,
      outTime,
      reason,
      timestamp: new Date()
    });

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


// ============ STUDENT ATTENDANCE ROUTES ============
// Get attendance for a student
app.get('/api/attendance/:studentId', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const { studentId } = req.params;
    const { startDate, endDate } = req.query;

    const query = { studentId };
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startDate;
      if (endDate) query.date.$lte = endDate;
    }

    const attendance = await Attendance.find(query).sort({ date: -1 });

    // Convert to object format { date: { status, markedBy } }
    const attendanceObj = {};
    attendance.forEach(att => {
      attendanceObj[att.date] = {
        status: att.status,
        markedBy: att.markedBy,
        classId: att.classId
      };
    });

    res.json(attendanceObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get attendance for a class on a specific date
app.get('/api/attendance/class/:classId/:date', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const { classId, date } = req.params;

    const attendance = await Attendance.find({ classId, date })
      .populate('studentId', 'name rollNo admissionId');

    // Convert to object format { studentId: { status } }
    const attendanceObj = {};
    attendance.forEach(att => {
      attendanceObj[att.studentId._id.toString()] = {
        status: att.status,
        markedBy: att.markedBy
      };
    });

    res.json(attendanceObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark attendance for a single student
app.post('/api/attendance', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { studentId, classId, date, status } = req.body;

    // Validate required fields
    if (!studentId || !classId || !date || !status) {
      return res.status(400).json({ error: 'studentId, classId, date, and status are required' });
    }

    // Validate status
    const validStatuses = ['present', 'absent', 'late'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be present, absent, or late' });
    }

    // Upsert (update if exists, create if not)
    const attendance = await Attendance.findOneAndUpdate(
      { studentId, date },
      {
        studentId,
        classId,
        date,
        status,
        markedBy: req.user?.id
      },
      { new: true, upsert: true }
    );

    // Broadcast attendance update
    io.emit('student_attendance_updated', {
      type: 'student',
      studentId,
      classId,
      date,
      status,
      timestamp: new Date()
    });

    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk mark attendance for a class
app.post('/api/attendance/bulk', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { classId, date, attendance } = req.body;

    // Validate required fields
    if (!classId || !date || !Array.isArray(attendance)) {
      return res.status(400).json({ error: 'classId, date, and attendance array are required' });
    }

    const validStatuses = ['present', 'absent', 'late'];
    const results = [];

    // Process each attendance record
    for (const record of attendance) {
      const { studentId, status } = record;

      if (!studentId || !status) {
        continue; // Skip invalid records
      }

      if (!validStatuses.includes(status)) {
        continue; // Skip invalid status
      }

      // Upsert attendance
      const att = await Attendance.findOneAndUpdate(
        { studentId, date },
        {
          studentId,
          classId,
          date,
          status,
          markedBy: req.user?.id
        },
        { new: true, upsert: true }
      );

      results.push(att);
    }

    // Broadcast bulk attendance update
    io.emit('student_attendance_bulk_updated', {
      type: 'bulk',
      classId,
      date,
      count: results.length,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: `Attendance marked for ${results.length} students`,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get attendance report for a class for a date range
app.get('/api/attendance/report/:classId', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const attendance = await Attendance.find({
      classId,
      date: { $gte: startDate, $lte: endDate }
    }).populate('studentId', 'name rollNo admissionId');

    // Calculate attendance summary per student
    const summary = {};
    attendance.forEach(att => {
      const studentId = att.studentId._id.toString();
      if (!summary[studentId]) {
        summary[studentId] = {
          studentId: att.studentId._id,
          studentName: att.studentId.name,
          rollNo: att.studentId.rollNo,
          admissionId: att.studentId.admissionId,
          present: 0,
          absent: 0,
          late: 0,
          total: 0
        };
      }
      summary[studentId][att.status]++;
      summary[studentId].total++;
    });

    // Convert to array and calculate percentage
    const report = Object.values(summary).map(s => ({
      ...s,
      percentage: s.total > 0 ? ((s.present + s.late) / s.total * 100).toFixed(2) : 0
    }));

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============ CLASS ROUTES ============
app.get('/api/classes', authenticate, checkPermission('classes', 'view'), async (req, res) => {
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

app.post('/api/classes', authenticate, checkPermission('classes', 'create'), async (req, res) => {
  try {
    const { name, section, classTeacherId, subjects, academicYear } = req.body;
    const cls = new Class({ name, section, classTeacherId, subjects, academicYear });
    await cls.save();
    res.status(201).json({ id: cls._id, ...cls.toObject() });
  } catch (err) {
    // Handle duplicate key error for unique constraint
    if (err.code === 11000) {
      return res.status(400).json({
        error: 'A class with this name, section, and academic year already exists'
      });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/classes/:id', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { name, section, classTeacherId, subjects, academicYear } = req.body;
    const cls = await Class.findByIdAndUpdate(req.params.id,
      { name, section, classTeacherId, subjects, academicYear }, { new: true }
    );
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    
    // Broadcast class update
    io.emit('class_updated', {
      classId: cls._id.toString(),
      name: cls.name,
      section: cls.section,
      classTeacherId: cls.classTeacherId,
      timestamp: new Date()
    });

    res.json({ id: cls._id, ...cls.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/classes/:id', authenticate, checkPermission('classes', 'delete'), async (req, res) => {
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

// ============ CLASS SETTINGS ENDPOINTS (Timetable Management) ============

// Get class settings (tag and subjects)
app.get('/api/classes/:id/settings', authenticate, async (req, res) => {
  try {
    const cls = await Class.findById(req.params.id);
    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }
    
    res.json({
      classId: cls._id,
      classTag: cls.classTag || '',
      assignedSubjects: cls.assignedSubjects || [],
      name: cls.name,
      section: cls.section
    });
  } catch (err) {
    console.error('Error fetching class settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update class tag
app.put('/api/classes/:id/tag', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { classTag } = req.body;
    
    // Validate input
    if (classTag === undefined) {
      return res.status(400).json({ error: 'classTag field is required' });
    }
    
    const cls = await Class.findByIdAndUpdate(
      req.params.id,
      { classTag },
      { new: true, runValidators: true }
    );
    
    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }
    
    res.json({
      success: true,
      classId: cls._id,
      classTag: cls.classTag
    });
  } catch (err) {
    console.error('Error updating class tag:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update class subjects
app.put('/api/classes/:id/subjects', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { assignedSubjects } = req.body;
    
    // Validate input
    if (!Array.isArray(assignedSubjects)) {
      return res.status(400).json({ error: 'assignedSubjects must be an array' });
    }
    
    const cls = await Class.findByIdAndUpdate(
      req.params.id,
      { assignedSubjects },
      { new: true, runValidators: true }
    );
    
    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }
    
    res.json({
      success: true,
      classId: cls._id,
      assignedSubjects: cls.assignedSubjects
    });
  } catch (err) {
    console.error('Error updating class subjects:', err);
    res.status(500).json({ error: err.message });
  }
});


// ============ STUDENT ROUTES ============
// All student routes require authentication and appropriate permissions
app.get('/api/students', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const { classId, page = 1, limit = 50 } = req.query;
    
    // Parse pagination parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    // Build query
    const query = classId ? { classId } : {};
    
    // Get total count for pagination
    const total = await Student.countDocuments(query);
    
    // Fetch paginated students
    const students = await Student.find(query)
      .populate('classId', 'name section')
      .sort({ rollNo: 1 })
      .limit(limitNum)
      .skip(skip);
    
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
        siblings: s.siblings,

        // Academic Information
        previousSchool: s.previousSchool,
        tcNumber: s.tcNumber,

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

        // Pinning
        isPinned: s.isPinned,
        pinnedAt: s.pinnedAt,

        // Documents
        documents: s.documents,
        photo: s.photo,
      };
    });
    
    // Send paginated response
    res.json({
      data: formatted,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < Math.ceil(total / limitNum),
        hasPrevPage: pageNum > 1
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate next admission ID (MUST be before /:id route)
app.get('/api/students/next-admission-id', authenticate, async (req, res) => {
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

app.get('/api/students/:id', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    console.log('📖 GET /api/students/:id -', req.params.id);
    
    // Use Mongoose findById with populate
    const student = await Student.findById(req.params.id).populate('classId', 'name section');
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    // Format class info
    let classInfo = null;
    let className = null;
    if (student.classId) {
      classInfo = `${student.classId.name.replace('Class ', '')}-${student.classId.section}`;
      className = `${student.classId.name} ${student.classId.section}`;
    }
    
    console.log('📖 Student documents:', student.documents);
    console.log('📸 Student photo:', student.photo);
    
    res.json({
      id: student._id,
      ...student.toObject(),
      class: classInfo,
      className: className,
    });
  } catch (err) {
    console.error('❌ Error fetching student:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get fee summary for a student
app.get('/api/students/:id/fee-summary', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const { academicYear } = req.query;
    const year = academicYear || '2024-25';

    console.log('💰 Getting fee summary for student:', req.params.id, 'academicYear:', year);

    // Find fee structure for this student
    const feeStructure = await StudentFeeStructure.findOne({
      studentId: req.params.id,
      academicYear: year
    }).populate('feeHeads.feeHeadId');

    if (!feeStructure) {
      // Return empty fee structure if none exists
      return res.json({
        totalFee: 0,
        totalPaid: 0,
        totalPending: 0,
        totalDiscount: 0,
        collectionMode: 'term',
        nextDueDate: null,
        pendingDuesByPeriod: {},
        feeHeads: [],
        overallStatus: 'pending'
      });
    }

    // Calculate pending dues by period (if frequency info is available)
    const pendingDuesByPeriod = {};
    feeStructure.feeHeads.forEach(fh => {
      if (fh.balanceAmount > 0) {
        const period = fh.frequency || 'onetime';
        pendingDuesByPeriod[period] = (pendingDuesByPeriod[period] || 0) + fh.balanceAmount;
      }
    });

    res.json({
      totalFee: feeStructure.totalFee,
      totalPaid: feeStructure.totalPaid,
      totalPending: feeStructure.totalBalance,
      totalDiscount: feeStructure.discountApplied || 0,
      collectionMode: 'term',
      nextDueDate: feeStructure.nextDueDate || null,
      pendingDuesByPeriod,
      feeHeads: feeStructure.feeHeads,
      overallStatus: feeStructure.overallStatus
    });
  } catch (err) {
    console.error('❌ Error fetching fee summary:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/students', authenticate, checkPermission('students', 'create'), validate(schemas.createStudent), async (req, res) => {
  try {
    console.log('🔍 Validating student creation...');

    // Check admissionId uniqueness
    const existingAdmission = await Student.findOne({ admissionId: req.body.admissionId });
    if (existingAdmission) {
      console.log('❌ Duplicate admissionId:', req.body.admissionId);
      return res.status(409).json({
        error: 'Admission ID already exists',
        field: 'admissionId',
        value: req.body.admissionId
      });
    }
    console.log('✅ admissionId is unique');

    // Validate classId exists
    const classExists = await Class.findById(req.body.classId);
    if (!classExists) {
      console.log('❌ Class not found:', req.body.classId);
      return res.status(400).json({
        error: 'Class does not exist',
        field: 'classId',
        value: req.body.classId
      });
    }
    console.log('✅ classId is valid');

    // Check rollNo uniqueness within class+academicYear
    const existingRollNo = await Student.findOne({
      rollNo: req.body.rollNo,
      classId: req.body.classId,
      academicYear: req.body.academicYear
    });
    if (existingRollNo) {
      console.log('❌ Duplicate rollNo in class:', req.body.rollNo);
      return res.status(409).json({
        error: 'Roll number already exists in this class for the academic year',
        field: 'rollNo',
        value: req.body.rollNo
      });
    }
    console.log('✅ rollNo is unique in class');

    // Process whatsapp number from form data
    // Form sends: phone (mobile), and separate parents array with isWhatsapp flags
    // Store primary parent's whatsapp preference in parents array
    const processedParents = (req.body.parents || []).map(parent => ({
      ...parent,
      // Keep isWhatsapp flag in parent object for reference
      isWhatsapp: parent.isWhatsapp || false
    }));

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
      city: req.body.city,
      state: req.body.state,
      zipCode: req.body.zipCode,

      // Parent Information
      parentName: req.body.parentName,
      parentPhone: req.body.parentPhone,
      parentEmail: req.body.parentEmail,
      parentRelationship: req.body.parentRelationship,
      parentOccupation: req.body.parentOccupation,
      alternatePhone: req.body.alternatePhone,
      parents: processedParents,
      siblings: req.body.siblings,

      // Academic Information
      previousSchool: req.body.previousSchool,
      tcNumber: req.body.tcNumber,

      // Health & Safety
      medicalConditions: req.body.medicalConditions,
      emergencyContactName: req.body.emergencyContactName,
      emergencyContactPhone: req.body.emergencyContactPhone,

      // Requirements
      transportRequired: req.body.transportRequired || false,
      hostelRequired: req.body.hostelRequired || false,
      isWhatsapp: req.body.isWhatsapp || false,
      whatsappNumber: req.body.whatsappNumber,

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

    // Auto-initialize fee structure for the new student
    try {
      // Check if fee structure already exists
      const existingFeeStructure = await StudentFeeStructure.findOne({
        studentId: student._id,
        academicYear: student.academicYear || '2024-25'
      });

      if (!existingFeeStructure) {
        // Get class information
        const classInfo = await Class.findById(student.classId);
        if (classInfo) {
          // Extract class number from class name (e.g., "Class 10" -> "10")
          const classNumber = classInfo.name.replace('Class ', '');

          // Find FeeHead model to get applicable fee heads
          const FeeHead = mongoose.model('FeeHead');
          const applicableFeeHeads = await FeeHead.find({
            applicableClasses: classNumber,
            academicYear: student.academicYear || '2024-25',
            isActive: true
          });


          // Create fee structure
          const feeStructure = new StudentFeeStructure({
            studentId: student._id,
            classId: student.classId,
            academicYear: student.academicYear || '2024-25',
            feeHeads: applicableFeeHeads.map(fh => ({
              feeHeadId: fh._id,
              name: fh.name,
              category: fh.category,
              amount: fh.amount,
              mandatory: fh.mandatory,
              frequency: fh.frequency,
              paidAmount: 0,
              balanceAmount: fh.amount,
              status: 'pending'
            }))
          });

          // Calculate totals
          feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
          feeStructure.totalPaid = 0;
          feeStructure.totalBalance = feeStructure.totalFee;
          feeStructure.overallStatus = 'pending';

          await feeStructure.save();
        }
      }
    } catch (feeError) {
      // Log fee initialization error but don't fail student creation
      console.error('⚠️ Error auto-initializing fee structure:', feeError);
    }

  // Populate classId and format response same as GET endpoint
  const populatedStudent = await Student.findById(student._id).populate('classId', 'name section');
  const classInfo = populatedStudent.classId ? `${populatedStudent.classId.name.replace('Class ', '')}-${populatedStudent.classId.section}` : null;

  res.status(201).json({
    id: populatedStudent._id,
    name: populatedStudent.name,
    admissionId: populatedStudent.admissionId,
    academicYear: populatedStudent.academicYear,
    rollNo: populatedStudent.rollNo,
    classId: populatedStudent.classId?._id,
    class: classInfo,
    status: populatedStudent.status || 'active',
    feeStatus: populatedStudent.feeStatus || 'pending',
    photo: populatedStudent.photo,
    documents: populatedStudent.documents || [],
    ...populatedStudent.toObject()
  });
  } catch (err) {
    console.error('❌ Error creating student:', err);

    // Handle MongoDB duplicate key error
    if (err.code === 11000) {
      console.log('❌ MongoDB duplicate key error:', err.keyPattern);

      // Determine which field caused the duplicate
      const duplicateField = Object.keys(err.keyPattern)[0];
      const fieldLabels = {
        admissionId: 'Admission ID',
        rollNo: 'Roll Number'
      };

      return res.status(409).json({
        error: `${fieldLabels[duplicateField] || duplicateField} already exists`,
        field: duplicateField,
        code: 11000
      });
    }

    res.status(500).json({ error: err.message });
  }
});

app.put('/api/students/:id', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    // Process parents array to preserve isWhatsapp flags
    const processedParents = req.body.parents ? (req.body.parents || []).map(parent => ({
      ...parent,
      isWhatsapp: parent.isWhatsapp || false
    })) : undefined;

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
      city: req.body.city,
      state: req.body.state,
      zipCode: req.body.zipCode,

      // Parent Information
      parentName: req.body.parentName,
      parentPhone: req.body.parentPhone,
      parentEmail: req.body.parentEmail,
      parentRelationship: req.body.parentRelationship,
      parentOccupation: req.body.parentOccupation,
      alternatePhone: req.body.alternatePhone,
      parents: processedParents,
      siblings: req.body.siblings,

      // Academic Information
      previousSchool: req.body.previousSchool,
      tcNumber: req.body.tcNumber,

      // Health & Safety
      medicalConditions: req.body.medicalConditions,
      emergencyContactName: req.body.emergencyContactName,
      emergencyContactPhone: req.body.emergencyContactPhone,

      // Requirements
      transportRequired: req.body.transportRequired,
      hostelRequired: req.body.hostelRequired,
      isWhatsapp: req.body.isWhatsapp,
      whatsappNumber: req.body.whatsappNumber,

      // Status
      feeStatus: req.body.feeStatus,
      status: req.body.status,

      // Photo
      photo: req.body.photo,

      // Documents - ensure it's an array
      documents: Array.isArray(req.body.documents) ? req.body.documents : undefined
    };

    // Remove undefined values

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // Get original student before update for comparison
    const originalStudent = await Student.findById(req.params.id);
    if (!originalStudent) return res.status(404).json({ error: 'Student not found' });

    const student = await Student.findByIdAndUpdate(req.params.id, updateData, { new: true }).populate('classId', 'name section');
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Sync fee status with StudentFeeStructure
    try {
      // Check if classId or academicYear changed
      const classChanged = updateData.classId && updateData.classId !== originalStudent.classId?.toString();
      const academicYearChanged = updateData.academicYear && updateData.academicYear !== originalStudent.academicYear;

      if (classChanged || academicYearChanged) {
        console.log(`📚 Student ${student.admissionId} - class/year changed, re-initializing fee structure`);

        // Delete old fee structure
        await StudentFeeStructure.deleteMany({
          studentId: student._id
        });
        console.log(`🗑️ Deleted old fee structure for student ${student.admissionId}`);

        // Create new fee structure for the new class/academic year
        const classInfo = await Class.findById(student.classId);
        if (classInfo) {
          // Extract class number from class name (e.g., "Class 10" -> "10")
          const classNumber = classInfo.name.replace('Class ', '');

          // Find FeeHead model to get applicable fee heads
          const FeeHead = mongoose.model('FeeHead');
          const applicableFeeHeads = await FeeHead.find({
            applicableClasses: classNumber,
            academicYear: student.academicYear || '2024-25',
            isActive: true
          });

          // Create fee structure
          const feeStructure = new StudentFeeStructure({
            studentId: student._id,
            classId: student.classId,
            academicYear: student.academicYear || '2024-25',
            feeHeads: applicableFeeHeads.map(fh => ({
              feeHeadId: fh._id,
              name: fh.name,
              category: fh.category,
              amount: fh.amount,
              mandatory: fh.mandatory,
              frequency: fh.frequency,
              paidAmount: 0,
              balanceAmount: fh.amount,
              status: 'pending'
            }))
          });

          // Calculate totals
          feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
          feeStructure.totalPaid = 0;
          feeStructure.totalBalance = feeStructure.totalFee;
          feeStructure.overallStatus = 'pending';

          await feeStructure.save();
          console.log(`✅ Created new fee structure for student ${student.admissionId} in ${classInfo.name}`);
        }
      }

      // Sync feeStatus if it was updated
      if (updateData.feeStatus && updateData.feeStatus !== originalStudent.feeStatus) {
        console.log(`💰 Updating fee status for student ${student.admissionId}: ${originalStudent.feeStatus} -> ${updateData.feeStatus}`);

        // Get current fee structure
        const feeStructure = await StudentFeeStructure.findOne({
          studentId: student._id,
          academicYear: student.academicYear || '2024-25'
        });

        if (feeStructure) {
          // Update overallStatus
          feeStructure.overallStatus = updateData.feeStatus;
          await feeStructure.save();
          console.log(`✅ Updated StudentFeeStructure.overallStatus to ${updateData.feeStatus}`);
        }
      }
    } catch (feeError) {
      // Log fee sync error but don't fail the update
      console.error('⚠️ Error syncing fee structure:', feeError);
    }

    res.json({ id: student._id, ...student.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/students/:id', authenticate, checkPermission('students', 'delete'), async (req, res) => {
  try {
    console.log('🗑️ Attempting to delete student:', req.params.id);

    const student = await Student.findById(req.params.id);
    if (!student) {
      console.log('❌ Student not found for deletion');
      return res.status(404).json({ error: 'Student not found' });
    }

    // Check for associated data that might prevent deletion
    // You can add more checks here as needed (e.g., attendance records, exam results, etc.)
    console.log('✅ Student found, checking for associated data...');

    // Delete associated StudentFeeStructure
    const feeStructureDeleteResult = await StudentFeeStructure.deleteMany({ studentId: req.params.id });
    console.log(`✅ Deleted ${feeStructureDeleteResult.deletedCount} fee structure(s)`);

    // Delete the student
    await Student.findByIdAndDelete(req.params.id);
    console.log('✅ Student deleted successfully');

    res.json({
      success: true,
      message: 'Student and associated data deleted successfully',
      deletedFeeStructures: feeStructureDeleteResult.deletedCount
    });
  } catch (err) {
    console.error('❌ Error deleting student:', err);
    res.status(500).json({ error: err.message });
  }
});

// PIN endpoint - Mark student as pinned
app.put('/api/students/:id/pin', authenticate, async (req, res) => {
  try {
    console.log('📌 Pinning student:', req.params.id);

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      {
        isPinned: true,
        pinnedAt: new Date()
      },
      { new: true }
    ).populate('classId', 'name section');

    if (!student) {
      console.log('❌ Student not found for pinning');
      return res.status(404).json({ error: 'Student not found' });
    }

    console.log('✅ Student pinned successfully');
    res.json({
      success: true,
      isPinned: student.isPinned,
      pinnedAt: student.pinnedAt
    });
  } catch (err) {
    console.error('❌ Error pinning student:', err);
    res.status(500).json({ error: err.message });
  }
});

// UNPIN endpoint - Mark student as unpinned
app.put('/api/students/:id/unpin', authenticate, async (req, res) => {
  try {
    console.log('📍 Unpinning student:', req.params.id);

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      {
        isPinned: false,
        pinnedAt: null
      },
      { new: true }
    ).populate('classId', 'name section');

    if (!student) {
      console.log('❌ Student not found for unpinning');
      return res.status(404).json({ error: 'Student not found' });
    }

    console.log('✅ Student unpinned successfully');
    res.json({
      success: true,
      isPinned: student.isPinned,
      pinnedAt: student.pinnedAt
    });
  } catch (err) {
    console.error('❌ Error unpinning student:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ START SERVER ============
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
