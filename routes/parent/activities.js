import express from 'express';
import mongoose from 'mongoose';
import { Student } from '../../database.js';
import { validateParentChildAccess } from '../../middleware/parentAuth.js';
import { validateZod, zodSchemas } from '../../middleware/validation.js';
import TransportRoute from '../../models/TransportRoute.js';
import ParentFeedback from '../../models/ParentFeedback.js';
import TeacherRating from '../../models/TeacherRating.js';
import Homework from '../../models/Homework.js';
import StudentLeave from '../../models/StudentLeave.js';
import { leaveRequestSchema } from '../../validators/parentAuthSchema.js';
import { emitSocketEvent } from '../../utils/socketEmitter.js';
import { EVENTS } from '../../utils/socketEvents.js';
import { scopeBySchool, resolveRequestSchoolId } from './helpers.js';

const router = express.Router();

// Normalize :id → req.params.studentId for validateParentChildAccess
router.param('id', (req, res, next, id) => {
  req.params.studentId = id;
  next();
});

// GET /api/parent/students/:id/library
router.get('/students/:id/library', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = await resolveRequestSchoolId(req);

    const BookIssue = mongoose.models.BookIssue;
    if (!BookIssue) {
      return res.json({ success: true, data: { activeIssues: [], history: [] } });
    }

    const [activeIssues, history] = await Promise.all([
      BookIssue.find({
        schoolId,
        studentId: id,
        status: { $in: ['issued', 'overdue', 'reserved'] },
      })
        .populate('bookId', 'title isbn author category coverImageUrl')
        .sort({ issueDate: -1 })
        .lean(),
      BookIssue.find({ schoolId, studentId: id, status: 'returned' })
        .populate('bookId', 'title isbn author category coverImageUrl')
        .sort({ returnDate: -1 })
        .limit(20)
        .lean(),
    ]);

    const formatIssue = (issue) => ({
      id: issue._id.toString(),
      bookTitle: issue.bookTitle || issue.bookId?.title || '',
      bookIsbn: issue.bookIsbn || issue.bookId?.isbn || '',
      bookAuthor: issue.bookId?.author || '',
      bookCategory: issue.bookId?.category || '',
      coverImageUrl: issue.bookId?.coverImageUrl || null,
      issueDate: issue.issueDate,
      dueDate: issue.dueDate,
      returnDate: issue.returnDate || null,
      status: issue.status,
      fineAmount: issue.fineAmount || 0,
      finePaid: issue.finePaid || false,
    });

    res.json({
      success: true,
      data: {
        activeIssues: activeIssues.map(formatIssue),
        history: history.map(formatIssue),
      },
    });
  } catch (error) {
    console.error('GET /parent/students/:id/library error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch library data' });
  }
});

// GET /api/parent/students/:id/transport
router.get('/students/:id/transport', validateParentChildAccess, async (req, res) => {
  try {
    const studentId = req.params.id;
    const schoolId = await resolveRequestSchoolId(req);

    const route = await TransportRoute.findOne({
      schoolId,
      isDeleted: { $ne: true },
      'students.studentId': studentId,
    }).populate(
      'vehicleId',
      'registrationNumber make model capacity color driverId conductorId lastLocation lastGpsUpdate'
    );

    if (!route) {
      return res.json({ success: true, data: null });
    }

    const assignment = route.students.find((s) => s.studentId.toString() === studentId.toString());
    const stopInfo = assignment?.stopId
      ? route.stops.find((s) => s._id.toString() === assignment.stopId.toString())
      : null;

    res.json({
      success: true,
      data: {
        route: {
          id: route._id,
          routeName: route.routeName,
          routeNumber: route.routeNumber,
          academicYear: route.academicYear,
          stops: route.stops,
          status: route.status,
        },
        vehicle: route.vehicleId || null,
        assignment: {
          stopId: assignment?.stopId || null,
          stopName: stopInfo?.name || null,
          pickupTime: stopInfo?.pickupTime || null,
          dropTime: stopInfo?.dropTime || null,
          pickupActive: assignment?.pickupActive ?? true,
          dropActive: assignment?.dropActive ?? true,
        },
      },
    });
  } catch (error) {
    console.error('GET /parent/students/:id/transport error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transport data' });
  }
});

// POST /api/parent/feedback
router.post('/feedback', validateZod(zodSchemas.parentFeedbackCreate), async (req, res) => {
  try {
    const parent = req.parent;
    const schoolId = await resolveRequestSchoolId(req);
    const { studentId, category, subject, message } = req.body;

    const feedback = new ParentFeedback({
      schoolId,
      parentId: parent._id,
      studentId: studentId || null,
      category,
      subject,
      message,
      status: 'pending',
    });

    await feedback.save();

    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      data: { feedback },
    });
  } catch (error) {
    console.error('POST /parent/feedback error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to submit feedback' },
    });
  }
});

