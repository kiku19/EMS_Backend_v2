/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Role-aware dashboard statistics
 */

/**
 * @swagger
 * /dashboard/stats:
 *   get:
 *     summary: Get role-specific dashboard statistics
 *     description: |
 *       Returns different KPIs depending on the authenticated user's role:
 *       - **admin / principal**: students, staff, classes, fee defaulters, daily & monthly collection, pending leaves, staff attendance
 *       - **accountant**: daily/weekly/monthly collection, defaulters, pending payroll
 *       - **teacher**: assigned classes, attendance status, upcoming exams, pending leaves
 *       - **other roles**: total students & classes
 *     tags: [Dashboard]
 *     parameters:
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *     responses:
 *       200:
 *         description: Role-specific dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 role:
 *                   type: string
 *                   example: admin
 *                 totalStudents:
 *                   type: integer
 *                 totalStaff:
 *                   type: integer
 *                 totalClasses:
 *                   type: integer
 *                 feeDefaulters:
 *                   type: integer
 *                 dailyCollection:
 *                   type: number
 *                 monthlyCollection:
 *                   type: number
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

import express from 'express';
import { z } from 'zod';
import { Student, Staff, Class, FeePayment, Exam, Attendance } from '../database.js';
import StaffAttendance from '../models/StaffAttendance.js';
import PayrollRecord from '../models/PayrollRecord.js';
import TeacherLeave from '../models/TeacherLeave.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
router.use(authenticate);
const logger = createLogger('Dashboard');

const querySchema = z.object({
  academicYear: z.string().optional(),
});

function getRoles(user) {
  const role = user?.role;
  if (Array.isArray(role)) return role.map((r) => String(r).toLowerCase().trim());
  if (typeof role === 'string') return [role.toLowerCase().trim()];
  return [];
}

function hasRole(user, roles) {
  const userRoles = getRoles(user);
  return roles.some((r) => userRoles.includes(r));
}

// GET /api/v1/dashboard/stats
router.get('/stats', checkPermission('dashboard', 'view'), async (req, res) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: req.t('common:routes.invalidQueryParameters'),
        details: parsed.error.errors,
      });
    }

    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) {
      return res.status(400).json({ error: req.t('common:routes.schoolIdIsRequired') });
    }

    const { academicYear } = parsed.data;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // ── Admin / Principal / Vice Principal ──────────────────────────────
    if (
      hasRole(req.user, [
        'admin',
        'super admin',
        'superadmin',
        'principal',
        'vice principal',
        'vice-principal',
      ])
    ) {
      const [
        totalStudents,
        totalStaff,
        totalClasses,
        feeDefaulters,
        dailyCollection,
        monthlyCollection,
        pendingLeaves,
        staffPresent,
        staffMarked,
      ] = await Promise.allSettled([
        Student.countDocuments({ schoolId, isDeleted: { $ne: true }, status: 'active' }),
        Staff.countDocuments({ schoolId, isDeleted: { $ne: true }, status: 'active' }),
        Class.countDocuments({ schoolId, isDeleted: { $ne: true } }),
        Student.countDocuments({
          schoolId,
          isDeleted: { $ne: true },
          feeStatus: { $in: ['pending', 'overdue'] },
        }),
        FeePayment.aggregate([
          {
            $match: {
              schoolId,
              createdAt: { $gte: startOfDay },
              status: { $nin: ['failed', 'cancelled', 'refunded'] },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        FeePayment.aggregate([
          {
            $match: {
              schoolId,
              createdAt: { $gte: startOfMonth },
              status: { $nin: ['failed', 'cancelled', 'refunded'] },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        TeacherLeave.countDocuments({ schoolId, status: 'pending' }),
        StaffAttendance.countDocuments({ schoolId, date: today, status: 'present' }),
        StaffAttendance.countDocuments({ schoolId, date: today }),
      ]);

      return res.json({
        role: 'admin',
        totalStudents: totalStudents.status === 'fulfilled' ? totalStudents.value : 0,
        totalStaff: totalStaff.status === 'fulfilled' ? totalStaff.value : 0,
        totalClasses: totalClasses.status === 'fulfilled' ? totalClasses.value : 0,
        feeDefaulters: feeDefaulters.status === 'fulfilled' ? feeDefaulters.value : 0,
        dailyCollection:
          dailyCollection.status === 'fulfilled' ? dailyCollection.value[0]?.total || 0 : 0,
        dailyTransactions:
          dailyCollection.status === 'fulfilled' ? dailyCollection.value[0]?.count || 0 : 0,
        monthlyCollection:
          monthlyCollection.status === 'fulfilled' ? monthlyCollection.value[0]?.total || 0 : 0,
        pendingLeaves: pendingLeaves.status === 'fulfilled' ? pendingLeaves.value : 0,
        staffPresent: staffPresent.status === 'fulfilled' ? staffPresent.value : 0,
        staffMarked: staffMarked.status === 'fulfilled' ? staffMarked.value : 0,
      });
    }

    // ── Accountant ───────────────────────────────────────────────────────
    if (hasRole(req.user, ['accountant', 'accounts'])) {
      const [
        dailyCollection,
        weeklyCollection,
        monthlyCollection,
        totalDefaulters,
        overdueDefaulters,
        pendingPayroll,
      ] = await Promise.allSettled([
        FeePayment.aggregate([
          {
            $match: {
              schoolId,
              createdAt: { $gte: startOfDay },
              status: { $nin: ['failed', 'cancelled', 'refunded'] },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        FeePayment.aggregate([
          {
            $match: {
              schoolId,
              createdAt: { $gte: last7Days },
              status: { $nin: ['failed', 'cancelled', 'refunded'] },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        FeePayment.aggregate([
          {
            $match: {
              schoolId,
              createdAt: { $gte: startOfMonth },
              status: { $nin: ['failed', 'cancelled', 'refunded'] },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        Student.countDocuments({
          schoolId,
          isDeleted: { $ne: true },
          feeStatus: { $in: ['pending', 'overdue'] },
        }),
        Student.countDocuments({ schoolId, isDeleted: { $ne: true }, feeStatus: 'overdue' }),
        PayrollRecord.countDocuments({ schoolId, status: 'pending' }),
      ]);

      return res.json({
        role: 'accountant',
        dailyCollection:
          dailyCollection.status === 'fulfilled' ? dailyCollection.value[0]?.total || 0 : 0,
        dailyTransactions:
          dailyCollection.status === 'fulfilled' ? dailyCollection.value[0]?.count || 0 : 0,
        weeklyCollection:
          weeklyCollection.status === 'fulfilled' ? weeklyCollection.value[0]?.total || 0 : 0,
        weeklyTransactions:
          weeklyCollection.status === 'fulfilled' ? weeklyCollection.value[0]?.count || 0 : 0,
        monthlyCollection:
          monthlyCollection.status === 'fulfilled' ? monthlyCollection.value[0]?.total || 0 : 0,
        monthlyTransactions:
          monthlyCollection.status === 'fulfilled' ? monthlyCollection.value[0]?.count || 0 : 0,
        totalDefaulters: totalDefaulters.status === 'fulfilled' ? totalDefaulters.value : 0,
        overdueDefaulters: overdueDefaulters.status === 'fulfilled' ? overdueDefaulters.value : 0,
        pendingPayroll: pendingPayroll.status === 'fulfilled' ? pendingPayroll.value : 0,
      });
    }

    // ── Teacher ──────────────────────────────────────────────────────────
    if (hasRole(req.user, ['teacher'])) {
      const teacherId = req.user.id || req.user.userId;
      const examFilter = { schoolId, isDeleted: { $ne: true }, date: { $gte: now } };
      if (academicYear) examFilter.academicYear = academicYear;

      const [myClasses, markedClassIds, upcomingExams, pendingLeaves] = await Promise.allSettled([
        Class.find({ schoolId, isDeleted: { $ne: true }, classTeacherId: teacherId })
          .select('_id name section')
          .lean(),
        Attendance.distinct('classId', { schoolId, date: today }),
        Exam.find(examFilter).select('title date subject').sort({ date: 1 }).limit(5).lean(),
        TeacherLeave.countDocuments({ schoolId, teacherId, status: 'pending' }),
      ]);

      const myClassList = myClasses.status === 'fulfilled' ? myClasses.value : [];
      const markedSet = new Set(
        (markedClassIds.status === 'fulfilled' ? markedClassIds.value : []).map(String)
      );

      return res.json({
        role: 'teacher',
        myClassesCount: myClassList.length,
        myClasses: myClassList.map((c) => ({
          id: String(c._id),
          name: c.name,
          section: c.section || '',
          attendanceMarked: markedSet.has(String(c._id)),
        })),
        upcomingExams:
          upcomingExams.status === 'fulfilled'
            ? upcomingExams.value.map((e) => ({
                id: String(e._id),
                title: e.title,
                subject: e.subject,
                date: e.date,
              }))
            : [],
        pendingLeaves: pendingLeaves.status === 'fulfilled' ? pendingLeaves.value : 0,
      });
    }

    // ── Default fallback ─────────────────────────────────────────────────
    const [totalStudents, totalClasses] = await Promise.allSettled([
      Student.countDocuments({ schoolId, isDeleted: { $ne: true }, status: 'active' }),
      Class.countDocuments({ schoolId, isDeleted: { $ne: true } }),
    ]);

    return res.json({
      role: 'general',
      totalStudents: totalStudents.status === 'fulfilled' ? totalStudents.value : 0,
      totalClasses: totalClasses.status === 'fulfilled' ? totalClasses.value : 0,
    });
  } catch (error) {
    logger.error('Dashboard stats error', { error: error.message });
    return res.status(500).json({ error: req.t('common:routes.failedToLoadDashboardStatistics') });
  }
});

export default router;
