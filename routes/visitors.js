import express from 'express';
import Visitor from '../models/Visitor.js';
import { Student } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

// Middleware to attach Staff model to req.app.locals if not already there
router.use((req, res, next) => {
  if (!req.app.locals.Staff) {
    req.app.locals.Staff = require('../database.js').Staff;
  }
  next();
});

/**
 * GET /api/visitors
 * Get all visitors with optional filters
 * Query params: status (active/all/today), purpose, startDate, endDate, search
 */
router.get('/', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const { status, purpose, startDate, endDate, search } = req.query;

    // Build query
    const query = {};

    // Status filter
    if (status === 'active') {
      query.status = 'ACTIVE';
    } else if (status === 'checked-out') {
      query.status = 'CHECKED_OUT';
    }

    // Purpose filter
    if (purpose) {
      query.purpose = purpose;
    }

    // Date range filter
    if (startDate || endDate) {
      query.checkInTime = {};
      if (startDate) {
        query.checkInTime.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        query.checkInTime.$lte = endDateTime;
      }
    }

    // Today's visitors
    if (status === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      query.checkInTime = { $gte: startOfDay, $lte: endOfDay };
    }

    // Search filter
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { whomToMeet: searchRegex }
      ];
    }

    // Execute query with populate
    let visitorsQuery = Visitor.find(query)
      .sort({ checkInTime: -1 })
      .populate('checkedInBy', 'name code')
      .populate('checkedOutBy', 'name code')
      .populate('studentId', 'name admissionId rollNo');

    const visitors = await visitorsQuery;

    res.json({
      success: true,
      data: visitors,
      count: visitors.length
    });
  } catch (error) {
    console.error('❌ Get visitors error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch visitors'
    });
  }
});

/**
 * GET /api/visitors/active
 * Get all active (checked-in) visitors
 */
router.get('/active', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const visitors = await Visitor.getActiveVisitors();
    res.json({
      success: true,
      data: visitors,
      count: visitors.length
    });
  } catch (error) {
    console.error('❌ Get active visitors error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch active visitors'
    });
  }
});

/**
 * GET /api/visitors/today
 * Get today's visitors
 */
router.get('/today', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const visitors = await Visitor.getTodaysVisitors();
    res.json({
      success: true,
      data: visitors,
      count: visitors.length
    });
  } catch (error) {
    console.error('❌ Get today\'s visitors error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch today\'s visitors'
    });
  }
});

/**
 * GET /api/visitors/search?q=
 * Search visitors by name, phone, email, or whom to meet
 */
router.get('/search', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters'
      });
    }

    const visitors = await Visitor.searchVisitors(q.trim());
    res.json({
      success: true,
      data: visitors,
      count: visitors.length
    });
  } catch (error) {
    console.error('❌ Search visitors error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to search visitors'
    });
  }
});

/**
 * GET /api/visitors/parents/search?q=
 * Search parents from student database
 */
router.get('/parents/search', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters'
      });
    }

    const searchRegex = new RegExp(q.trim(), 'i');

    // Search in parent fields of students
    const students = await Student.find({
      $or: [
        { parentName: searchRegex },
        { parentPhone: searchRegex },
        { parentEmail: searchRegex }
      ]
    })
      .select('name admissionId parentName parentPhone parentEmail classId')
      .populate('classId', 'name section')
      .limit(20);

    // Format results
    const parents = students.map(student => ({
      studentId: student._id,
      studentName: student.name,
      admissionId: student.admissionId,
      parentName: student.parentName,
      parentPhone: student.parentPhone,
      parentEmail: student.parentEmail,
      class: student.classId?.name,
      section: student.classId?.section
    }));

    res.json({
      success: true,
      data: parents,
      count: parents.length
    });
  } catch (error) {
    console.error('❌ Search parents error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to search parents'
    });
  }
});

/**
 * GET /api/visitors/:id
 * Get single visitor by ID
 */
router.get('/:id', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id)
      .populate('checkedInBy', 'name code phone')
      .populate('checkedOutBy', 'name code phone')
      .populate('studentId', 'name admissionId rollNo classId')
      .populate('gatePassId')
      .populate('appointmentId')
      .populate('admissionId');

    if (!visitor) {
      return res.status(404).json({
        success: false,
        error: 'Visitor not found'
      });
    }

    res.json({
      success: true,
      data: visitor
    });
  } catch (error) {
    console.error('❌ Get visitor error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch visitor'
    });
  }
});

/**
 * POST /api/visitors
 * Create new visitor (check-in)
 */
