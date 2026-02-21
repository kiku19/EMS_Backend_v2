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
import TrashItem from './models/TrashItem.js';
import messageRoutes from './routes/messages.js';
import feeHeadsRoutes from './routes/feeHeads.js';
import studentFeesRoutes from './routes/studentFees.js';
import feeSettingsRoutes from './routes/feeSettings.js';
import feesRoutes from './routes/fees.js';  // Payment history and fee operations
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
import substitutionAlertsRoutes from './routes/substitutionAlerts.js';
import timetableCleanupRoutes from './routes/timetableCleanup.js';

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error);
  console.error('Stack:', error.stack);
  // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION:', reason);
  // Don't exit the process, just log the error
});
import settingsRoutes from './routes/settings.js';
import trashRoutes from './routes/trash.js';
import parentAuthRoutes from './routes/parentAuth.js';
import parentDataRoutes from './routes/parentData.js';
import parentMessagingRoutes from './routes/parentMessaging.js';
import parentManagementRoutes from './routes/parentManagement.js';
import homeworkRoutes from './routes/homework.js';
import teacherLeavesRoutes from './routes/teacherLeaves.js';
import mobileRoutes from './routes/mobile.js';
import pushNotificationsRoutes from './routes/pushNotifications.js';
import payslipsRoutes from './routes/payslips.js';
import calendarEventsRoutes from './routes/calendarEvents.js';
import { initializeChatHandlers } from './socket/chatHandler.js';
import { validate, schemas } from './middleware/validation.js';
import { validateEnvironment, config } from './config/environment.js';
import { authenticate, requireAdmin as authRequireAdmin, generateToken } from './middleware/auth.js';
import { checkPermission, requireAdmin as permRequireAdmin } from './middleware/permissions.js';
import timetableService from './services/timetableService.js';
import conflictDetectionService from './services/conflictDetectionService.js';
import batchOperationsService from './services/batchOperationsService.js';
import cacheService from './services/cacheService.js';
import { initializeSocket } from './utils/socketEmitter.js';

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

// Initialize socket emitter utility
initializeSocket(io);

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

// Debug: Log CORS origins
console.log('🔧 CORS Origins configured:', config.corsOrigins);

