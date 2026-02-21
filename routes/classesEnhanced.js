import express from 'express';
import { Class, Student, Staff, Attendance, Result, ActivityLog, ClassRating, ChapterProgress, ClassAnnouncement, Timetable } from '../database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// ============ ACADEMIC PERFORMANCE ENDPOINTS ============

// Get academic performance for a class
router.get('/:id/academic-performance', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear = '2024-25' } = req.query;

    // Get all students in the class
    const students = await Student.find({ classId: id, status: 'active', isDeleted: { $ne: true } });
    const studentIds = students.map(s => s._id);

    // Get all results for this academic year
    const results = await Result.find({
      studentId: { $in: studentIds },
      academicYear
    });

    // Calculate average performance
    let totalPercentage = 0;
    let resultCount = 0;
    const studentPerformance = [];

    for (const student of students) {
      const studentResults = results.filter(r => r.studentId.toString() === student._id.toString());
      if (studentResults.length > 0) {
        const avgPercentage = studentResults.reduce((sum, r) => sum + (r.percentage || 0), 0) / studentResults.length;
        totalPercentage += avgPercentage;
        resultCount++;
        studentPerformance.push({
          studentId: student._id,
          studentName: student.name,
          rollNo: student.rollNo,
          averagePercentage: Math.round(avgPercentage * 10) / 10
        });
      }
    }

    const classAverage = resultCount > 0 ? Math.round((totalPercentage / resultCount) * 10) / 10 : 0;

    // Sort by performance
    studentPerformance.sort((a, b) => b.averagePercentage - a.averagePercentage);

    res.json({
      classId: id,
      academicYear,
      classAverage,
      topPerformers: studentPerformance.slice(0, 5),
      needImprovement: studentPerformance.slice(-5).reverse(),
      totalStudentsEvaluated: resultCount
    });
  } catch (error) {
    console.error('Error fetching academic performance:', error);
    res.status(500).json({ error: 'Failed to fetch academic performance' });
  }
});

// Recalculate academic performance
router.post('/:id/academic-performance/recalculate', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const classData = await Class.findById(id);
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const performance = await Result.aggregate([
      {
        $match: {
          classId: classData._id,
          academicYear: classData.academicYear
        }
      },
      {
        $group: {
          _id: '$studentId',
          avgPercentage: { $avg: '$percentage' }
        }
      },
      {
        $group: {
          _id: null,
          classAverage: { $avg: '$avgPercentage' }
        }
      }
    ]);

    const classAverage = performance.length > 0 ? Math.round(performance[0].classAverage) : 0;

    await Class.findByIdAndUpdate(id, {
      averageAcademicPerformance: classAverage
    });

    res.json({ success: true, classAverage });
  } catch (error) {
    console.error('Error recalculating academic performance:', error);
    res.status(500).json({ error: 'Failed to recalculate academic performance' });
  }
});

// ============ ACTIVITY LOG ENDPOINTS ============

// Get activity log for a class
router.get('/:id/activity-log', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, activityType, startDate, endDate } = req.query;

    const query = { classId: id };
    if (activityType) query.activityType = activityType;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const activities = await ActivityLog.find(query)
      .populate('performedBy', 'name code')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json(activities);
  } catch (error) {
    console.error('Error fetching activity log:', error);
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

// Create activity log entry
router.post('/:id/activity-log', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { activityType, description, details } = req.body;
    const performedBy = req.user?.id; // From authenticate middleware

    const activity = await ActivityLog.create({
      classId: id,
      activityType,
      description,
      performedBy,
      details: details || {}
    });

    await activity.populate('performedBy', 'name code');
    res.status(201).json(activity);
  } catch (error) {
    console.error('Error creating activity log:', error);
    res.status(500).json({ error: 'Failed to create activity log entry' });
  }
});

// ============ CLASS RATING ENDPOINTS ============

// Get class rating
router.get('/:id/rating', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear = '2024-25' } = req.query;

    let rating = await ClassRating.findOne({ classId: id, academicYear });
    if (!rating) {
      rating = await ClassRating.create({ classId: id, academicYear });
    }

    res.json(rating);
  } catch (error) {
    console.error('Error fetching class rating:', error);
    res.status(500).json({ error: 'Failed to fetch class rating' });
  }
});