router.post('/', authenticate, checkPermission('front-office', 'create'), async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      photoUrl,
      purpose,
      whomToMeet,
      department,
      studentId,
      gatePassRequired,
      appointmentRequired,
      admissionInquiry,
      companyName,
      deliveryPerson,
      otherPurpose,
      itemsDeclared,
      notes
    } = req.body;

    // Validation
    if (!name || !phone || !purpose) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Name, phone, and purpose are required'
      });
    }

    // Validate phone format (basic)
    const phoneRegex = /^[0-9+\-\s()]{10,20}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format'
      });
    }

    // Prepare visitor data
    const visitorData = {
      name,
      phone,
      email,
      photoUrl,
      purpose,
      whomToMeet,
      department,
      checkedInBy: req.user.id,
      notes
    };

    // Add purpose-specific fields
    if (purpose === 'PARENT_MEETING' && studentId) {
      const student = await Student.findById(studentId);
      if (student) {
        visitorData.studentId = studentId;
        visitorData.studentName = student.name;
        visitorData.parentMapping = true;
      }
    }

    if (purpose === 'STUDENT_PICKUP_DROP_OFF' && studentId) {
      const student = await Student.findById(studentId);
      if (student) {
        visitorData.studentId = studentId;
        visitorData.studentName = student.name;
        visitorData.gatePassRequired = gatePassRequired || false;
      }
    }

    if (purpose === 'OFFICIAL_BUSINESS' || purpose === 'VOLUNTEER_EVENT') {
      visitorData.appointmentRequired = appointmentRequired || false;
    }

    if (purpose === 'SCHOOL_VISIT_INQUIRY') {
      visitorData.admissionInquiry = admissionInquiry || false;
    }

    if (purpose === 'DELIVERY_VENDOR') {
      visitorData.companyName = companyName;
      visitorData.deliveryPerson = deliveryPerson || name;
    }

    if (purpose === 'OTHER') {
      visitorData.otherPurpose = otherPurpose || '';
    }

    if (itemsDeclared) {
      visitorData.itemsDeclared = itemsDeclared;
    }

    // Create visitor
    const visitor = await Visitor.create(visitorData);

    // Populate for response
    await visitor.populate('checkedInBy', 'name code');
    if (visitor.studentId) {
      await visitor.populate('studentId', 'name admissionId rollNo');
    }

    res.status(201).json({
      success: true,
      data: visitor,
      message: 'Visitor checked in successfully'
    });
  } catch (error) {
    console.error('❌ Create visitor error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to check in visitor'
    });
  }
});

/**
 * PUT /api/visitors/:id
 * Update visitor
 */
router.put('/:id', authenticate, checkPermission('front-office', 'edit'), async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id);

    if (!visitor) {
      return res.status(404).json({
        success: false,
        error: 'Visitor not found'
      });
    }

    // Don't allow updating checked-out visitors
    if (visitor.status === 'CHECKED_OUT') {
      return res.status(400).json({
        success: false,
        error: 'Cannot update checked-out visitor'
      });
    }

    const {
      name,
      phone,
      email,
      photoUrl,
      whomToMeet,
      department,
      notes
    } = req.body;

    // Update allowed fields
    if (name) visitor.name = name;
    if (phone) visitor.phone = phone;
    if (email !== undefined) visitor.email = email;
    if (photoUrl !== undefined) visitor.photoUrl = photoUrl;
    if (whomToMeet) visitor.whomToMeet = whomToMeet;
    if (department) visitor.department = department;
    if (notes !== undefined) {
      visitor.notes = notes;
    }

    await visitor.save();

    // Populate for response
    await visitor.populate('checkedInBy', 'name code');
    if (visitor.studentId) {
      await visitor.populate('studentId', 'name admissionId rollNo');
    }

    res.json({
      success: true,
      data: visitor,
      message: 'Visitor updated successfully'
    });
  } catch (error) {
    console.error('❌ Update visitor error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to update visitor'
    });
  }
});

/**
 * POST /api/visitors/:id/check-out
 * Check-out visitor
 */
router.post('/:id/check-out', authenticate, checkPermission('front-office', 'edit'), async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id);

    if (!visitor) {
      return res.status(404).json({
        success: false,
        error: 'Visitor not found'
      });
    }

    // Check if already checked out
    if (visitor.status === 'CHECKED_OUT') {
      return res.status(400).json({
        success: false,
        error: 'Visitor already checked out'
      });
    }

    const { notes } = req.body;

    // Check out visitor
    await visitor.checkOut(req.user.id, notes);

    // Populate for response
    await visitor.populate('checkedOutBy', 'name code');
    if (visitor.studentId) {
      await visitor.populate('studentId', 'name admissionId rollNo');
    }

    res.json({
      success: true,
      data: visitor,
      message: 'Visitor checked out successfully'
    });
  } catch (error) {
    console.error('❌ Check-out visitor error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to check out visitor'
    });
  }
});

/**
 * DELETE /api/visitors/:id
 * Delete visitor
 */
router.delete('/:id', authenticate, checkPermission('front-office', 'delete'), async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id);

    if (!visitor) {
      return res.status(404).json({
        success: false,
        error: 'Visitor not found'
      });
    }

    await Visitor.deleteOne({ _id: req.params.id });

    res.json({
      success: true,
      message: 'Visitor deleted successfully'
    });
  } catch (error) {
    console.error('❌ Delete visitor error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete visitor'
    });
  }
});

/**
 * GET /api/visitors/:id/badge
 * Generate visitor badge (PDF)
 * TODO: Implement PDF generation
 */
router.get('/:id/badge', authenticate, checkPermission('front-office', 'view'), async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id)
      .populate('studentId', 'name admissionId');

    if (!visitor) {
      return res.status(404).json({
        success: false,
        error: 'Visitor not found'
      });
    }

    // TODO: Generate PDF badge
    // For now, return visitor data for badge generation
    res.json({
      success: true,
      data: {
        visitor: visitor,
        badgeData: {
          name: visitor.name,
          purpose: visitor.purpose.replace(/_/g, ' '),
          checkInTime: visitor.checkInTime,
          whomToMeet: visitor.whomToMeet,
          studentName: visitor.studentName
        }
      },
      message: 'Badge data retrieved. PDF generation to be implemented.'
    });
  } catch (error) {
    console.error('❌ Generate badge error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to generate badge'
    });
  }
});

export default router;
