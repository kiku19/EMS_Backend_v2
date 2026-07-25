import express from 'express';
import mongoose from 'mongoose';
import {
  Student,
  StudentFeeStructure,
  Attendance,
  Result,
  ActivityLog,
  getNextAdmissionId,
  peekNextAdmissionId,
} from '../../database.js';
import { archiveStudent } from '../../services/studentArchiveService.js';
import { checkPermission } from '../../middleware/permissions.js';
import { resolveAcademicYear, getConfiguredAcademicYear } from '../../utils/academicYear.js';
import { extractSchoolId } from '../../utils/schoolContext.js';
import { incrementUsageMetric } from '../../services/billingService.js';
import { dispatchWebhookEvent } from '../../services/webhookService.js';
import {
  scopeBySchool,
  resolveRequestSchoolId,
  formatStudentClass,
  buildStudentListQuery,
  getStudentListSort,
} from './helpers.js';
import { authenticate } from '../../middleware/auth.js';
import { objectIdParamHandler } from '../../middleware/validation.js';
import { buildPaginationResponse } from '../../utils/pagination.js';
import { validateZod, studentListQuerySchema } from '../../validators/index.js';

/**
 * Returns a shallow copy of `match` with `schoolId` cast to an ObjectId.
 * [BUG-014/018] aggregate() does not apply Mongoose schema casting, so a
 * $match built with the plain-string schoolId matches nothing. countDocuments
 * and find() auto-cast and are unaffected — this is only needed for aggregates.
 * Falls back to the original value if the id isn't a valid ObjectId string.
 */
function withCastedSchoolId(match) {
  if (!match || typeof match !== 'object') return match;
  // buildStudentListQuery returns either a flat conditions object or
  // { $and: [ { schoolId }, ... ] } — handle BOTH shapes, since the schoolId
  // may be nested in the $and array (the common multi-condition case).
  if (Array.isArray(match.$and)) {
    return { ...match, $and: match.$and.map((clause) => withCastedSchoolId(clause)) };
  }
  const raw = match.schoolId;
  if (raw === undefined) return match;
  const str = typeof raw === 'string' ? raw : raw?.toString?.();
  if (str && /^[0-9a-fA-F]{24}$/.test(str)) {
    return { ...match, schoolId: new mongoose.Types.ObjectId(str) };
  }
  return match;
}

const router = express.Router();
router.use(authenticate);
router.param('id', objectIdParamHandler);