// Recalculate class rating
router.post('/:id/rating/recalculate', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear = '2024-25' } = req.body;

    const classData = await Class.findById(id);
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    let rating = await ClassRating.findOne({ classId: id, academicYear });
    if (!rating) {
      rating = new ClassRating({ classId: id, academicYear });
    }

    // Calculate attendance score (30% weight)
    const attendanceData = await Attendance.aggregate([
      {
        $match: { classId: classData._id }
      },
      {
        $group: {
          _id: '$studentId',
          presentCount: {
            $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
          },
          totalCount: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: null,
          avgAttendance: {
            $avg: {
              $multiply: [{ $divide: ['$presentCount', '$totalCount'] }, 100]
            }
          }
        }
      }
    ]);

    rating.attendanceScore = attendanceData.length > 0 ? Math.round(attendanceData[0].avgAttendance) : 70;

    // Calculate academic score (40% weight)
    rating.academicScore = classData.averageAcademicPerformance || 70;

    // Behavior score - based on remarks (20% weight)
    // For now, using a default value - can be enhanced later
    rating.behaviorScore = 70;

    // Fee score - based on fee compliance (10% weight)
    // FIXED: Filter by status='active' AND isDeleted!=true for consistency
    const students = await Student.find({ classId: id, status: 'active', isDeleted: { $ne: true } });
    const paidStudents = students.filter(s => s.feeStatus === 'paid').length;
    rating.feeScore = students.length > 0 ? Math.round((paidStudents / students.length) * 100) : 70;

    // Calculate overall rating
    rating.calculateOverallRating();
    rating.lastCalculated = new Date();
    rating.calculatedBy = req.user?.id;

    // Add to history
    rating.ratingHistory.push({
      date: new Date(),
      rating: rating.rating,
      attendanceScore: rating.attendanceScore,
      academicScore: rating.academicScore,
      behaviorScore: rating.behaviorScore,
      feeScore: rating.feeScore
    });

    await rating.save();

    // Update class with new rating
    classData.rating = rating.rating;
    await classData.save();

    res.json(rating);
  } catch (error) {
    console.error('Error recalculating class rating:', error);
    res.status(500).json({ error: 'Failed to recalculate class rating' });
  }
});

// ============ ATTENDANCE ANALYTICS ENDPOINTS ============

// Get attendance analytics for a class
router.get('/:id/attendance-analytics', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { period = 'month' } = req.query; // week, month, term

    const students = await Student.find({ classId: id, status: 'active', isDeleted: { $ne: true } });
    const studentIds = students.map(s => s._id);

    // Calculate date range based on period
    const now = new Date();
    let startDate = new Date();
    if (period === 'week') {
      startDate.setDate(now.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(now.getMonth() - 1);
    } else if (period === 'term') {
      startDate.setMonth(now.getMonth() - 3);
    }

    const attendance = await Attendance.find({
      studentId: { $in: studentIds },
      date: { $gte: startDate.toISOString().split('T')[0] }
    });

    const studentAttendance = [];

    for (const student of students) {
      const studentAtt = attendance.filter(a => a.studentId.toString() === student._id.toString());
      const present = studentAtt.filter(a => a.status === 'present').length;
      const total = studentAtt.length;
      const percentage = total > 0 ? Math.round((present / total) * 100) : 0;

      studentAttendance.push({
        studentId: student._id,
        studentName: student.name,
        rollNo: student.rollNo,
        percentage,
        present,
        absent: total - present,
        total
      });
    }

    // Sort by attendance percentage
    studentAttendance.sort((a, b) => b.percentage - a.percentage);

    res.json({
      mostAttentive: studentAttendance.slice(0, 5),
      lessAttentive: studentAttendance.slice(-5).reverse(),
      classAverage: studentAttendance.length > 0
        ? Math.round(studentAttendance.reduce((sum, s) => sum + s.percentage, 0) / studentAttendance.length)
        : 0
    });
  } catch (error) {
    console.error('Error fetching attendance analytics:', error);
    res.status(500).json({ error: 'Failed to fetch attendance analytics' });
  }
});