// GET /api/parent/feedback
router.get('/feedback', async (req, res) => {
  try {
    const parent = req.parent;
    const schoolId = await resolveRequestSchoolId(req);
    const { status } = req.query;

    const query = { schoolId, parentId: parent._id };
    if (status) query.status = status;

    const feedbacks = await ParentFeedback.find(query).sort({ createdAt: -1 }).lean();

    res.json({ success: true, data: { feedbacks } });
  } catch (error) {
    console.error('GET /parent/feedback error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch feedback' },
    });
  }
});

// GET /api/parent/students/:id/homework
router.get('/students/:id/homework', validateParentChildAccess, async (req, res) => {
  try {
    const { id: studentId } = req.params;
    const schoolId = await resolveRequestSchoolId(req);

    const student = await Student.findOne(scopeBySchool(schoolId, { _id: studentId }))
      .select('classId')
      .lean();

    if (!student) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found' } });
    }

    if (!student.classId) {
      return res.json({ success: true, data: { homework: [] } });
    }

    const studentObjectId = new mongoose.Types.ObjectId(studentId);

    // Show both active and completed homework so parents can review past submissions
    const homeworkList = await Homework.find(
      scopeBySchool(schoolId, {
        classId: student.classId,
        status: { $in: ['active', 'completed'] },
        sentToParents: true,
      }),
      {
        title: 1,
        description: 1,
        subject: 1,
        dueDate: 1,
        attachments: 1,
        status: 1,
        academicYear: 1,
        createdAt: 1,
        submissions: { $elemMatch: { studentId: studentObjectId } },
      }
    )
      .sort({ dueDate: 1 })
      .lean();

    const homework = homeworkList.map((hw) => {
      const submission = hw.submissions?.[0];
      let submissionStatus = 'pending';
      if (submission) {
        submissionStatus = submission.marks != null ? 'graded' : 'submitted';
      }
      const isOverdue = submissionStatus === 'pending' && new Date(hw.dueDate) < new Date();
      return {
        _id: hw._id,
        title: hw.title,
        description: hw.description,
        subject: hw.subject,
        dueDate: hw.dueDate,
        attachments: hw.attachments || [],
        academicYear: hw.academicYear,
        createdAt: hw.createdAt,
        submissionStatus,
        isOverdue,
        submission: submission
          ? {
              submittedAt: submission.submittedAt,
              remarks: submission.remarks,
              marks: submission.marks,
              feedback: submission.feedback,
              gradedAt: submission.gradedAt,
            }
          : null,
      };
    });

    res.json({ success: true, data: { homework } });
  } catch (error) {
    console.error('GET /parent/students/:id/homework error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch homework' },
    });
  }
});

// POST /api/parent/students/:id/homework/:homeworkId/submit
router.post(
  '/students/:id/homework/:homeworkId/submit',
  validateParentChildAccess,
  async (req, res) => {
    try {
      const { id: studentId, homeworkId } = req.params;
      const schoolId = await resolveRequestSchoolId(req);

      const parsed = zodSchemas.submitHomework.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid submission data',
            details: parsed.error.errors,
          },
        });
      }

      const { remarks, attachments } = parsed.data;

      const homework = await Homework.findOne(
        scopeBySchool(schoolId, { _id: homeworkId, status: 'active' })
      );
      if (!homework) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Homework not found or not active' },
        });
      }

      const existingIndex = homework.submissions.findIndex(
        (s) => s.studentId.toString() === studentId
      );

      if (existingIndex >= 0) {
        homework.submissions[existingIndex].remarks = remarks;
        homework.submissions[existingIndex].attachments = attachments || [];
        homework.submissions[existingIndex].submittedAt = new Date();
      } else {
        homework.submissions.push({
          studentId,
          remarks,
          attachments: attachments || [],
          submittedAt: new Date(),
        });
      }

      await homework.save();

      res.json({ success: true, data: { message: 'Homework submitted successfully' } });
    } catch (error) {
      console.error('POST /parent/students/:id/homework/:homeworkId/submit error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to submit homework' },
      });
    }
  }
);