// Configure CORS - FIXED: Use environment variables
app.use(cors({
  origin: function (origin, callback) {
    // In development, allow all origins
    if (config.isDevelopment) {
      return callback(null, true);
    }
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    const allowedOrigins = config.corsOrigins;
    
    // Check for exact match
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Check for wildcard patterns
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin.includes('*')) {
        const pattern = allowedOrigin.replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`);
        return regex.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      return callback(null, true);
    }
    
    // Log rejected origin for debugging
    console.log('CORS: Rejected origin:', origin);
    console.log('CORS: Allowed origins:', allowedOrigins);
    
    // Origin not allowed
    callback(null, false);
  },
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
  max: 3000, // Increased from 300 to 3000 requests per windowMs for development
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for successful requests to certain endpoints
  skip: (req) => {
    // Don't rate limit in development or for health checks
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    return isDevelopment || isLocalhost || req.path === '/health' || req.path.startsWith('/static');
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

// ============ HELPER FUNCTIONS ============

/**
 * Resolve a class identifier to a MongoDB ObjectId
 * Supports:
 * - MongoDB ObjectId (e.g., "507f1f77bcf86cd799439011")
 * - Name-Section format (e.g., "2-B", "10-A")
 * Returns: { classId: ObjectId, classDoc: ClassDocument } or null if not found
 */
async function resolveClassId(identifier) {
  if (!identifier) return null;

  // Check if it's a valid ObjectId (24 hex characters)
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);

  if (isValidObjectId) {
    const classDoc = await Class.findById(identifier);
    if (classDoc) {
      return { classId: classDoc._id, classDoc };
    }
  }

  // Try to parse as "name-section" format (e.g., "2-B", "10-A")
  // Also handle "name section" format with space
  const classIdentifier = identifier.replace('-', ' ').replace('_', ' ');

  // Try exact match first
  let classDoc = await Class.findOne({
    $or: [
      { name: identifier },
      { name: classIdentifier },
      { $expr: { $eq: [{ $concat: ['$name', '-', '$section'] }, identifier] } },
      { $expr: { $eq: [{ $concat: ['$name', ' ', '$section'] }, classIdentifier] } }
    ]
  });

  if (classDoc) {
    return { classId: classDoc._id, classDoc };
  }

  // Try matching just the name (for cases like "2-B" where name is "2" and section is "B")
  const parts = identifier.split(/[-_ ]/);
  if (parts.length >= 2) {
    const name = parts[0];
    const section = parts.slice(1).join('-');

    classDoc = await Class.findOne({ name, section });
    if (classDoc) {
      return { classId: classDoc._id, classDoc };
    }
  }

  return null;
}

// Mount message routes
app.use('/api/messages', messageRoutes);

// Mount fee management routes
app.use('/api/fee-heads', feeHeadsRoutes);
app.use('/api/student-fees', studentFeesRoutes);
app.use('/api/fee-settings', feeSettingsRoutes);
app.use('/api/fees', feesRoutes);  // Payment history and operations

// Mount staff attendance routes
app.use('/api/staff-attendance', staffAttendanceRoutes);

// Payroll routes
app.use('/api/payroll', payrollRoutes);

// Payslips routes
app.use('/api/payslips', payslipsRoutes);

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

// Substitution Alerts routes
app.use('/api/substitution-alerts', substitutionAlertsRoutes);

// Timetable Cleanup routes
app.use('/api/timetable-cleanup', timetableCleanupRoutes);

// Settings routes
app.use('/api/settings', settingsRoutes);

// Trash management routes
app.use('/api/trash', authenticate, trashRoutes);

// Class Settings routes
import classSettingsRoutes from './routes/classSettings.js';
app.use('/api/class-settings', classSettingsRoutes);

// Intake Forms routes
import intakeFormsRoutes from './routes/intakeForms.js';
app.use('/api', intakeFormsRoutes);

// Public API routes (no authentication required)
import publicRoutes from './routes/public.js';
app.use('/api/public', publicRoutes);

// Parent portal routes
app.use('/api/parent/auth', parentAuthRoutes);
app.use('/api/parent', parentDataRoutes);
app.use('/api/parent/messages', parentMessagingRoutes);

// Parent management routes (admin only)
app.use('/api/parents', authenticate, parentManagementRoutes);

// Mobile API routes
app.use('/api/mobile', mobileRoutes);
app.use('/api/homework', homeworkRoutes);
app.use('/api/teacher-leaves', teacherLeavesRoutes);

// Push notification routes
app.use('/api/push-notifications', pushNotificationsRoutes);

// Calendar Events routes
app.use('/api', calendarEventsRoutes);

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
      employeeId: staff.code,
      token // Return JWT token for authentication
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Emergency password reset endpoint (admin-only, non-production)
app.post('/api/auth/emergency-reset', authenticate, authRequireAdmin, async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email and newPassword required' });
    }

    // Only allow this in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Not available in production' });
    }

    const bcrypt = await import('bcrypt');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    const staff = await Staff.findOneAndUpdate(
      { email },
      { password: hashedPassword },
      { new: true }
    );

    if (!staff) {
      return res.status(404).json({ error: 'Staff not found with this email' });
    }

    console.log('Emergency password reset for:', staff.email, 'by admin:', req.user.userId);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('Emergency reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ PUBLIC STAFF ROUTES (for Staff App) ============

// Public endpoint - Get list of active staff for login page (no auth required)
// Only expose minimal fields needed for staff-app login picker
app.get('/api/staff/public', async (req, res) => {
  try {
    const staff = await Staff.find({ status: 'active' })
      .select('name role department')
      .sort({ name: 1 });

    res.json(staff);
  } catch (err) {
    console.error('Error fetching public staff list:', err);
    res.status(500).json({ error: 'Failed to fetch staff list' });
  }
});

// Public endpoint - Validate if a staff member exists and is active (for session validation)
// This allows the mobile app to verify stored credentials are still valid on app startup
app.get('/api/staff/validate/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Find staff by ID and check if they exist and are active
    const staff = await Staff.findOne({ 
      _id: id,
      status: 'active'
    });

    if (!staff) {
      return res.json({ 
        valid: false, 
        reason: 'Staff member not found or inactive' 
      });
    }

    // Return basic staff info for session refresh
    res.json({
      valid: true,
      staff: {
        id: staff._id,
        name: staff.name,
        role: staff.role,
        email: staff.email,
        phone: staff.phone,
        status: staff.status
      }
    });
  } catch (err) {
    console.error('Error validating staff member:', err);
    res.json({ 
      valid: false, 
      reason: 'Validation failed' 
    });
  }
});

// Get today's timetable for a staff member (authenticated)
app.get('/api/staff/:id/timetable/today', authenticate, async (req, res) => {
  try {
    const staffId = req.params.id;
    const today = new Date();
    const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });

    // Find timetable entries for this staff member for today
    const timetables = await Timetable.find({
      teacherId: staffId,
      day: dayName
    }).populate('classId', 'name section strength');

    // Format the response
    const schedule = timetables.map(t => ({
      id: t._id,
      subject: t.subject,
      topic: t.topic || '',
      startTime: t.startTime,
      endTime: t.endTime,
      room: t.room || '',
      class: t.classId ? `${t.classId.name}-${t.classId.section}` : '',
      students: t.classId?.strength || 0,
      notes: t.notes || ''
    }));

    // Sort by start time
    schedule.sort((a, b) => {
      const [aH, aM] = a.startTime.split(':').map(Number);
      const [bH, bM] = b.startTime.split(':').map(Number);
      return (aH * 60 + aM) - (bH * 60 + bM);
    });

    res.json(schedule);
  } catch (err) {
    console.error('Error fetching today timetable:', err);
    res.status(500).json({ error: 'Failed to fetch timetable' });
  }
});

// Get weekly timetable for a staff member (authenticated)
app.get('/api/staff/:id/timetable/week', authenticate, async (req, res) => {
  try {
    const staffId = req.params.id;
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const timetables = await Timetable.find({ teacherId: staffId })
      .populate('classId', 'name section strength');

    // Group by day
    const weekSchedule = {};
    days.forEach(day => {
      weekSchedule[day] = timetables
        .filter(t => t.day === day)
        .map(t => ({
          id: t._id,
          subject: t.subject,
          topic: t.topic || '',
          startTime: t.startTime,
          endTime: t.endTime,
          room: t.room || '',
          class: t.classId ? `${t.classId.name}-${t.classId.section}` : '',
          students: t.classId?.strength || 0,
          notes: t.notes || ''
        }))
        .sort((a, b) => {
          const [aH, aM] = a.startTime.split(':').map(Number);
          const [bH, bM] = b.startTime.split(':').map(Number);
          return (aH * 60 + aM) - (bH * 60 + bM);
        });
    });

    res.json(weekSchedule);
  } catch (err) {
    console.error('Error fetching weekly timetable:', err);
    res.status(500).json({ error: 'Failed to fetch timetable' });
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
        resourceType = 'raw';
      } else if (req.file.mimetype.startsWith('image/')) {
        resourceType = 'image';
      } else if (req.file.mimetype.startsWith('video/')) {
        resourceType = 'video';
      } else if (req.file.mimetype.startsWith('audio/')) {
        resourceType = 'video';
      } else {
        resourceType = 'raw';
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

// Get classes assigned to a staff member
app.get('/api/staff/:id/classes', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.query; // 'classTeacher' or 'all' (default)
    
    const staff = await Staff.findById(id);

    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    let allClassIds = [];

    // If role=classTeacher, only get classes where this staff is the class teacher
    if (role === 'classTeacher') {
      const classTeacherClasses = await Class.find({ classTeacherId: staff._id }).select('_id');
      allClassIds = classTeacherClasses.map(c => c._id.toString());
    } else {
      // Default behavior: get all classes (subject teaching + class teacher)
      // Get classes from assignedClasses field
      const assignedClassIds = staff.assignedClasses || [];

      // Also get classes from teacherAssignments
      const teacherAssignmentClasses = (staff.teacherAssignments || []).flatMap(ta => ta.classes || []);

      // Also get classes where this staff is the class teacher (use staff._id instead of string id)
      const classTeacherClasses = await Class.find({ classTeacherId: staff._id }).select('_id');
      const classTeacherClassIds = classTeacherClasses.map(c => c._id.toString());

      // Combine all class IDs (as strings for matching) - include classTeacherClassIds
      allClassIds = [...new Set([...assignedClassIds, ...teacherAssignmentClasses.map(c => c.toString()), ...classTeacherClassIds])];
    }

    // Helper to check if string is valid ObjectId
    const isValidObjectId = (str) => /^[a-f\d]{24}$/i.test(str);

    // Fetch class details
    const classDetails = await Promise.all(
      allClassIds.map(async (classId) => {
        const classIdStr = classId.toString();
        let classData = null;

        // Only try findById if it looks like a valid ObjectId
        if (isValidObjectId(classIdStr)) {
          classData = await Class.findById(classIdStr);
        }

        // If not found or not a valid ObjectId, try name-section format
        if (!classData) {
          const parts = classIdStr.split('-');
          if (parts.length >= 2) {
            classData = await Class.findOne({
              name: parts[0],
              section: parts[1]
            });
          } else {
            // Try finding by name only
            classData = await Class.findOne({ name: classIdStr });
          }
        }

        if (classData) {
          // Count students in this class (use correct field: classId)
          // Filter by active status and exclude deleted students
          let studentCount = 0;
          try {
            studentCount = await Student.countDocuments({
              classId: classData._id,
              status: 'active',
              isDeleted: { $ne: true }
            });
          } catch (countError) {
            console.error('Error counting students for class:', classData._id, countError);
            studentCount = 0;
          }

          // Check if this staff is the class teacher
          const isClassTeacher = classData.classTeacherId?.toString() === id;

          return {
            id: classData._id,
            name: `${classData.name}-${classData.section}`,
            className: classData.name,
            section: classData.section,
            subject: isClassTeacher ? `Class Teacher - ${classData.name}` : (staff.department || 'General'),
            studentCount: studentCount,
            students: studentCount,
            isClassTeacher: isClassTeacher
          };
        }

        // Return null if class not found in DB (don't include invalid class IDs)
        return null;
      })
    );

    // Filter out null entries (classes not found in database)
    const validClassDetails = classDetails.filter(c => c !== null);

    res.json(validClassDetails);
  } catch (err) {
    console.error('Error fetching staff classes:', err);
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

    // Auto-generate username from email or code, ensuring uniqueness
    let baseUsername = email ? email.split('@')[0].toLowerCase() : code.toLowerCase();
    let username = baseUsername;
    let usernameExists = await Staff.findOne({ username });
    let suffix = 1;
    while (usernameExists) {
      username = `${baseUsername}${suffix}`;
      usernameExists = await Staff.findOne({ username });
      suffix++;
    }
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

    // Auto-create UserPermission based on staff role
    const roleMapping = {
      'Admin': 'admin',
      'Principal': 'principal',
      'Vice Principal': 'vice-principal',
      'Teacher': 'teacher',
      'Accountant': 'accountant',
      'Librarian': 'librarian',
      'Lab Assistant': 'lab-assistant',
      'Receptionist': 'receptionist',
      // Legacy mappings
      'Administrative': 'admin',
      'Administration': 'admin',
      'Teaching': 'teacher'
    };

    // Get the permission role from staff role (handle array of roles)
    const staffRoles = Array.isArray(staff.role) ? staff.role : [staff.role];
    // Use the first role or default to teacher
    const permissionRole = roleMapping[staffRoles[0]] || 'teacher';

    // Import UserPermission and PERMISSION_TEMPLATES
    const UserPermission = (await import('./models/UserPermission.js')).default;
    const { PERMISSION_TEMPLATES } = await import('./models/UserPermission.js');

    // Create user permission
    await UserPermission.create({
      staffId: staff._id,
      role: permissionRole,
      permissions: PERMISSION_TEMPLATES[permissionRole] || PERMISSION_TEMPLATES.teacher
    });

    console.log(`✅ Created ${permissionRole} permissions for staff ${staff.name}`);

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
    console.log('📥 Received staff update request for ID:', req.params.id);
    console.log('📦 Request body keys:', Object.keys(req.body));
    console.log('🔍 staffId in body?', 'staffId' in req.body, req.body.staffId);

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

    console.log('🔄 Attempting to update staff with data keys:', Object.keys(updateData));
    console.log('📝 staffType value:', updateData.staffType);

    let staff;
    try {
      staff = await Staff.findByIdAndUpdate(req.params.id, updateData, { new: true }).populate('reporterId', 'name');
    } catch (updateError) {
      console.error('❌ Update error:', updateError.message);
      console.error('❌ Full error:', updateError);
      throw updateError;
    }

    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    // Sync UserPermission if role changed
    if (role) {
      const roleMapping = {
        'Admin': 'admin',
        'Principal': 'principal',
        'Vice Principal': 'vice-principal',
        'Teacher': 'teacher',
        'Accountant': 'accountant',
        'Librarian': 'librarian',
        'Lab Assistant': 'lab-assistant',
        'Receptionist': 'receptionist',
        // Legacy mappings
        'Administrative': 'admin',
        'Administration': 'admin',
        'Teaching': 'teacher'
      };

      // Get the permission role from staff role (handle array of roles)
      const staffRoles = Array.isArray(role) ? role : [role];
      const permissionRole = roleMapping[staffRoles[0]] || 'teacher';

      // Import UserPermission and PERMISSION_TEMPLATES
      const UserPermission = (await import('./models/UserPermission.js')).default;
      const { PERMISSION_TEMPLATES } = await import('./models/UserPermission.js');

      // Update or create user permission
      await UserPermission.findOneAndUpdate(
        { userId: staff._id }, // Fixed: use userId instead of staffId
        {
          role: permissionRole,
          permissions: PERMISSION_TEMPLATES[permissionRole] || PERMISSION_TEMPLATES.teacher
        },
        { upsert: true, new: true }
      );

      console.log(`✅ Updated ${permissionRole} permissions for staff ${staff.name}`);
    }

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

// Staff self-service: Change own password
app.put('/api/staff/:id/change-password', authenticate, async (req, res) => {
  try {
    console.log('Password change request - params ID:', req.params.id, 'user ID:', req.user.id);

    // Verify the staff is changing their own password (compare as strings)
    if (req.params.id.toString() !== req.user.id.toString()) {
      console.log('Password change rejected - ID mismatch');
      return res.status(403).json({ error: 'You can only change your own password' });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Find the staff member
    const Staff = mongoose.model('Staff');
    const staff = await Staff.findById(req.params.id);

    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    console.log('Found staff:', staff.name, staff.email);

    // Verify current password using bcrypt directly
    const bcrypt = await import('bcrypt');
    const isMatch = await bcrypt.compare(currentPassword, staff.password);

    console.log('Password match result:', isMatch);

    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash and update the new password
    // Explicitly mark password as modified to ensure pre-save hook runs
    staff.password = newPassword;
    staff.markModified('password');
    await staff.save();

    console.log('Password changed successfully for:', staff.name);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Staff self-service: Get own profile
app.get('/api/staff/me', authenticate, async (req, res) => {
  try {
    console.log('Getting own profile - user.id:', req.user.id);
    const staff = await Staff.findById(req.user.id).populate('reporterId', 'name');
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

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
      dob: staff.dob,
      dateOfBirth: staff.dob,
      gender: staff.gender,
      fatherName: staff.fatherName,
      bloodGroup: staff.bloodGroup,
      maritalStatus: staff.maritalStatus,
      employmentType: staff.employmentType,
      emergencyContact: staff.emergencyContact,
      emergencyPhone: staff.emergencyPhone,
      emergencyContacts: staff.emergencyContacts,
      whatsappNumber: staff.whatsappNumber,
      isWhatsapp: staff.isWhatsapp,
      picture: staff.picture,
      qualification: staff.qualification,
      experience: staff.experience,
      professionalQualifications: staff.professionalQualifications,
      totalExperience: staff.totalExperience,
      designation: staff.designation,
      staffNumber: staff.staffNumber,
      staffType: staff.staffType,
    });
  } catch (err) {
    console.error('Error fetching own profile:', err);
    res.status(500).json({ error: err.message });
  }
});

// Staff self-service: Update own profile
app.put('/api/staff/:id/profile', authenticate, async (req, res) => {
  try {
    // Verify the staff is updating their own profile
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: 'You can only update your own profile' });
    }

    const {
      // Fields that staff can update themselves
      name, phone, email, address, emergencyContact, emergencyPhone, emergencyContacts,
      whatsappNumber, isWhatsapp, picture, qualification, experience,
      designation, department
    } = req.body;

    // Build update object with only allowed fields
    const updateData = {
      name, phone, email, address, emergencyContact, emergencyPhone, emergencyContacts,
      whatsappNumber, isWhatsapp, picture, qualification, experience,
      designation, department
    };

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // If experience is provided, convert to number
    if (updateData.experience !== undefined) {
      updateData.experience = parseInt(updateData.experience) || 0;
    }

    const Staff = mongoose.model('Staff');
    const staff = await Staff.findByIdAndUpdate(req.params.id, updateData, { new: true });

    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    res.json(staff);
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
    console.log('[StaffAttendance API] Fetching all staff attendance');
    const attendance = await StaffAttendance.find().sort({ date: -1 });
    console.log('[StaffAttendance API] Found', attendance.length, 'records');

    // Return as array of objects (not nested) to match what webapp expects
    const attendanceArray = attendance.map(att => ({
      staffId: att.staffId.toString(),
      date: att.date,
      status: att.status,
      checkInTime: att.checkInTime || '-',
      checkOutTime: att.checkOutTime || '-',
      reason: att.reason || ''
    }));

    console.log('[StaffAttendance API] Returning', attendanceArray.length, 'records');
    if (attendanceArray.length > 0) {
      console.log('[StaffAttendance API] Sample record:', attendanceArray[0]);
    }
    res.json(attendanceArray);
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

    // Resolve class identifier (supports both ObjectId and "name-section" format)
    const resolved = await resolveClassId(classId);
    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const attendance = await Attendance.find({ classId: resolved.classId, date })
      .populate('studentId', 'name rollNo admissionId');

    // Convert to object format { studentId: { status } }
    const attendanceObj = {};
    attendance.forEach(att => {
      if (att.studentId) {
        attendanceObj[att.studentId._id.toString()] = {
          status: att.status,
          markedBy: att.markedBy
        };
      }
    });

    res.json(attendanceObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark attendance for a class (POST version for staff app)
app.post('/api/attendance/class', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { classId, date, attendance } = req.body;

    // Validate required fields
    if (!classId || !date || !Array.isArray(attendance)) {
      return res.status(400).json({ error: 'classId, date, and attendance array are required' });
    }

    // Resolve class identifier (supports both ObjectId and "name-section" format like "2-B")
    const resolved = await resolveClassId(classId);
    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }
    const resolvedClassId = resolved.classId;

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
          classId: resolvedClassId,
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
      classId: resolvedClassId,
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

app.get('/api/attendance/history/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const { start, end } = req.query;

    let resolvedClassId = null;

    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(classId);
    if (isValidObjectId) {
      const classDoc = await Class.findById(classId);
      if (classDoc) {
        resolvedClassId = classDoc._id;
      } else {
        const resolved = await resolveClassId(classId);
        if (resolved) {
          resolvedClassId = resolved.classId;
        }
      }
    } else {
      const resolved = await resolveClassId(classId);
      if (resolved) {
        resolvedClassId = resolved.classId;
      }
    }

    if (!resolvedClassId) {
      return res.json([]);
    }

    let query = { classId: resolvedClassId };

    if (start && end) {
      query.date = { $gte: start, $lte: end };
    } else if (start) {
      query.date = { $gte: start };
    } else if (end) {
      query.date = { $lte: end };
    }

    const attendance = await Attendance.find(query)
      .populate('studentId', 'name rollNo admissionId')
      .sort({ date: -1 });

    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get attendance for a class on a specific date (MOBILE APP ROUTE - supports "name-section" format like "2-B")
// This route is specifically for the staff mobile app which uses human-readable class IDs
app.get('/api/attendance/:classId/:date', async (req, res) => {
  try {
    const { classId, date } = req.params;

    // Resolve class identifier (supports both ObjectId and "name-section" format)
    const resolved = await resolveClassId(classId);

    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const attendance = await Attendance.find({ classId: resolved.classId, date })
      .populate('studentId', 'name rollNo admissionId');

    // Return as array (for mobile app compatibility)
    const attendanceArray = attendance.map(att => ({
      studentId: att.studentId?._id,
      studentName: att.studentId?.name,
      rollNo: att.studentId?.rollNo,
      status: att.status,
      markedBy: att.markedBy
    }));

    res.json(attendanceArray);
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

    // Resolve class identifier (supports both ObjectId and "name-section" format like "2-B")
    const resolved = await resolveClassId(classId);
    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }
    const resolvedClassId = resolved.classId;

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
          classId: resolvedClassId,
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
      classId: resolvedClassId,
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

// Get attendance history for a student (MOBILE APP ROUTE)
app.get('/api/attendance/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { start, end } = req.query;

    let query = { studentId };

    // Apply date filters if provided
    if (start && end) {
      query.date = { $gte: start, $lte: end };
    } else if (start) {
      query.date = { $gte: start };
    } else if (end) {
      query.date = { $lte: end };
    }

    const attendance = await Attendance.find(query)
      .populate('studentId', 'name rollNo admissionId')
      .sort({ date: -1 });

    res.json(attendance);
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

    // Resolve class identifier (supports both ObjectId and "name-section" format)
    const resolved = await resolveClassId(classId);
    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const attendance = await Attendance.find({
      classId: resolved.classId,
      date: { $gte: startDate, $lte: endDate }
    }).populate('studentId', 'name rollNo admissionId');

    // Calculate attendance summary per student
    const summary = {};
    attendance.forEach(att => {
      if (!att.studentId) return; // Skip if student not found
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


// ============ EXAM ROUTES ============

// Get exams for a class (for staff mobile app)
app.get('/api/exams/class/:classId', async (req, res) => {
  try {
    const { classId } = req.params;

    // Resolve class identifier
    const resolved = await resolveClassId(classId);

    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const exams = await Exam.find({ classId: resolved.classId })
      .sort({ startDate: -1 });

    res.json(exams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get exams for a staff member (for staff mobile app - exams assigned to teacher's classes)
app.get('/api/exams/staff/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;

    // Get staff's assigned classes
    const staff = await Staff.findById(staffId);
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    // Get all class IDs from staff assignments
    const assignedClassIds = staff.assignedClasses || [];
    const teacherAssignmentClasses = (staff.teacherAssignments || []).flatMap(ta => ta.classes || []);
    const allClassIds = [...new Set([...assignedClassIds, ...teacherAssignmentClasses])];

    // Resolve each class ID to ObjectId
    const resolvedClassIds = [];
    for (const classId of allClassIds) {
      const resolved = await resolveClassId(classId.toString());
      if (resolved) {
        resolvedClassIds.push(resolved.classId);
      }
    }

    // Fetch exams for these classes
    const exams = await Exam.find({ classId: { $in: resolvedClassIds } })
      .sort({ startDate: -1 });

    res.json(exams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all exams
app.get('/api/exams', async (req, res) => {
  try {
    const { academicYear, classId, status } = req.query;
    const query = {};

    if (academicYear) query.academicYear = academicYear;
    if (classId) {
      const resolved = await resolveClassId(classId);
      if (resolved) query.classId = resolved.classId;
    }
    if (status) query.status = status;

    const exams = await Exam.find(query).sort({ startDate: -1, createdAt: -1 });

    // Get class names for all exams
    const classIds = [...new Set(exams.map(e => e.classId).filter(Boolean))];
    const classMap = new Map();
    for (const cId of classIds) {
      try {
        const cls = await Class.findById(cId);
        if (cls) {
          classMap.set(cId.toString(), cls.section ? `${cls.name}-${cls.section}` : cls.name);
        }
      } catch (e) {
        // Skip if class not found
      }
    }

    const formattedExams = exams.map(exam => ({
      ...exam.toObject(),
      id: exam._id,
      className: exam.classId ? classMap.get(exam.classId.toString()) : exam.classId
    }));

    res.json(formattedExams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get exam by ID
app.get('/api/exams/:id', async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    // Get class name for display
    let className = exam.classId;
    if (exam.classId) {
      try {
        const cls = await Class.findById(exam.classId);
        if (cls) {
          className = cls.section ? `${cls.name}-${cls.section}` : cls.name;
        }
      } catch (e) {
        // Keep original classId if class not found
      }
    }

    res.json({
      ...exam.toObject(),
      id: exam._id,
      className
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create exam
app.post('/api/exams', async (req, res) => {
  try {
    const { name, type, classId, subjectId, subjectName, academicYear, startDate, endDate, maxMarks, passingMarks, weightage, gradingType, instructions, createdBy } = req.body;

    // Resolve class ID
    let resolvedClassId = classId;
    if (classId) {
      const resolved = await resolveClassId(classId);
      if (resolved) resolvedClassId = resolved.classId;
    }

    const exam = new Exam({
      name,
      type,
      classId: resolvedClassId,
      subjectId,
      subjectName,
      academicYear: academicYear || '2024-25',
      startDate,
      endDate,
      maxMarks: maxMarks || 100,
      passingMarks: passingMarks || 35,
      weightage: weightage || 10,
      gradingType: gradingType || 'numerical',
      instructions,
      createdBy,
      status: 'scheduled'
    });

    await exam.save();
    res.status(201).json(exam);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update exam
app.put('/api/exams/:id', async (req, res) => {
  try {
    const { name, type, classId, subjectId, subjectName, academicYear, startDate, endDate, maxMarks, passingMarks, weightage, gradingType, instructions, status } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (classId !== undefined) {
      const resolved = await resolveClassId(classId);
      updateData.classId = resolved ? resolved.classId : classId;
    }
    if (subjectId !== undefined) updateData.subjectId = subjectId;
    if (subjectName !== undefined) updateData.subjectName = subjectName;
    if (academicYear !== undefined) updateData.academicYear = academicYear;
    if (startDate !== undefined) updateData.startDate = startDate;
    if (endDate !== undefined) updateData.endDate = endDate;
    if (maxMarks !== undefined) updateData.maxMarks = maxMarks;
    if (passingMarks !== undefined) updateData.passingMarks = passingMarks;
    if (weightage !== undefined) updateData.weightage = weightage;
    if (gradingType !== undefined) updateData.gradingType = gradingType;
    if (instructions !== undefined) updateData.instructions = instructions;
    if (status !== undefined) updateData.status = status;

    const exam = await Exam.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    res.json(exam);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete exam
app.delete('/api/exams/:id', async (req, res) => {
  try {
    const exam = await Exam.findByIdAndDelete(req.params.id);
    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    // Also delete associated results
    await Result.deleteMany({ examId: req.params.id });
    res.json({ message: 'Exam deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Publish exam results
app.post('/api/exams/:id/publish', async (req, res) => {
  try {
    const exam = await Exam.findByIdAndUpdate(
      req.params.id,
      { status: 'results_published', isPublished: true, publishedAt: new Date() },
      { new: true }
    );
    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    res.json(exam);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ RESULT ROUTES ============

// Get results by class and exam
app.get('/api/results/class/:classId/exam/:examId', async (req, res) => {
  try {
    const { classId, examId } = req.params;

    // Try to resolve class ID, but also try direct lookup if resolution fails
    let resolvedClassId = classId;
    const resolved = await resolveClassId(classId);
    if (resolved) {
      resolvedClassId = resolved.classId;
    }

    // Try both the resolved and original classId
    let results = await Result.find({ classId: resolvedClassId, examId });
    if (results.length === 0 && resolvedClassId !== classId) {
      results = await Result.find({ classId, examId });
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk create/update results
app.post('/api/results/bulk', async (req, res) => {
  try {
    const { results, examId, classId } = req.body;

    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'Results array is required' });
    }

    // Resolve class ID if provided
    let resolvedClassId = classId;
    if (classId) {
      const resolved = await resolveClassId(classId);
      if (resolved) resolvedClassId = resolved.classId;
    }

    const bulkOps = results.map(result => ({
      updateOne: {
        filter: { studentId: result.studentId, examId },
        update: {
          $set: {
            studentId: result.studentId,
            examId,
            classId: resolvedClassId,
            marksObtained: result.marksObtained || 0,
            remarks: result.remarks || '',
            enteredBy: result.enteredBy,
            enteredAt: new Date()
          }
        },
        upsert: true
      }
    }));

    await Result.bulkWrite(bulkOps);
    res.json({ message: 'Results saved successfully', count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ SUBJECTS ROUTES ============

// Get all subjects
app.get('/api/subjects', async (req, res) => {
  try {
    // Try to get subjects from SchoolSettings
    const settings = await SchoolSettings.findOne();
    if (settings && settings.subjects && settings.subjects.length > 0) {
      return res.json(settings.subjects.map((s, idx) => ({
        id: s._id || idx.toString(),
        name: s.name,
        code: s.code,
        description: s.description
      })));
    }

    // Fallback: Get unique subjects from all classes
    const classes = await Class.find({}, 'subjects');
    const subjectSet = new Set();
    classes.forEach(cls => {
      if (cls.subjects && Array.isArray(cls.subjects)) {
        cls.subjects.forEach(sub => {
          if (typeof sub === 'string') {
            subjectSet.add(sub);
          } else if (sub && sub.name) {
            subjectSet.add(sub.name);
          }
        });
      }
    });

    if (subjectSet.size > 0) {
      return res.json(Array.from(subjectSet).map((name, idx) => ({
        id: idx.toString(),
        name
      })));
    }

    // Default subjects if nothing found
    const defaultSubjects = [
      'Mathematics', 'English', 'Science', 'Social Studies', 'Hindi',
      'Physics', 'Chemistry', 'Biology', 'Computer Science', 'History',
      'Geography', 'Economics', 'Accountancy', 'Business Studies'
    ];
    res.json(defaultSubjects.map((name, idx) => ({
      id: idx.toString(),
      name
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ PUBLIC CLASS ROUTES ============

// Get all classes (public - for dropdowns)
app.get('/api/classes/public', async (req, res) => {
  try {
    const classes = await Class.find({}).sort({ name: 1, section: 1 });
    const formatted = classes.map(c => ({
      id: c._id,
      name: c.name,
      section: c.section,
      displayName: c.section ? `${c.name}-${c.section}` : c.name
    }));
    res.json(formatted);
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
      const studentCount = await Student.countDocuments({ classId: c._id, status: 'active', isDeleted: { $ne: true } });
      return {
        id: c._id.toString(), name: c.name, section: c.section, subjects: c.subjects, // FIX: id as string
        classTeacherId: c.classTeacherId?._id?.toString(), classTeacherName: c.classTeacherId?.name,
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
    // Resolve class identifier (supports both ObjectId and "name-section" format like "2-B")
    const resolved = await resolveClassId(req.params.id);

    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const cls = await Class.findById(resolved.classId).populate('classTeacherId', 'name');
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

    // VALIDATION: Check if teacher is already assigned to another class
    if (classTeacherId !== null && classTeacherId !== undefined && classTeacherId !== '') {
      const existingClass = await Class.findOne({
        classTeacherId: classTeacherId
      });

      if (existingClass) {
        const teacher = await Staff.findById(classTeacherId);
        return res.status(400).json({
          error: 'Teacher is already assigned as class teacher to another class',
          teacherName: teacher?.name || 'Unknown',
          teacherCode: teacher?.code || 'Unknown',
          existingClass: {
            id: existingClass._id,
            name: existingClass.name,
            section: existingClass.section
          },
          message: `${teacher?.name || 'Teacher'} is already assigned to ${existingClass.name} ${existingClass.section}. Please unassign them first.`
        });
      }
    }

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

// Update class teacher for a class (MUST be before /:id route)
app.put('/api/classes/:id/class-teacher', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { classTeacherId } = req.body;

    // Find the class
    const cls = await Class.findById(req.params.id);
    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }

    let teacher = null;

    // Only validate teacher if classTeacherId is provided (not null/undefined)
    if (classTeacherId !== null && classTeacherId !== undefined && classTeacherId !== '') {
      teacher = await Staff.findById(classTeacherId);
      if (!teacher) {
        return res.status(404).json({ error: 'Teacher not found' });
      }

      // VALIDATION: Check if teacher is already assigned to another class
      const existingClass = await Class.findOne({
        classTeacherId: classTeacherId,
        _id: { $ne: req.params.id } // Exclude current class
      });

      if (existingClass) {
        return res.status(400).json({
          error: 'Teacher is already assigned as class teacher to another class',
          teacherName: teacher.name,
          teacherCode: teacher.code,
          existingClass: {
            id: existingClass._id,
            name: existingClass.name,
            section: existingClass.section
          },
          message: `${teacher.name} (${teacher.code}) is already assigned to ${existingClass.name} ${existingClass.section}. Please unassign them first.`
        });
      }
    }

    // Update only the classTeacherId field (allows null for unassigning)
    cls.classTeacherId = classTeacherId || null;
    await cls.save();

    // Broadcast class update with teacher details
    io.emit('class_updated', {
      classId: cls._id.toString(),
      name: cls.name,
      section: cls.section,
      classTeacherId: cls.classTeacherId,
      teacher: teacher?.name || null,
      teacherPhoto: teacher?.picture || teacher?.photoURL || teacher?.photo || null,
      timestamp: new Date()
    });

    res.json({
      id: cls._id,
      ...cls.toObject(),
      teacherName: teacher?.name || null,
      teacherPhoto: teacher?.picture || teacher?.photoURL || teacher?.photo || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/classes/:id', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { name, section, classTeacherId, subjects, academicYear } = req.body;

    // VALIDATION: Check if teacher is already assigned to another class
    if (classTeacherId !== null && classTeacherId !== undefined && classTeacherId !== '') {
      const existingClass = await Class.findOne({
        classTeacherId: classTeacherId,
        _id: { $ne: req.params.id } // Exclude current class
      });

      if (existingClass) {
        const teacher = await Staff.findById(classTeacherId);
        return res.status(400).json({
          error: 'Teacher is already assigned as class teacher to another class',
          teacherName: teacher?.name || 'Unknown',
          teacherCode: teacher?.code || 'Unknown',
          existingClass: {
            id: existingClass._id,
            name: existingClass.name,
            section: existingClass.section
          },
          message: `${teacher?.name || 'Teacher'} is already assigned to ${existingClass.name} ${existingClass.section}. Please unassign them first.`
        });
      }
    }

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

    res.json({ id: cls._id.toString(), ...cls.toObject() }); // FIX: id as string
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
    // Resolve class identifier (supports both ObjectId and "name-section" format like "2-B")
    const resolved = await resolveClassId(req.params.id);

    if (!resolved) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // FIXED: Filter by status='active' AND isDeleted!=true for consistency across all views
    const students = await Student.find({
      classId: resolved.classId,
      status: 'active',
      isDeleted: { $ne: true }
    }).sort({ rollNo: 1 });
    res.json(students.map(s => ({ id: s._id, ...s.toObject() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/classes/:id/next-roll-number', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const rollNumber = await getNextRollNumber(req.params.id);
    res.json({ rollNumber });
  } catch (error) {
    console.error('Error getting next roll number:', error);
    res.status(500).json({ error: 'Failed to get next roll number' });
  }
});

// Check if section has reached capacity
app.get('/api/classes/:id/capacity', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const classData = await Class.findById(req.params.id);

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Count current students in this class
    const currentStudents = await Student.countDocuments({
      classId: req.params.id,
      status: { $ne: 'inactive' }
    });

    const capacity = classData.strengthLimit?.current || classData.strengthLimit?.default || 40;
    const isFull = currentStudents >= capacity;

    res.json({
      classId: classData._id,
      name: classData.name,
      section: classData.section,
      current: currentStudents,
      capacity: capacity,
      available: capacity - currentStudents,
      isFull: isFull
    });
  } catch (error) {
    console.error('Error checking class capacity:', error);
    res.status(500).json({ error: 'Failed to check capacity' });
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

    // Build query - EXCLUDE deleted students (handle legacy students without isDeleted field)
    // Using $ne: true to match both isDeleted: false AND missing/undefined isDeleted
    const query = classId ? { classId, isDeleted: { $ne: true } } : { isDeleted: { $ne: true } };

    // Get total count for pagination
    const total = await Student.countDocuments(query);

    // Fetch paginated students
    const students = await Student.find(query)
      .populate('classId', 'name section')
      .sort({ rollNo: 1 })
      .limit(limitNum)
      .skip(skip);

    // FIXED: Fetch fee structures for current academic year (2024-25) to get correct feeStatus
    const StudentFeeStructure = (await import('./models/StudentFeeStructure.js')).default;
    const studentIds = students.map(s => s._id);

    const feeStructures = await StudentFeeStructure.find({
      studentId: { $in: studentIds },
      academicYear: '2024-25'  // Use current academic year
    });

    // Create a map for quick lookup: studentId -> overallStatus
    const feeStatusMap = {};
    feeStructures.forEach(fs => {
      // Convert studentId to string for consistent matching
      const studentIdStr = fs.studentId.toString();
      feeStatusMap[studentIdStr] = fs.overallStatus || 'pending';
    });

    const formatted = students.map(s => {
      const classInfo = s.classId ? `${s.classId.name.replace('Class ', '')}-${s.classId.section}` : null;

      // Use current academic year's feeStatus from StudentFeeStructure, fallback to stored value
      const currentFeeStatus = feeStatusMap[s._id.toString()] || s.feeStatus;

      return {
        id: s._id,
        name: s.name,
        admissionId: s.admissionId,
        academicYear: s.academicYear,
        rollNo: s.rollNo,
        classId: s.classId?._id?.toString() || s.classId?.toString(), // FIX: Always return string for frontend comparison
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

        // Status - FIXED: Use current academic year's feeStatus
        feeStatus: currentFeeStatus,
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

// Get student results
app.get('/api/students/:id/results', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const { academicYear } = req.query;
    const query = {
      studentId: req.params.id,
      isPublished: true  // Only show published results
    };

    if (academicYear) {
      query.academicYear = academicYear;
    }

    const results = await Result.find(query)
      .populate('examId', 'name type startDate endDate')
      .populate('marks.subjectId', 'name')
      .sort({ createdAt: -1 });

    console.log(`📊 Found ${results.length} results for student ${req.params.id}`);
    res.json(results);
  } catch (error) {
    console.error('Error fetching student results:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get student remarks
app.get('/api/students/:id/remarks', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const { category } = req.query;
    const query = { studentId: req.params.id };

    if (category && category !== 'all') {
      query.category = category;
    }

    const remarks = await Remark.find(query)
      .populate('authorId', 'name email')
      .sort({ date: -1 });

    console.log(`💬 Found ${remarks.length} remarks for student ${req.params.id}`);
    res.json(remarks);
  } catch (error) {
    console.error('Error fetching student remarks:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create student remark
app.post('/api/students/:id/remarks', authenticate, checkPermission('students', 'edit'), async (req, res) => {
  try {
    const { title, description, category, sentToParent } = req.body;

    const remark = new Remark({
      studentId: req.params.id,
      title,
      description,
      category: category || 'general',
      authorId: req.user.userId,
      authorName: req.user.name,
      sentToParent: sentToParent || false,
      sentDate: sentToParent ? new Date() : null
    });

    await remark.save();

    // Populate author details before sending response
    await remark.populate('authorId', 'name email');

    console.log(`✅ Remark created for student ${req.params.id} by ${req.user.name}`);
    res.status(201).json(remark);
  } catch (error) {
    console.error('Error creating student remark:', error);
    res.status(500).json({ error: error.message });
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

    // Auto-create parent accounts for the new student
    try {
      const { createOrUpdateParentAccount } = await import('./utils/parentAccountHelper.js');
      await createOrUpdateParentAccount(student);
    } catch (parentError) {
      console.error('⚠️ Error auto-creating parent accounts:', parentError);
    }

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

    // Emit socket event for real-time updates
    io.emit('student_created', {
      id: populatedStudent._id,
      name: populatedStudent.name,
      admissionId: populatedStudent.admissionId,
      class: classInfo,
      timestamp: new Date()
    });

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

    // Format class field for frontend
    const classFormatted = student.classId
      ? `${student.classId.name.replace('Class ', '')}-${student.classId.section}`
      : student.class || null;

    res.json({
      id: student._id,
      ...student.toObject(),
      class: classFormatted
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/students/:id', authenticate, checkPermission('students', 'delete'), async (req, res) => {
  try {
    console.log('🗑️ Soft deleting student:', req.params.id);

    // Use findOneAndUpdate for atomic operation - faster than find + save
    const student = await Student.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user.id
      },
      { new: true }
    ).lean();

    if (!student) {
      return res.status(404).json({ error: 'Student not found or already deleted' });
    }

    // Calculate expiration date (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Create trash item record with minimal data (exclude large arrays)
    const trashItem = await TrashItem.create({
      itemType: 'Student',
      itemId: student._id,
      itemName: student.name,
      deletedBy: req.user.id,
      deletedAt: new Date(),
      expiresAt: expiresAt,
      // Store minimal original data - exclude large arrays that slow down restore
      originalData: {
        _id: student._id,
        name: student.name,
        admissionId: student.admissionId,
        classId: student.classId,
        status: student.status,
        // Don't store full document - can be fetched from backup if needed
      },
      deletionContext: {
        classId: student.classId
      }
    });

    console.log('✅ Student soft deleted successfully, expires on:', expiresAt);

    res.json({
      success: true,
      message: 'Student moved to trash',
      expiresAt: expiresAt,
      trashItemId: trashItem._id
    });
  } catch (err) {
    console.error('❌ Error soft deleting student:', err);
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

// ============ CLASS TEACHER VALIDATION ENDPOINT ============
// Check for duplicate class teacher assignments
app.get('/api/validation/class-teachers/check-duplicates', authenticate, async (req, res) => {
  try {
    console.log('🔍 Checking for duplicate class teacher assignments...');

    // Find all classes with class teachers
    const classesWithTeachers = await Class.find({
      classTeacherId: { $exists: true, $ne: null }
    }).populate('classTeacherId', 'name code');

    // Group classes by teacher
    const teacherMap = new Map();
    classesWithTeachers.forEach(cls => {
      const teacherId = cls.classTeacherId._id.toString();
      if (!teacherMap.has(teacherId)) {
        teacherMap.set(teacherId, {
          teacher: {
            id: cls.classTeacherId._id,
            name: cls.classTeacherId.name,
            code: cls.classTeacherId.code
          },
          classes: []
        });
      }
      teacherMap.get(teacherId).classes.push({
        classId: cls._id,
        className: `${cls.name} ${cls.section}`,
        createdAt: cls.createdAt,
        updatedAt: cls.updatedAt
      });
    });

    // Identify violations (teachers with multiple classes)
    const violations = [];
    teacherMap.forEach((data, teacherId) => {
      if (data.classes.length > 1) {
        // Sort classes by updatedAt (most recent first)
        const sortedClasses = [...data.classes].sort((a, b) =>
          new Date(b.updatedAt) - new Date(a.updatedAt)
        );

        violations.push({
          teacherId,
          teacherName: data.teacher.name,
          teacherCode: data.teacher.code,
          classCount: data.classes.length,
          classes: sortedClasses.map(c => ({
            classId: c.classId,
            className: c.className,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt
          })),
          recommendedToKeep: sortedClasses[0].classId,
          recommendedToRemove: sortedClasses.slice(1).map(c => c.classId)
        });
      }
    });

    res.json({
      success: true,
      hasViolations: violations.length > 0,
      violationCount: violations.length,
      violations: violations,
      totalClassesWithTeachers: classesWithTeachers.length,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('❌ Error checking for duplicates:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ CLASS TEACHER CONSISTENCY VALIDATION ============
// Check consistency between staff.classTeacherOf and class.classTeacherId
app.get('/api/validation/class-teachers/check-consistency', authenticate, async (req, res) => {
  try {
    console.log('🔍 Checking consistency between staff.classTeacherOf and class.classTeacherId...');

    // Get all staff with isClassTeacher: true
    const staffWithClassTeacher = await Staff.find({ isClassTeacher: true });

    const inconsistencies = [];

    for (const staff of staffWithClassTeacher) {
      if (!staff.classTeacherOf) continue;

      // Parse classTeacherOf to find expected class
      const classMatch = staff.classTeacherOf.match(/Class\s*(\d+)[-\s]?([A-Z])?/i) ||
                        staff.classTeacherOf.match(/^(\d+)[-\s]?([A-Z])?$/i);
      
      if (!classMatch) continue;

      const className = `Class ${classMatch[1]}`;
      const section = classMatch[2] || 'A';

      // Find the class
      const targetClass = await Class.findOne({ name: className, section });
      if (!targetClass) continue;

      // Check if classTeacherId matches
      const expectedTeacherId = staff._id.toString();
      const actualTeacherId = targetClass.classTeacherId ? targetClass.classTeacherId.toString() : null;

      if (actualTeacherId !== expectedTeacherId) {
        inconsistencies.push({
          staffId: staff._id,
          staffName: staff.name,
          staffCode: staff.code,
          classTeacherOf: staff.classTeacherOf,
          expectedClassId: targetClass._id,
          actualClassTeacherId: actualTeacherId,
          status: actualTeacherId ? 'mismatch' : 'unassigned'
        });
      }
    }

    // Also check for classes with classTeacherId but staff.isClassTeacher is false
    const classesWithTeachers = await Class.find({ 
      classTeacherId: { $exists: true, $ne: null } 
    });

    for (const cls of classesWithTeachers) {
      const staff = await Staff.findById(cls.classTeacherId);
      if (staff && !staff.isClassTeacher) {
        inconsistencies.push({
          staffId: staff._id,
          staffName: staff.name,
          staffCode: staff.code,
          classTeacherOf: staff.classTeacherOf,
          classId: cls._id,
          className: `${cls.name} ${cls.section}`,
          isClassTeacher: staff.isClassTeacher,
          status: 'isClassTeacher_false'
        });
      }
    }

    res.json({
      success: true,
      hasInconsistencies: inconsistencies.length > 0,
      inconsistencyCount: inconsistencies.length,
      inconsistencies: inconsistencies,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('❌ Error checking consistency:', err);
    res.status(500).json({ error: err.message });
  }
});

// Fix duplicate class teacher assignments
app.post('/api/validation/class-teachers/fix-duplicates', authenticate, async (req, res) => {
  try {
    console.log('🔧 Fixing duplicate class teacher assignments...');

    // Find all classes with class teachers
    const classesWithTeachers = await Class.find({
      classTeacherId: { $exists: true, $ne: null }
    }).populate('classTeacherId', 'name code');

    // Group classes by teacher
    const teacherMap = new Map();
    classesWithTeachers.forEach(cls => {
      const teacherId = cls.classTeacherId._id.toString();
      if (!teacherMap.has(teacherId)) {
        teacherMap.set(teacherId, {
          teacher: {
            id: cls.classTeacherId._id,
            name: cls.classTeacherId.name,
            code: cls.classTeacherId.code
          },
          classes: []
        });
      }
      teacherMap.get(teacherId).classes.push({
        classId: cls._id,
        className: `${cls.name} ${cls.section}`,
        createdAt: cls.createdAt,
        updatedAt: cls.updatedAt
      });
    });

    // Identify and fix violations
    const fixes = [];
    teacherMap.forEach((data, teacherId) => {
      if (data.classes.length > 1) {
        // Sort classes by updatedAt (most recent first)
        const sortedClasses = [...data.classes].sort((a, b) =>
          new Date(b.updatedAt) - new Date(a.updatedAt)
        );

        const classToKeep = sortedClasses[0];
        const classesToRemove = sortedClasses.slice(1);

        fixes.push({
          teacherId,
          teacherName: data.teacher.name,
          teacherCode: data.teacher.code,
          classKept: classToKeep,
          classesRemoved: classesToRemove
        });
      }
    });

    // Apply fixes
    const fixResults = [];
    for (const fix of fixes) {
      const removedClassIds = [];

      for (const classToRemove of fix.classesRemoved) {
        await Class.findByIdAndUpdate(classToRemove.classId, {
          $unset: { classTeacherId: 1 }
        });
        removedClassIds.push(classToRemove.classId.toString());
      }

      fixResults.push({
        teacherName: fix.teacherName,
        teacherCode: fix.teacherCode,
        classKept: {
          classId: fix.classKept.classId.toString(),
          className: fix.classKept.className
        },
        classesRemoved: fix.classesRemoved.map(c => ({
          classId: c.classId.toString(),
          className: c.className
        }))
      });
    }

    res.json({
      success: true,
      message: `Fixed ${fixes.length} duplicate class teacher assignments`,
      fixesApplied: fixResults.length,
      details: fixResults,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('❌ Error fixing duplicates:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ START SERVER ============
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