// Get chronic absentees
router.get('/:id/chronic-absentees', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { threshold = 60 } = req.query;

    const students = await Student.find({ classId: id, status: 'active', isDeleted: { $ne: true } });
    const studentIds = students.map(s => s._id);

    // Get last 30 days attendance
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const attendance = await Attendance.find({
      studentId: { $in: studentIds },
      date: { $gte: thirtyDaysAgo.toISOString().split('T')[0] }
    });

    const chronicAbsentees = [];

    for (const student of students) {
      const studentAtt = attendance.filter(a => a.studentId.toString() === student._id.toString());
      const present = studentAtt.filter(a => a.status === 'present').length;
      const total = studentAtt.length;
      const percentage = total > 0 ? Math.round((present / total) * 100) : 0;

      if (percentage < threshold && total >= 10) {
        chronicAbsentees.push({
          studentId: student._id,
          studentName: student.name,
          rollNo: student.rollNo,
          percentage,
          parentPhone: student.parentPhone,
          parentEmail: student.parentEmail
        });
      }
    }

    res.json(chronicAbsentees);
  } catch (error) {
    console.error('Error fetching chronic absentees:', error);
    res.status(500).json({ error: 'Failed to fetch chronic absentees' });
  }
});

// ============ TODAY'S STATUS ENDPOINT ============

// Get today's status for a class
router.get('/:id/today-status', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const today = new Date().toISOString().split('T')[0];

    // Get today's attendance
    const students = await Student.find({ classId: id, status: 'active', isDeleted: { $ne: true } });
    const studentIds = students.map(s => s._id);

    const todayAttendance = await Attendance.find({
      studentId: { $in: studentIds },
      date: today
    });

    const present = todayAttendance.filter(a => a.status === 'present').length;
    const absent = todayAttendance.filter(a => a.status === 'absent').length;

    // Get timetable
    const timetable = await Timetable.findOne({ classId: id });
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayDay = dayNames[new Date().getDay()];

    let currentClass = null;
    let upcomingClass = null;

    if (timetable && timetable.schedule && timetable.schedule[todayDay]) {
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();

      const schedule = timetable.schedule[todayDay];
      const periods = timetable.periods || [];

      for (let i = 0; i < schedule.length; i++) {
        if (schedule[i] && periods[i] && !periods[i].isBreak) {
          const [startTime, endTime] = periods[i].startTime.split(':').map(Number);
          const periodStartMinutes = startTime * 60 + parseInt(periods[i].startTime.split(':')[1] || 0);

          if (currentTime >= periodStartMinutes) {
            if (!currentClass || periodStartMinutes > currentTime) {
              currentClass = {
                period: periods[i].name,
                subject: schedule[i].subject,
                teacherId: schedule[i].teacherId
              };
            }
          } else if (!upcomingClass) {
            upcomingClass = {
              period: periods[i].name,
              subject: schedule[i].subject,
              teacherId: schedule[i].teacherId,
              time: periods[i].startTime
            };
          }
        }
      }
    }

    res.json({
      date: today,
      attendance: {
        total: students.length,
        present,
        absent,
        percentage: students.length > 0 ? Math.round((present / students.length) * 100) : 0
      },
      currentClass,
      upcomingClass
    });
  } catch (error) {
    console.error('Error fetching today status:', error);
    res.status(500).json({ error: 'Failed to fetch today status' });
  }
});

// ============ PROMOTION ENDPOINT ============