// POST /api/parent/students/:id/leave
router.post('/students/:id/leave', validateParentChildAccess, async (req, res) => {
  try {
    const { id: studentId } = req.params;
    const parent = req.parent;
    const schoolId = await resolveRequestSchoolId(req);

    const parsed = leaveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid leave request',
          details: parsed.error.errors,
        },
      });
    }

    const { leaveType, reason, startDate, endDate } = parsed.data;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    const leave = new StudentLeave({
      schoolId,
      studentId,
      appliedByParentId: parent._id,
      leaveType,
      reason,
      startDate: start,
      endDate: end,
      days,
    });

    await leave.save();

    emitSocketEvent(EVENTS.LEAVE_APPLIED, {
      leaveId: leave._id.toString(),
      teacherId: studentId, // reuse field to identify subject; school dashboard listens for this
      leaveType,
      startDate: start,
      endDate: end,
      days,
    });

    res.status(201).json({ success: true, data: { leave } });
  } catch (error) {
    console.error('POST /parent/students/:id/leave error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to apply for leave' },
    });
  }
});

// GET /api/parent/students/:id/leaves
router.get('/students/:id/leaves', validateParentChildAccess, async (req, res) => {
  try {
    const { id: studentId } = req.params;
    const schoolId = await resolveRequestSchoolId(req);
    const { status } = req.query;

    const query = scopeBySchool(schoolId, { studentId });
    if (status) query.status = status;

    const leaves = await StudentLeave.find(query).sort({ appliedAt: -1 }).lean();

    res.json({ success: true, data: { leaves } });
  } catch (error) {
    console.error('GET /parent/students/:id/leaves error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch leave requests' },
    });
  }
});

// DELETE /api/parent/students/:id/leave/:leaveId
router.delete('/students/:id/leave/:leaveId', validateParentChildAccess, async (req, res) => {
  try {
    const { id: studentId, leaveId } = req.params;
    const parent = req.parent;
    const schoolId = await resolveRequestSchoolId(req);

    const leave = await StudentLeave.findOne(
      scopeBySchool(schoolId, {
        _id: leaveId,
        studentId,
        appliedByParentId: parent._id,
      })
    );

    if (!leave) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Leave request not found' } });
    }

    if (leave.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ACTION', message: 'Only pending leave requests can be cancelled' },
      });
    }

    leave.status = 'cancelled';
    await leave.save();

    emitSocketEvent(EVENTS.LEAVE_CANCELLED, {
      leaveId: leave._id.toString(),
      teacherId: studentId,
    });

    res.json({ success: true, message: 'Leave request cancelled successfully' });
  } catch (error) {
    console.error('DELETE /parent/students/:id/leave/:leaveId error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to cancel leave request' },
    });
  }
});

// POST /api/parent/teachers/:teacherId/rate — Submit or update a teacher rating
router.post(
  '/teachers/:teacherId/rate',
  validateZod(zodSchemas.teacherRatingCreate),
  async (req, res) => {
    try {
      const parent = req.parent;
      const { teacherId } = req.params;
      const schoolId = await resolveRequestSchoolId(req);
      const { studentId, rating, comment } = req.body;

      // Verify the student belongs to this parent
      const student = await Student.findOne(
        scopeBySchool(schoolId, {
          _id: studentId,
          $or: [
            { 'parentInfo.fatherId': parent._id },
            { 'parentInfo.motherId': parent._id },
            { 'parentInfo.guardianId': parent._id },
            { parentId: parent._id },
          ],
        })
      ).lean();

      if (!student) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Student not linked to this parent' },
        });
      }

      // Upsert — one rating per parent-teacher-student
      const ratingDoc = await TeacherRating.findOneAndUpdate(
        { schoolId, teacherId, parentId: parent._id, studentId },
        { rating, comment: comment || null },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      res.status(201).json({
        success: true,
        message: 'Rating submitted successfully',
        data: { rating: ratingDoc },
      });
    } catch (error) {
      console.error('POST /parent/teachers/:teacherId/rate error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to submit rating' },
      });
    }
  }
);

// GET /api/parent/teachers/:teacherId/my-rating — Get this parent's rating for a teacher
router.get('/teachers/:teacherId/my-rating', async (req, res) => {
  try {
    const parent = req.parent;
    const { teacherId } = req.params;
    const schoolId = await resolveRequestSchoolId(req);
    const { studentId } = req.query;

    const query = { schoolId, teacherId, parentId: parent._id };
    if (studentId) query.studentId = studentId;

    const ratings = await TeacherRating.find(query).lean();

    res.json({ success: true, data: { ratings } });
  } catch (error) {
    console.error('GET /parent/teachers/:teacherId/my-rating error:', error);
    res
      .status(500)
      .json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch rating' } });
  }
});

export default router;