router.get(
  '/',
  checkPermission('students', 'view'),
  validateZod(studentListQuerySchema, 'query'),
  async (req, res) => {
    try {
      const {
        classId,
        page = 1,
        limit = 50,
        search = '',
        status = 'all',
        feeStatus = 'all',
        academicYear = 'all',
        sortBy = 'name',
        sortOrder = 'asc',
      } = req.query;
      const rawLimit = parseInt(limit, 10);
      const noPagination = rawLimit === 0;
      const pageNum = noPagination ? 1 : Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = noPagination ? 0 : Math.min(Math.max(rawLimit || 50, 1), 100);
      const skip = noPagination ? 0 : (pageNum - 1) * limitNum;
      const firstAcademicYear = String(academicYear).split(',')[0];
      const resolvedAcademicYear = await resolveAcademicYear(
        firstAcademicYear === 'all' ? undefined : firstAcademicYear
      );
      const schoolId = await resolveRequestSchoolId(req);
      const query = await buildStudentListQuery(
        {
          classId,
          status,
          academicYear,
          search,
          feeStatus,
          schoolId,
        },
        resolvedAcademicYear
      );
      const sort = getStudentListSort(sortBy, sortOrder);

      const baseQuery = await buildStudentListQuery(
        {
          classId,
          status: 'all',
          academicYear,
          search,
          feeStatus,
          schoolId,
        },
        resolvedAcademicYear
      );

      // Fee defaulters are derived from the authoritative fee structure, not
      // Student.feeStatus. The latter is a legacy display field and defaults
      // to `pending` even when a student has no fee structure yet.
      const feeYear =
        resolvedAcademicYear === 'all'
          ? await getConfiguredAcademicYear(schoolId)
          : resolvedAcademicYear;

      const [total, statusCountsAgg, filteredStudentIds] = await Promise.all([
        Student.countDocuments(query),
        Student.aggregate([
          {
            // [BUG-014/018] aggregate() does NOT apply Mongoose schema casting,
            // so a $match on the string schoolId (as built by
            // buildStudentListQuery) matches zero documents and the header /
            // filter badges report 0 while the table renders the real rows.
            // Cast schoolId to ObjectId for the aggregate (the countDocuments
            // path auto-casts and is unaffected). Same pattern as classes.js.
            $match: withCastedSchoolId(baseQuery),
          },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Student.find(baseQuery).distinct('_id'),
      ]);

      const defaulterStudentIds = filteredStudentIds.length
        ? await StudentFeeStructure.find({
            ...(schoolId ? { schoolId } : {}),
            studentId: { $in: filteredStudentIds },
            academicYear: feeYear,
            totalBalance: { $gt: 0 },
            isDeleted: { $ne: true },
          }).distinct('studentId')
        : [];

      const statusCounts = {
        all: 0,
        active: 0,
        inactive: 0,
        alumni: 0,
        transferred: 0,
        graduated: 0,
      };
      for (const { _id, count } of statusCountsAgg) {
        const key = _id || 'active';
        statusCounts[key] = count;
        statusCounts.all += count;
      }

      let students;

      if (sortBy === 'class') {
        // First run aggregation to get sorted + paginated Student._id list —
        // we can't return Student.aggregate() directly because it bypasses
        // the piiPlugin post('find') hook and returns encrypted ciphertext
        // for phone/email/aadhaarNumber/address/parents.phone.
        const pipeline = [
          { $match: query },
          {
            $lookup: {
              from: 'classes',
              localField: 'classId',
              foreignField: '_id',
              as: 'classId',
            },
          },
          {
            $unwind: { path: '$classId', preserveNullAndEmptyArrays: true },
          },
          { $sort: sort },
          { $project: { _id: 1 } },
        ];
        if (!noPagination) {
          pipeline.push({ $skip: skip }, { $limit: limitNum });
        }
        const idRows = await Student.aggregate(pipeline);
        const ids = idRows.map((r) => r._id);
        // Re-fetch via find() so piiPlugin decrypts PII, then reorder to match
        // the aggregation's sort.
        const unsorted = await Student.find({ _id: { $in: ids } })
          .populate('classId', 'name section')
          .lean();
        const byId = new Map(unsorted.map((s) => [String(s._id), s]));
        students = ids.map((id) => byId.get(String(id))).filter(Boolean);
      } else {
        let q = Student.find(query).populate('classId', 'name section').sort(sort);
        if (!noPagination) {
          q = q.skip(skip).limit(limitNum);
        }
        students = await q.lean();
      }

      const studentIds = students.map((student) => student._id);
      // Batch fetch attendance, fee structures, and latest results in parallel
      const [feeStructures, attendanceAgg, latestResults] = await Promise.all([
        StudentFeeStructure.find({
          ...(schoolId ? { schoolId } : {}),
          studentId: { $in: studentIds },
          academicYear: feeYear,
          isDeleted: { $ne: true },
        }),
        Attendance.aggregate([
          {
            $match: {
              studentId: { $in: studentIds },
              ...(schoolId ? { schoolId } : {}),
              ...(feeYear && feeYear !== 'all' ? { academicYear: feeYear } : {}),
            },
          },
          {
            $group: {
              _id: '$studentId',
              total: { $sum: 1 },
              // halfday counts as 0.5 attendance to match the authoritative
              // calculation in routes/attendance.js reports endpoint. Before
              // this fix the student list counted halfday as absent and the
              // report counted it as 0.5 — two different percentages for the
              // same student.
              present: {
                $sum: {
                  $switch: {
                    branches: [
                      { case: { $in: ['$status', ['present', 'late']] }, then: 1 },
                      { case: { $eq: ['$status', 'halfday'] }, then: 0.5 },
                    ],
                    default: 0,
                  },
                },
              },
            },
          },
        ]),
        Result.aggregate([
          {
            $match: {
              studentId: { $in: studentIds },
              isPublished: true,
              // aggregate's $match doesn't cast schoolId via Mongoose's normal
              // cast, so `req.user?.schoolId` as a raw string silently matched
              // zero rows when the stored value was an ObjectId. Use the
              // extracted / normalised schoolId that everything else uses.
              ...(schoolId ? { schoolId } : {}),
            },
          },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$studentId',
              percentage: { $first: '$percentage' },
            },
          },
        ]),
      ]);

      const feeStatusMap = {};
      feeStructures.forEach((feeStructure) => {
        feeStatusMap[feeStructure.studentId.toString()] = feeStructure.overallStatus || 'pending';
      });

      const attendanceMap = {};
      attendanceAgg.forEach(({ _id, total, present }) => {
        attendanceMap[_id.toString()] = total > 0 ? Math.round((present / total) * 100) : null;
      });

      const resultMap = {};
      latestResults.forEach(({ _id, percentage }) => {
        resultMap[_id.toString()] = percentage != null ? Math.round(percentage) : null;
      });

      // Footer totals must describe the full filtered roster, not only the
      // current page returned by server-side pagination.
      const allFilteredIds = await Student.distinct('_id', query);
      const [globalFeeAgg, globalAttAgg] = await Promise.all([
        StudentFeeStructure.aggregate([
          {
            $match: {
              ...(schoolId ? { schoolId } : {}),
              studentId: { $in: allFilteredIds },
              academicYear: feeYear,
              isDeleted: { $ne: true },
            },
          },
          { $group: { _id: null, totalDue: { $sum: '$totalBalance' } } },
        ]),
        Attendance.aggregate([
          {
            $match: {
              studentId: { $in: allFilteredIds },
              ...(schoolId ? { schoolId } : {}),
              ...(feeYear && feeYear !== 'all' ? { academicYear: feeYear } : {}),
            },
          },
          {
            $group: {
              _id: '$studentId',
              total: { $sum: 1 },
              present: {
                $sum: {
                  $switch: {
                    branches: [
                      { case: { $in: ['$status', ['present', 'late']] }, then: 1 },
                      { case: { $eq: ['$status', 'halfday'] }, then: 0.5 },
                    ],
                    default: 0,
                  },
                },
              },
            },
          },
        ]),
      ]);
      const totalDue = globalFeeAgg[0]?.totalDue ?? 0;
      const attPercentages = globalAttAgg
        .map(({ total, present }) => (total > 0 ? (present / total) * 100 : null))
        .filter((value) => value != null && Number.isFinite(value));
      const avgAttendance = attPercentages.length
        ? Math.round(attPercentages.reduce((sum, value) => sum + value, 0) / attPercentages.length)
        : null;

      const formatted = students.map((student) => {
        const classInfo = formatStudentClass(student);
        const currentFeeStatus =
          feeStatusMap[student._id.toString()] || student.feeStatus || 'pending';

        const sid = student._id.toString();
        return {
          id: student._id,
          name: student.name,
          admissionId: student.admissionId,
          academicYear: student.academicYear,
          rollNo: student.rollNo,
          classId: student.classId?._id?.toString() || student.classId?.toString(),
          class: classInfo,
          className: student.classId ? `${student.classId.name} ${student.classId.section}` : null,
          attendancePercentage: attendanceMap[sid] ?? null,
          latestResultPercentage: resultMap[sid] ?? null,
          gender: student.gender,
          dateOfBirth: student.dateOfBirth,
          bloodGroup: student.bloodGroup,
          nationality: student.nationality,
          religion: student.religion,
          category: student.category,
          motherTongue: student.motherTongue,
          phone: student.phone,
          email: student.email,
          address: student.address,
          parents: student.parents,
          siblings: student.siblings,
          previousSchool: student.previousSchool,
          tcNumber: student.tcNumber,
          medicalConditions: student.medicalConditions,
          emergencyContactName: student.emergencyContactName,
          emergencyContactPhone: student.emergencyContactPhone,
          transportRequired: student.transportRequired,
          hostelRequired: student.hostelRequired,
          feeStatus: currentFeeStatus,
          status: student.status,
          isPinned: student.isPinned,
          pinnedAt: student.pinnedAt,
          documents: student.documents,
          photo: student.photo,
          aadhaarNumber: student.aadhaarNumber,
          city: student.city,
          state: student.state,
          zipCode: student.zipCode,
          isWhatsapp: student.isWhatsapp,
          whatsappNumber: student.whatsappNumber,
          mediumOfInstruction: student.mediumOfInstruction,
          house: student.house,
        };
      });

      res.json(
        buildPaginationResponse({
          data: formatted,
          page: pageNum,
          limit: limitNum,
          total,
          noPagination,
          aggregates: {
            totalDue,
            avgAttendance,
            statusCounts,
            defaulters: defaulterStudentIds.length,
          },
          // statusCounts stays a top-level field too for back-compat with
          // existing consumers that read it directly off the response.
          extra: { statusCounts },
        })
      );
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Read-only preview — does NOT increment the counter.
// The actual admission ID is generated atomically by POST /students at creation time.
router.get('/next-admission-id', async (req, res) => {
  try {
    const admissionId = await peekNextAdmissionId(req.user.schoolId);
    res.json({ admissionId });
  } catch (error) {
    console.error('Error previewing admission ID:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', checkPermission('students', 'view'), async (req, res) => {
  try {
    const student = await Student.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    ).populate('classId', 'name section');
    if (!student) {
      return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
    }

    const classInfo = student.classId
      ? `${student.classId.name.replace('Class ', '')}-${student.classId.section}`
      : null;
    const className = student.classId ? `${student.classId.name} ${student.classId.section}` : null;

    res.json({
      id: student._id,
      ...student.toObject(),
      // Normalize classId to a plain string so frontend template literals work correctly
      // (toObject() spreads the populated object; this override ensures a string ID)
      classId: student.classId?._id?.toString() || student.classId?.toString() || null,
      class: classInfo,
      className,
    });
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', checkPermission('students', 'delete'), async (req, res) => {
  try {
    const { student, trashItem, wasActive } = await archiveStudent({
      studentId: req.params.id,
      schoolId: req.user?.schoolId,
      deletedBy: req.user?.id || req.user?._id,
    });

    // Billing and activity are secondary projections. The reversible archive
    // itself has already committed atomically; a metrics outage must not turn
    // a successful archive into an ambiguous 500 response.
    const sideEffects = [];
    if (req.user?.schoolId && wasActive) {
      sideEffects.push(incrementUsageMetric(req.user.schoolId, 'students', -1));
    }

    dispatchWebhookEvent(req.user?.schoolId, 'student.deleted', {
      id: student._id,
      name: student.name,
      admissionId: student.admissionId,
      classId: student.classId,
      academicYear: student.academicYear,
    }).catch(() => {});

    if (req.user?.schoolId) {
      sideEffects.push(
        ActivityLog.create({
          schoolId: extractSchoolId(req.user.schoolId),
          activityType: 'student_deleted',
          description: `Student ${student.name} archived`,
          performedBy: req.user?.id,
          details: { studentId: student._id, name: student.name, admissionId: student.admissionId },
        })
      );
    }
    await Promise.allSettled(sideEffects);

    res.json({
      success: true,
      message: 'Student archived successfully',
      deletedStudentId: student._id,
      trashItemId: trashItem?._id || null,
    });
  } catch (error) {
    console.error('Error deleting student:', error);
    const message = error.status === 404 ? req.t('common:routes.studentNotFound1') : error.message;
    res.status(error.status || 500).json({ error: message });
  }
});

router.put('/:id/pin', checkPermission('students', 'edit'), async (req, res) => {
  try {
    const student = await Student.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { isPinned: true, pinnedAt: new Date() },
      { new: true }
    ).populate('classId', 'name section');

    if (!student) {
      return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
    }

    res.json({
      success: true,
      isPinned: student.isPinned,
      pinnedAt: student.pinnedAt,
    });
  } catch (error) {
    console.error('Error pinning student:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/unpin', checkPermission('students', 'edit'), async (req, res) => {
  try {
    const student = await Student.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { isPinned: false, pinnedAt: null },
      { new: true }
    ).populate('classId', 'name section');

    if (!student) {
      return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
    }

    res.json({
      success: true,
      isPinned: student.isPinned,
      pinnedAt: student.pinnedAt,
    });
  } catch (error) {
    console.error('Error unpinning student:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