// Promote class to next grade
router.post('/:id/promote', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { targetClassId, targetSection, academicYear = '2025-26' } = req.body;

    const currentClass = await Class.findById(id);
    if (!currentClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const students = await Student.find({ classId: id, status: 'active', isDeleted: { $ne: true } });

    const promotionResults = {
      promoted: [],
      notPromoted: [],
      errors: []
    };

    for (const student of students) {
      try {
        // Check fee status
        if (student.feeStatus === 'pending') {
          promotionResults.notPromoted.push({
            studentId: student._id,
            studentName: student.name,
            reason: 'Fee pending'
          });
          continue;
        }

        // Check attendance (should be above 60%)
        const attendance = await Attendance.find({ studentId: student._id });
        const present = attendance.filter(a => a.status === 'present').length;
        const attendancePercent = attendance.length > 0 ? (present / attendance.length) * 100 : 0;

        if (attendancePercent < 60) {
          promotionResults.notPromoted.push({
            studentId: student._id,
            studentName: student.name,
            reason: 'Low attendance'
          });
          continue;
        }

        // Update student class
        student.classId = targetClassId;
        student.academicYear = academicYear;
        await student.save();

        promotionResults.promoted.push({
          studentId: student._id,
          studentName: student.name
        });

        // Log activity
        await ActivityLog.create({
          classId: id,
          activityType: 'class_promoted',
          description: `Student ${student.name} promoted from ${currentClass.name}-${currentClass.section}`,
          performedBy: req.user?.id,
          details: {
            studentId: student._id,
            fromClass: id,
            toClass: targetClassId,
            academicYear
          }
        });
      } catch (error) {
        promotionResults.errors.push({
          studentId: student._id,
          studentName: student.name,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      summary: {
        total: students.length,
        promoted: promotionResults.promoted.length,
        notPromoted: promotionResults.notPromoted.length,
        errors: promotionResults.errors.length
      },
      details: promotionResults
    });
  } catch (error) {
    console.error('Error promoting class:', error);
    res.status(500).json({ error: 'Failed to promote class' });
  }
});

// ============ CHAPTERS & SUBJECTS ENDPOINTS ============

// Get chapters for a class
router.get('/:id/subjects', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear = '2024-25' } = req.query;

    const chapters = await ChapterProgress.find({
      classId: id,
      academicYear
    }).populate('teacherId', 'name code').populate('subjectId');

    res.json(chapters);
  } catch (error) {
    console.error('Error fetching chapters:', error);
    res.status(500).json({ error: 'Failed to fetch chapters' });
  }
});

// Add chapter/subject to class
router.post('/:id/subjects', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { subjectName, subjectId, teacherId, chapters, assignedStudents } = req.body;
    const { academicYear = '2024-25' } = req.body;

    const chapterProgress = await ChapterProgress.create({
      classId: id,
      subjectId,
      subjectName,
      teacherId,
      academicYear,
      chapters: chapters || [],
      assignedStudents: assignedStudents || []
    });

    await chapterProgress.save();

    // Update class subjects list
    const classData = await Class.findById(id);
    if (classData && !classData.subjects.includes(subjectName)) {
      classData.subjects.push(subjectName);
      await classData.save();
    }

    // Log activity
    await ActivityLog.create({
      classId: id,
      activityType: 'subject_assigned',
      description: `Subject ${subjectName} assigned to teacher`,
      performedBy: req.user?.id,
      details: { subjectName, teacherId }
    });

    res.status(201).json(chapterProgress);
  } catch (error) {
    console.error('Error adding subject:', error);
    res.status(500).json({ error: 'Failed to add subject' });
  }
});

// Update chapter progress
router.put('/chapters/:chapterId', authenticate, async (req, res) => {
  try {
    const { chapterId } = req.params;
    const { chapters, status, completedDate, notes } = req.body;

    // Support both bulk update (chapters array) and individual chapter update
    if (chapters && Array.isArray(chapters)) {
      // Bulk update: Update entire chapters array
      const chapterProgress = await ChapterProgress.findByIdAndUpdate(
        chapterId,
        { chapters },
        { new: true }
      );

      if (!chapterProgress) {
        return res.status(404).json({ error: 'Chapter progress not found' });
      }

      chapterProgress.calculateOverallProgress();
      await chapterProgress.save();

      res.json(chapterProgress);
    } else if (status || completedDate || notes) {
      // Individual chapter update: Update specific chapter fields
      const chapterProgress = await ChapterProgress.findByIdAndUpdate(
        chapterId,
        { status, completedDate, notes },
        { new: true }
      ).populate('subjectId', 'subjectName');

      if (!chapterProgress) {
        return res.status(404).json({ error: 'Chapter not found' });
      }

      res.json(chapterProgress);
    } else {
      return res.status(400).json({ error: 'No valid update data provided' });
    }
  } catch (error) {
    console.error('Error updating chapter progress:', error);
    res.status(500).json({ error: 'Failed to update chapter progress' });
  }
});

// ============ STRENGTH LIMIT ENDPOINT ============

