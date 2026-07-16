import express from 'express';
import Visitor from '../models/Visitor.js';
import { Student } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  createVisitorSchema,
  updateVisitorSchema,
  checkOutVisitorSchema,
} from '../validators/frontDeskSchema.js';

const router = express.Router();
router.use(authenticate);

const schoolQuery = (req, extra = {}) => buildSchoolScopedQuery(req.user?.schoolId, extra);

/**
 * GET /api/visitors
 * Get all visitors with optional filters
 * Query params: status (active/all/today), purpose, startDate, endDate, search
 */
router.get('/', checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const { status, purpose, startDate, endDate, search } = req.query;

    // Build query scoped to school
    const query = schoolQuery(req);

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
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { whomToMeet: searchRegex },
      ];
    }

    // Execute query with populate
    const visitors = await Visitor.find(query)
      .sort({ checkInTime: -1 })
      .populate('checkedInBy', 'name code')
      .populate('checkedOutBy', 'name code')
      .populate('studentId', 'name admissionId rollNo');

    res.json({
      success: true,
      data: visitors,
      count: visitors.length,
    });
  } catch (error) {
    console.error('Get visitors error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: req.t('common:routes.failedToFetchVisitors'),
    });
  }
});

/**
 * GET /api/visitors/active
 * Get all active (checked-in) visitors
 */
router.get('/active', checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const visitors = await Visitor.getActiveVisitors(req.user.schoolId);
    res.json({
      success: true,
      data: visitors,
      count: visitors.length,
    });
  } catch (error) {
    console.error('Get active visitors error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: req.t('common:routes.failedToFetchActiveVisitors'),
    });
  }
});

/**
 * GET /api/visitors/today
 * Get today's visitors
 */
router.get('/today', checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const visitors = await Visitor.getTodaysVisitors(req.user.schoolId);
    res.json({
      success: true,
      data: visitors,
      count: visitors.length,
    });
  } catch (error) {
    console.error("Get today's visitors error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: req.t('common:routes.failedToFetchTodaySVisitors'),
    });
  }
});

/**
 * GET /api/visitors/search?q=
 * Search visitors by name, phone, email, or whom to meet
 */
router.get('/search', checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.searchQueryMustBeAtLeast2Characters'),
      });
    }

    const visitors = await Visitor.searchVisitors(q.trim(), req.user.schoolId);
    res.json({
      success: true,
      data: visitors,
      count: visitors.length,
    });
  } catch (error) {
    console.error('Search visitors error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: req.t('common:routes.failedToSearchVisitors'),
    });
  }
});

/**
 * GET /api/visitors/parents/search?q=
 * Search parents from student database
 */
router.get('/parents/search', checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.searchQueryMustBeAtLeast2Characters'),
      });
    }

    const searchRegex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    // Search in parents array of students (scoped to school)
    const students = await Student.find({
      schoolId: req.user.schoolId,
      isDeleted: { $ne: true },
      'parents.name': searchRegex,
    })
      .select('name admissionId parents classId')
      .populate('classId', 'name section')
      .limit(20);

    // Format results
    const parents = students.map((student) => {
      const firstParent = student.parents?.[0];
      return {
        studentId: student._id,
        studentName: student.name,
        admissionId: student.admissionId,
        parentName: firstParent?.name,
        parentPhone: firstParent?.phone,
        parentEmail: firstParent?.email,
        class: student.classId?.name,
        section: student.classId?.section,
      };
    });

    res.json({
      success: true,
      data: parents,
      count: parents.length,
    });
  } catch (error) {
    console.error('Search parents error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: req.t('common:routes.failedToSearchParents'),
    });
  }
});

/**
 * GET /api/visitors/:id
 * Get single visitor by ID
 */
router.get('/:id', checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const visitor = await Visitor.findOne(schoolQuery(req, { _id: req.params.id }))
      .populate('checkedInBy', 'name code phone')
      .populate('checkedOutBy', 'name code phone')
      .populate('studentId', 'name admissionId rollNo classId')
      .populate('gatePassId')
      .populate('appointmentId')
      .populate('admissionId');

    if (!visitor) {
      return res.status(404).json({
        success: false,
        error: req.t('common:routes.visitorNotFound'),
      });
    }

    res.json({
      success: true,
      data: visitor,
    });
  } catch (error) {
    console.error('Get visitor error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: req.t('common:routes.failedToFetchVisitor'),
    });
  }
});

/**
 * POST /api/visitors
 * Create new visitor (check-in)
 */
