/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Role-aware dashboard statistics
 */

/**
 * @swagger
 * /dashboard/feed:
 *   get:
 *     summary: Get dashboard action items, schedule, and weekly highlights
 *     description: |
 *       Returns real-time dashboard content that is currently mocked on the
 *       frontend: priority action items (fee defaulters, unstaffed classes,
 *       upcoming events), today's schedule from the calendar, and weekly
 *       highlight moments.
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: Dashboard feed data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 priorities:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       kind:
 *                         type: string
 *                         enum: [danger, warn, info]
 *                       title:
 *                         type: string
 *                       body:
 *                         type: string
 *                       meta:
 *                         type: string
 *                       primary:
 *                         type: string
 *                       route:
 *                         type: string
 *                 schedule:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       time:
 *                         type: string
 *                       title:
 *                         type: string
 *                       meta:
 *                         type: string
 *                       mine:
 *                         type: boolean
 *                       allDay:
 *                         type: boolean
 *                 moments:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       label:
 *                         type: string
 *                       value:
 *                         type: string
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
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
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  Student,
  Staff,
  Class,
  FeePayment,
  Exam,
  Attendance,
  Substitution,
  StudentFeeStructure,
} from '../database.js';
import Parent from '../models/Parent.js';
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

function getCalendarEventModel() {
  return mongoose.models.CalendarEvent || null;
}

function getDayName(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

function formatINRCompact(amount) {
  if (amount == null || Number.isNaN(amount)) return '₹0';
  const n = Math.abs(amount);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return `₹${Math.round(n)}`;
}

function formatShortDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysBetween(from, to) {
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
}

// GET /api/v1/dashboard/feed
// Returns action items, today's schedule, and weekly highlights for the dashboard.
router.get('/feed', checkPermission('dashboard', 'view'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) {
      return res.status(400).json({ error: req.t('common:routes.schoolIdIsRequired') });
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const nextWeekDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextWeek = nextWeekDate.toISOString().split('T')[0];

    // Aggregate fee structures with an outstanding balance, joining the owning
    // student and dropping orphaned rows (student soft-deleted / inactive).
    // Without this join, archived students leave "live" fee rows that surface
    // as phantom "unpaid fees" priorities. Same $lookup pattern as
    // /dashboard/fee-summary and /fees/class-summary. Aggregation $match does
    // not auto-cast, so cast schoolId to ObjectId explicitly.
    const schoolObjIdForFeed = new mongoose.Types.ObjectId(String(schoolId));

    const [feeStructures, pendingSubstitutions, calendarEvents] = await Promise.allSettled([
      StudentFeeStructure.aggregate([
        {
          $match: {
            schoolId: schoolObjIdForFeed,
            totalBalance: { $gt: 0 },
            isDeleted: { $ne: true },
          },
        },
        {
          $lookup: {
            from: 'students',
            localField: 'studentId',
            foreignField: '_id',
            as: 'student',
          },
        },
        { $unwind: '$student' },
        {
          $match: {
            'student.isDeleted': { $ne: true },
            'student.status': 'active',
          },
        },
        { $project: { _id: 0, totalBalance: 1 } },
      ]),
      Substitution.find({
        schoolId,
        date: today,
        status: { $in: ['pending', 'confirmed'] },
      })
        .populate('classId', 'name section')
        .sort({ period: 1 })
        .lean(),
      (async () => {
        const CalendarEvent = getCalendarEventModel();
        if (!CalendarEvent) return [];
        return CalendarEvent.find({
          schoolId,
          date: { $gte: today, $lte: nextWeek },
          isDeleted: { $ne: true },
          type: { $in: ['event', 'meeting', 'exam'] },
        })
          .sort({ date: 1, startTime: 1 })
          .lean();
      })(),
    ]);

    const defaulterStructures = feeStructures.status === 'fulfilled' ? feeStructures.value : [];
    const feeDefaultersCount = defaulterStructures.length;
    const totalPending = defaulterStructures.reduce(
      (sum, record) => sum + (record.totalBalance || 0),
      0
    );

    const substitutions =
      pendingSubstitutions.status === 'fulfilled' ? pendingSubstitutions.value : [];

    const events = calendarEvents.status === 'fulfilled' ? calendarEvents.value : [];
    const todayEvents = events.filter((event) => event.date === today);
    const upcomingEvents = events.filter((event) => event.date > today);

    const priorities = [];
    if (feeDefaultersCount > 0) {
      priorities.push({
        id: 'fees',
        kind: 'danger',
        title:
          totalPending > 0
            ? `${formatINRCompact(totalPending)} unpaid fees`
            : `${feeDefaultersCount} fee defaulters`,
        body: `${feeDefaultersCount} student${feeDefaultersCount === 1 ? '' : 's'} past cutoff`,
        meta: 'Reminder ready',
        primary: 'Send reminders',
        route: '/fees',
      });
    }

    if (substitutions.length > 0) {
      const first = substitutions[0];
      const className = first.classId
        ? `${first.classId.name || ''} ${first.classId.section || ''}`.trim()
        : 'Unknown class';
      priorities.push({
        id: 'coverage',
        kind: 'warn',
        title: `Period ${first.period} · ${className || 'Unstaffed'} unstaffed`,
        body: 'Substitute not assigned',
        meta: 'Today',
        primary: 'Assign substitute',
        route: '/staffs',
      });
    }

    if (upcomingEvents.length > 0) {
      const first = upcomingEvents[0];
      const daysLeft = daysBetween(today, first.date);
      priorities.push({
        id: 'event',
        kind: 'info',
        title: `${first.title} · ${formatShortDate(first.date)}`,
        body: first.description || 'Upcoming event',
        meta: daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'Today',
        primary: 'Open details',
        route: '/calendar',
      });
    }

    const schedule = todayEvents.map((event) => ({
      time: event.startTime || (event.allDay ? 'All day' : 'TBD'),
      title: event.title,
      meta: event.description || `${getDayName(event.date)} event`,
      mine: false,
      allDay: event.allDay || false,
    }));

    const moments = [];
    const weekEventCount = events.length;
    if (weekEventCount > 0) {
      moments.push({
        label: 'events this week',
        value: String(weekEventCount),
      });
    }

    return res.json({ priorities, schedule, moments });
  } catch (error) {
    logger.error('Dashboard feed error', { error: error.message });
    return res.status(500).json({ error: req.t('common:routes.failedToLoadDashboardStatistics') });
  }
});

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
              isDeleted: { $ne: true },
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
              isDeleted: { $ne: true },
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
              isDeleted: { $ne: true },
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
              isDeleted: { $ne: true },
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
              isDeleted: { $ne: true },
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

// GET /api/v1/dashboard/analytics-summary
// Server-computed student KPIs for the Analytics and Dashboard screens.
// [PAG-05] removed global student hydration from the app shell, so those pages
// can no longer count students client-side from AppContext. Rather than
// re-introduce a full-roster fetch, this endpoint aggregates the status/fee
// breakdowns and per-class distribution in MongoDB and returns only the totals.
router.get('/analytics-summary', checkPermission('dashboard', 'view'), async (req, res) => {
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

    // Student.schoolId is an ObjectId; aggregation `$match` does not auto-cast
    // (unlike countDocuments used elsewhere in this file), so convert explicitly.
    const schoolObjId = new mongoose.Types.ObjectId(String(schoolId));
    const baseMatch = { schoolId: schoolObjId, isDeleted: { $ne: true } };

    const [statusAgg, feeAgg, classAgg] = await Promise.allSettled([
      Student.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Student.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$feeStatus', count: { $sum: 1 } } },
      ]),
      Student.aggregate([
        { $match: { ...baseMatch, status: 'active' } },
        { $group: { _id: '$classId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const countsByKey = (settled) => {
      const map = {};
      if (settled.status === 'fulfilled') {
        for (const row of settled.value) {
          if (row?._id != null) map[row._id] = row.count;
        }
      }
      return map;
    };

    const statusCounts = countsByKey(statusAgg);
    const feeCounts = countsByKey(feeAgg);
    const totalStudents =
      statusAgg.status === 'fulfilled'
        ? statusAgg.value.reduce((sum, row) => sum + (row.count || 0), 0)
        : 0;

    const students = {
      total: totalStudents,
      active: statusCounts.active || 0,
      inactive: statusCounts.inactive || 0,
      graduated: statusCounts.graduated || 0,
      transferred: statusCounts.transferred || 0,
      alumni: statusCounts.alumni || 0,
    };

    const paid = feeCounts.paid || 0;
    const pending = feeCounts.pending || 0;
    const partial = feeCounts.partial || 0;
    const overdue = feeCounts.overdue || 0;
    const fees = {
      paid,
      pending,
      partial,
      overdue,
      // Defaulters mirror the `/dashboard/stats` definition (pending + overdue).
      defaulters: pending + overdue,
      collectionRate: totalStudents > 0 ? Number(((paid / totalStudents) * 100).toFixed(1)) : 0,
    };

    // Resolve class names for the distribution chart (students-per-class,
    // largest/smallest class). Kept as a bounded second query rather than a
    // `$lookup` so we don't couple to the physical collection name.
    const classRows = classAgg.status === 'fulfilled' ? classAgg.value : [];
    const classIds = classRows.map((row) => row._id).filter(Boolean);
    let nameMap = new Map();
    if (classIds.length > 0) {
      const classDocs = await Class.find({ schoolId: schoolObjId, _id: { $in: classIds } })
        .select('name section')
        .lean();
      nameMap = new Map(
        classDocs.map((c) => [String(c._id), `${c.name || ''} ${c.section || ''}`.trim()])
      );
    }
    const classDistribution = classRows.map((row) => ({
      classId: row._id ? String(row._id) : null,
      name: row._id ? nameMap.get(String(row._id)) || 'Unknown class' : 'Unassigned',
      count: row.count,
    }));

    return res.json({ students, fees, classDistribution });
  } catch (error) {
    logger.error('Dashboard analytics-summary error', { error: error.message });
    return res.status(500).json({ error: req.t('common:routes.failedToLoadDashboardStatistics') });
  }
});

// GET /api/v1/dashboard/fee-summary
// Bounded fee collection snapshot for the dashboard landing card.
// [PERF-REFACTOR] Replaces the client walking `studentFeesApi.getAll()` (every
// fee structure for the school/year) + `feesApi.getPayments()` (every payment)
// just to compute four numbers and a 6-row recent list. This endpoint
// aggregates the totals in MongoDB and returns a bounded recent-payment slice,
// so the dashboard no longer downloads unbounded collections to render KPIs.
//
// Response:
//   { totalCollected, totalPending, defaulters, feeStructuresExist,
//     recentPayments: [{ _id, amount, paymentDate, receiptNumber,
//                        paymentMethod, status, studentId }] }
router.get('/fee-summary', checkPermission('dashboard', 'view'), async (req, res) => {
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

    // StudentFeeStructure.schoolId is an ObjectId; aggregation `$match` does
    // not auto-cast (unlike find/countDocuments), so convert explicitly. Same
    // pattern as /dashboard/analytics-summary above.
    const schoolObjId = new mongoose.Types.ObjectId(String(schoolId));

    const academicYear = parsed.data.academicYear || undefined;

    // Fee-structure scope: school + (optional) academic year, soft-delete safe.
    // totalPaid/totalBalance are maintained on each StudentFeeStructure doc.
    // isDeleted filters archived students' fee rows at the source — the $lookup
    // below also drops them as defense-in-depth.
    const structureMatch = {
      schoolId: schoolObjId,
      isDeleted: { $ne: true },
      ...(academicYear ? { academicYear } : {}),
    };

    // One aggregation pass: join the owning student and drop orphaned fee
    // structures (rows whose student was soft-deleted) before summing the
    // money totals and counting defaulters. Without this join, archived
    // students leave behind "live" fee rows that inflate the hero's unpaid-fees
    // badge even though the school shows zero students — a visible trust bug.
    // Same $lookup + 'student.isDeleted' pattern as /fees/class-summary.
    //
    // todayCollected/monthCollected are aggregated server-side from FeePayment
    // rather than reduced client-side over a 50-row page. Previously the
    // dashboard called feesApi.getPayments() (which defaults to page=1,
    // limit=50) and summed those rows — so schools with >50 payments/year
    // showed a fraction of the real "collected today/month" headline KPI.
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const monthPrefix = todayStr.slice(0, 7); // YYYY-MM
    const paymentMatch = {
      schoolId: schoolObjId,
      status: { $ne: 'cancelled' },
      isDeleted: { $ne: true },
      ...(academicYear ? { academicYear } : {}),
    };

    const [totalsAgg, recentPayments, todayCollectedAgg, monthCollectedAgg] = await Promise.all([
      StudentFeeStructure.aggregate([
        { $match: structureMatch },
        {
          $lookup: {
            from: 'students',
            localField: 'studentId',
            foreignField: '_id',
            as: 'student',
          },
        },
        { $unwind: '$student' },
        {
          $match: {
            'student.isDeleted': { $ne: true },
            'student.status': 'active',
          },
        },
        {
          $group: {
            _id: null,
            totalCollected: { $sum: '$totalPaid' },
            totalPending: { $sum: '$totalBalance' },
            structureCount: { $sum: 1 },
            // "Defaulters" = joined fee structures with an outstanding balance,
            // matching the client-side definition (fs.totalBalance > 0).
            defaulters: {
              $sum: { $cond: [{ $gt: ['$totalBalance', 0] }, 1, 0] },
            },
          },
        },
      ]).catch(() => []),
      // Bounded recent-payments slice (newest first). The {schoolId, paymentDate:-1}
      // index makes this a cheap index scan; we only ever return 6 rows. We
      // over-fetch (limit 18) then drop archived-student rows client-side to
      // avoid a $lookup on this hot path while still returning ~6 live rows.
      FeePayment.find({
        schoolId: schoolObjId,
        isDeleted: { $ne: true },
        ...(academicYear ? { academicYear } : {}),
      })
        .sort({ paymentDate: -1, createdAt: -1 })
        .limit(18)
        .select('amount paymentDate receiptNumber paymentMethod status studentId classId')
        .populate({
          path: 'studentId',
          select: 'isDeleted status',
          match: { isDeleted: { $ne: true } },
        })
        .lean()
        .then((rows) => (rows || []).filter((r) => r.studentId).slice(0, 6))
        .catch(() => []),
      // "Collected today" summed server-side across ALL of today's payments
      // (not just a 50-row page). paymentDate is a stored "YYYY-MM-DD" string.
      // [S4/X16] Join the owning student and drop archived-student rows before
      // summing, so a departed student's payments don't inflate today's KPI.
      FeePayment.aggregate([
        { $match: { ...paymentMatch, paymentDate: todayStr } },
        {
          $lookup: {
            from: 'students',
            localField: 'studentId',
            foreignField: '_id',
            as: 'student',
          },
        },
        { $unwind: { path: '$student', preserveNullAndEmptyArrays: false } },
        { $match: { 'student.isDeleted': { $ne: true } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).catch(() => []),
      // "Collected this month" — match the "YYYY-MM" prefix of paymentDate.
      // [S4/X16] Same archived-student exclusion as todayCollected above.
      FeePayment.aggregate([
        { $match: { ...paymentMatch, paymentDate: { $regex: `^${monthPrefix}` } } },
        {
          $lookup: {
            from: 'students',
            localField: 'studentId',
            foreignField: '_id',
            as: 'student',
          },
        },
        { $unwind: { path: '$student', preserveNullAndEmptyArrays: false } },
        { $match: { 'student.isDeleted': { $ne: true } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).catch(() => []),
    ]);

    const totals = totalsAgg[0] || {
      totalCollected: 0,
      totalPending: 0,
      structureCount: 0,
      defaulters: 0,
    };

    return res.json({
      totalCollected: totals.totalCollected || 0,
      totalPending: totals.totalPending || 0,
      defaulters: totals.defaulters || 0,
      feeStructuresExist: (totals.structureCount || 0) > 0,
      recentPayments,
      // Server-computed money KPIs — the true sum of all payments today / this
      // month, not a reduce over a 50-row page.
      todayCollected: todayCollectedAgg[0]?.total || 0,
      monthCollected: monthCollectedAgg[0]?.total || 0,
    });
  } catch (error) {
    logger.error('Dashboard fee-summary error', { error: error.message });
    return res.status(500).json({ error: req.t('common:routes.failedToLoadDashboardStatistics') });
  }
});

// GET /api/v1/dashboard/birthdays
// Today's student & staff birthdays. [PAG-05] removed the global student roster
// from the app shell, so the dashboard can no longer compute birthdays
// client-side. This endpoint does the month/day match in MongoDB and returns
// only the people whose birthday is today (plus an optional upcoming window),
// capped for the dashboard card.
//
// Staff.dob is a Mixed field that may hold a legacy String ("DD/MM/YYYY" or
// ISO) or a Date; Student.dateOfBirth is a validated Date. We normalise both to
// a Date in the aggregation so $month/$dayOfMonth match reliably.
router.get('/birthdays', checkPermission('dashboard', 'view'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) {
      return res.status(400).json({ error: req.t('common:routes.schoolIdIsRequired') });
    }

    const schoolObjId = new mongoose.Types.ObjectId(String(schoolId));
    const now = new Date();
    const todayMonth = now.getMonth() + 1; // 1-12
    const todayDay = now.getDate();

    // Parse a Staff.dob / Student.dateOfBirth value into a Date. Returns null if
    // unparseable. Both fields are stored as Strings ("YYYY-MM-DD" or legacy
    // "DD/MM/YYYY"), so date-only strings are parsed as LOCAL time (not UTC) to
    // keep getMonth()/getDate() aligned with the user's calendar.
    const parseDob = (raw) => {
      if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
      if (typeof raw === 'string') {
        // "DD/MM/YYYY" legacy format
        const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
          const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
          return isNaN(d.getTime()) ? null : d;
        }
        // "YYYY-MM-DD" — parse as local, not UTC (avoids off-by-one across tz).
        const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) {
          const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
          return isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
      }
      return null;
    };

    const [studentRows, staffRows] = await Promise.allSettled([
      Student.find({
        schoolId: schoolObjId,
        isDeleted: { $ne: true },
        status: 'active',
        dateOfBirth: { $exists: true, $ne: null },
      })
        .populate('classId', 'name section')
        .select('name dateOfBirth classId')
        .lean(),
      Staff.find({
        schoolId: schoolObjId,
        isDeleted: { $ne: true },
        status: 'active',
      })
        .select('name dob dobParsed role department')
        .lean(),
    ]);

    const students =
      studentRows.status === 'fulfilled'
        ? studentRows.value
            .map((s) => {
              const d = s.dateOfBirth instanceof Date ? s.dateOfBirth : parseDob(s.dateOfBirth);
              if (!d) return null;
              if (d.getMonth() + 1 !== todayMonth || d.getDate() !== todayDay) return null;
              const cls = s.classId;
              const label = cls
                ? `${cls.name || ''}${cls.section ? ' ' + cls.section : ''}`.trim()
                : 'Student';
              return { id: `s-${s._id}`, name: s.name, type: 'student', sub: label };
            })
            .filter(Boolean)
        : [];

    const staff =
      staffRows.status === 'fulfilled'
        ? staffRows.value
            .map((s) => {
              // Prefer the migrated parsed Date; fall back to the Mixed dob.
              const d = s.dobParsed instanceof Date ? s.dobParsed : parseDob(s.dob);
              if (!d) return null;
              if (d.getMonth() + 1 !== todayMonth || d.getDate() !== todayDay) return null;
              const sub = [s.role, s.department].filter(Boolean).join(' · ') || 'Staff';
              return { id: `st-${s._id}`, name: s.name, type: 'staff', sub };
            })
            .filter(Boolean)
        : [];

    // Mirror the dashboard's own cap (3 students + 2 staff).
    const birthdays = [...students.slice(0, 3), ...staff.slice(0, 2)];

    return res.json({ birthdays, count: birthdays.length });
  } catch (error) {
    logger.error('Dashboard birthdays error', { error: error.message });
    return res.status(500).json({ error: req.t('common:routes.failedToLoadDashboardStatistics') });
  }
});

export default router;