// Adjust class strength limit
router.put('/:id/strength-limit', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { newLimit, reason, approvedBy } = req.body;

    const classData = await Class.findById(id);
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    classData.strengthLimit.current = newLimit;
    classData.strengthLimit.adjustments.push({
      newLimit,
      reason,
      approvedBy: approvedBy || req.user?.id,
      date: new Date()
    });

    await classData.save();

    // Log activity
    await ActivityLog.create({
      classId: id,
      activityType: 'strength_changed',
      description: `Class strength limit adjusted to ${newLimit}`,
      performedBy: req.user?.id,
      details: { oldLimit: classData.strengthLimit.default, newLimit, reason }
    });

    res.json({
      success: true,
      currentLimit: classData.strengthLimit.current
    });
  } catch (error) {
    console.error('Error adjusting strength limit:', error);
    res.status(500).json({ error: 'Failed to adjust strength limit' });
  }
});

// ============ ANNOUNCEMENTS ENDPOINT ============

// Send announcement to class
router.post('/:id/announcements', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, targetAudience, priority, attachments, scheduledFor } = req.body;

    // Get all students in class
    const students = await Student.find({ classId: id, status: 'active', isDeleted: { $ne: true } });

    const announcement = await ClassAnnouncement.create({
      classId: id,
      title,
      description,
      targetAudience,
      priority: priority || 'normal',
      attachments: attachments || [],
      scheduledFor,
      sentAt: scheduledFor ? undefined : new Date(),
      sentBy: req.user?.id,
      deliveryStatus: {
        total: students.length,
        sent: 0,
        delivered: 0,
        read: 0
      },
      recipients: students.map(s => ({
        studentId: s._id,
        status: 'pending'
      }))
    });

    // Log activity
    await ActivityLog.create({
      classId: id,
      activityType: 'announcement_sent',
      description: `Announcement "${title}" sent to class`,
      performedBy: req.user?.id,
      details: { announcementId: announcement._id, targetAudience, priority }
    });

    res.status(201).json(announcement);
  } catch (error) {
    console.error('Error sending announcement:', error);
    res.status(500).json({ error: 'Failed to send announcement' });
  }
});

// Get announcements for class
router.get('/:id/announcements', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 20 } = req.query;

    const announcements = await ClassAnnouncement.find({ classId: id })
      .populate('sentBy', 'name code')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json(announcements);
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// ============ FEES OVERVIEW ENDPOINT ============

// Get fees overview for class
router.get('/:id/fees-overview', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear = '2024-25' } = req.query;

    const students = await Student.find({ classId: id, status: 'active', isDeleted: { $ne: true } });

    const feeStats = {
      totalStudents: students.length,
      paid: 0,
      unpaid: 0,
      partial: 0,
      totalPendingAmount: 0,
      totalPaidAmount: 0
    };

    students.forEach(student => {
      if (student.feeDetails) {
        if (student.feeStatus === 'paid') {
          feeStats.paid++;
          feeStats.totalPaidAmount += student.feeDetails.paidAmount || 0;
        } else if (student.feeStatus === 'pending') {
          feeStats.unpaid++;
          feeStats.totalPendingAmount += student.feeDetails.balanceAmount || 0;
        } else if (student.feeStatus === 'partial') {
          feeStats.partial++;
          feeStats.totalPendingAmount += student.feeDetails.balanceAmount || 0;
          feeStats.totalPaidAmount += student.feeDetails.paidAmount || 0;
        }
      }
    });

    res.json(feeStats);
  } catch (error) {
    console.error('Error fetching fees overview:', error);
    res.status(500).json({ error: 'Failed to fetch fees overview' });
  }
});

// ============ MISSING SUBJECTS ENDPOINT ============

// Get classes with missing subjects
router.get('/missing-subjects', authenticate, async (req, res) => {
  try {
    // Get all classes
    const classes = await Class.find({}).sort({ name: 1, section: 1 });

    const missingSubjects = [];

    for (const cls of classes) {
      // Check if class has no subjects or empty subjects array
      if (!cls.subjects || cls.subjects.length === 0) {
        missingSubjects.push({
          classId: cls._id,
          className: `${cls.name}-${cls.section}`,
          subjectsCount: 0,
          hasSubjects: false
        });
      }
    }

    res.json({
      totalClasses: classes.length,
      classesWithMissingSubjects: missingSubjects.length,
      missingSubjects
    });
  } catch (error) {
    console.error('Error fetching missing subjects:', error);
    res.status(500).json({ error: 'Failed to fetch missing subjects' });
  }
});

export default router;