router.post(
  '/',
  checkPermission('front-desk', 'create'),
  validateZod(createVisitorSchema),
  async (req, res) => {
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
        notes,
      } = req.body;

      // Prepare visitor data — always set schoolId from authenticated user
      const visitorData = {
        schoolId: req.user.schoolId,
        name,
        phone,
        email,
        photoUrl,
        purpose,
        whomToMeet,
        department,
        checkedInBy: req.user.id,
        notes,
      };

      // Add purpose-specific fields
      if (purpose === 'PARENT_MEETING' && studentId) {
        const student = await Student.findOne({ _id: studentId, schoolId: req.user.schoolId });
        if (student) {
          visitorData.studentId = studentId;
          visitorData.studentName = student.name;
          visitorData.parentMapping = true;
        }
      }

      if (purpose === 'STUDENT_PICKUP_DROP_OFF' && studentId) {
        const student = await Student.findOne({ _id: studentId, schoolId: req.user.schoolId });
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
        message: req.t('common:routes.visitorCheckedInSuccessfully'),
      });
    } catch (error) {
      console.error('Create visitor error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: req.t('common:routes.failedToCheckInVisitor'),
      });
    }
  }
);

/**
 * PUT /api/visitors/:id
 * Update visitor
 */
router.put(
  '/:id',
  checkPermission('front-desk', 'edit'),
  validateZod(updateVisitorSchema),
  async (req, res) => {
    try {
      const visitor = await Visitor.findOne(schoolQuery(req, { _id: req.params.id }));

      if (!visitor) {
        return res.status(404).json({
          success: false,
          error: req.t('common:routes.visitorNotFound'),
        });
      }

      // Don't allow updating checked-out visitors
      if (visitor.status === 'CHECKED_OUT') {
        return res.status(400).json({
          success: false,
          error: req.t('common:routes.cannotUpdateCheckedOutVisitor'),
        });
      }

      const { name, phone, email, photoUrl, whomToMeet, department, notes } = req.body;

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
        message: req.t('common:routes.visitorUpdatedSuccessfully'),
      });
    } catch (error) {
      console.error('Update visitor error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: req.t('common:routes.failedToUpdateVisitor'),
      });
    }
  }
);

/**
 * POST /api/visitors/:id/check-out
 * Check-out visitor
 */
router.post(
  '/:id/check-out',
  checkPermission('front-desk', 'edit'),
  validateZod(checkOutVisitorSchema),
  async (req, res) => {
    try {
      const visitor = await Visitor.findOne(schoolQuery(req, { _id: req.params.id }));

      if (!visitor) {
        return res.status(404).json({
          success: false,
          error: req.t('common:routes.visitorNotFound'),
        });
      }

      // Check if already checked out
      if (visitor.status === 'CHECKED_OUT') {
        return res.status(400).json({
          success: false,
          error: req.t('common:routes.visitorAlreadyCheckedOut'),
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
        message: req.t('common:routes.visitorCheckedOutSuccessfully'),
      });
    } catch (error) {
      console.error('Check-out visitor error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: req.t('common:routes.failedToCheckOutVisitor'),
      });
    }
  }
);

/**
 * DELETE /api/visitors/:id
 * Delete visitor
 */
router.delete('/:id', checkPermission('front-desk', 'delete'), async (req, res) => {
  try {
    const visitor = await Visitor.findOne(schoolQuery(req, { _id: req.params.id }));

    if (!visitor) {
      return res.status(404).json({
        success: false,
        error: req.t('common:routes.visitorNotFound'),
      });
    }

    await Visitor.deleteOne({ _id: req.params.id, schoolId: req.user.schoolId });

    res.json({
      success: true,
      message: req.t('common:routes.visitorDeletedSuccessfully'),
    });
  } catch (error) {
    console.error('Delete visitor error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: req.t('common:routes.failedToDeleteVisitor'),
    });
  }
});

/**
 * GET /api/visitors/:id/badge
 * Generate visitor badge (PDF)
 */
router.get('/:id/badge', checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const visitor = await Visitor.findOne(schoolQuery(req, { _id: req.params.id })).populate(
      'studentId',
      'name admissionId'
    );

    if (!visitor) {
      return res.status(404).json({
        success: false,
        error: req.t('common:routes.visitorNotFound'),
      });
    }

    res.json({
      success: true,
      data: {
        visitor: visitor,
        badgeData: {
          name: visitor.name,
          purpose: visitor.purpose.replace(/_/g, ' '),
          checkInTime: visitor.checkInTime,
          whomToMeet: visitor.whomToMeet,
          studentName: visitor.studentName,
        },
      },
      message: req.t('common:routes.badgeDataRetrievedPdfGenerationToBeImplemented'),
    });
  } catch (error) {
    console.error('Generate badge error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: req.t('common:routes.failedToGenerateBadge'),
    });
  }
});

export default router;
