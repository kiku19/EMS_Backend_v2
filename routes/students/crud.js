import express from 'express';
import {
  Student,
  StudentFeeStructure,
  Attendance,
  Result,
  ActivityLog,
  getNextAdmissionId,
} from '../../database.js';
import { permanentlyDeleteStudentData } from '../../services/studentDataErasureService.js';
import { logToTrash } from '../../services/trashService.js';
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

const router = express.Router();

router.get('/', checkPermission('students', 'view'), async (req, res) => {
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
    const resolvedAcademicYear = await resolveAcademicYear(academicYear);
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

    const [total, statusCountsAgg] = await Promise.all([
      Student.countDocuments(query),
      Student.aggregate([
        { $match: baseQuery },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

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
          $unwind: {
            path: '$classId',
            preserveNullAndEmptyArrays: true,
          },
        },
        { $sort: sort },
      ];
      if (!noPagination) {
        pipeline.push({ $skip: skip }, { $limit: limitNum });
      }
      students = await Student.aggregate(pipeline);
    } else {
      let q = Student.find(query).populate('classId', 'name section').sort(sort);
      if (!noPagination) {
        q = q.skip(skip).limit(limitNum);
      }
      students = await q.lean();
    }

    const studentIds = students.map((student) => student._id);
    // When academicYear is 'all', use the school's configured year for fee lookups
    const feeYear =
      resolvedAcademicYear === 'all'
        ? await getConfiguredAcademicYear(schoolId)
        : resolvedAcademicYear;

    // Batch fetch attendance, fee structures, and latest results in parallel
    const [feeStructures, attendanceAgg, latestResults] = await Promise.all([
      StudentFeeStructure.find({
        ...(schoolId ? { schoolId } : {}),
        studentId: { $in: studentIds },
        academicYear: feeYear,
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
            present: {
              $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] },
            },
          },
        },
      ]),
      Result.aggregate([
        {
          $match: {
            studentId: { $in: studentIds },
            isPublished: true,
            schoolId: req.user?.schoolId,
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

    const formatted = students.map((student) => {
      const classInfo = formatStudentClass(student);
      const currentFeeStatus = feeStatusMap[student._id.toString()] || student.feeStatus || 'pending';

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
        parentName: student.parentName,
        parentPhone: student.parentPhone,
        parentEmail: student.parentEmail,
        parentRelationship: student.parentRelationship,
        parentOccupation: student.parentOccupation,
        alternatePhone: student.alternatePhone,
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

    res.json({
      data: formatted,
      statusCounts,
      pagination: {
        currentPage: noPagination ? 1 : pageNum,
        totalPages: noPagination ? 1 : Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: noPagination ? total : limitNum,
        hasNextPage: noPagination ? false : pageNum < Math.ceil(total / limitNum),
        hasPrevPage: noPagination ? false : pageNum > 1,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/next-admission-id', async (req, res) => {
  try {
    const admissionId = await getNextAdmissionId(req.user.schoolId);
    res.json({ admissionId });
  } catch (error) {
    console.error('Error generating admission ID:', error);
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
    // Verify student belongs to this school before deleting
    const student = await Student.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!student) {
      return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
    }

    // AUDIT-284: Capture active status BEFORE mutation for billing metric
    const wasActive = student.status === 'active';

    // Snapshot before mutation for trash logging
    const studentSnapshot = student.toObject();

    // Soft delete: mark as deleted instead of permanent removal
    student.isDeleted = true;
    student.deletedAt = new Date();
    student.status = 'inactive';
    await student.save();

    // Log to trash for restore capability (await to return trashItemId for undo)
    let trashItemId = null;
    try {
      const trashItem = await logToTrash({
        itemType: 'Student',
        itemId: student._id,
        itemName: student.name || 'Student',
        originalData: studentSnapshot,
        deletedBy: req.user?.id || req.user?._id,
        schoolId: req.user?.schoolId,
      });
      trashItemId = trashItem?._id || null;
    } catch (trashErr) {
      console.error('Failed to log student to trash:', trashErr);
    }

    if (req.user?.schoolId && wasActive) {
      await incrementUsageMetric(req.user.schoolId, 'students', -1);
    }

    dispatchWebhookEvent(req.user?.schoolId, 'student.deleted', {
      id: student._id,
      name: student.name,
      admissionId: student.admissionId,
      classId: student.classId,
      academicYear: student.academicYear,
    }).catch(() => {});

    if (req.user?.schoolId) {
      await ActivityLog.create({
        schoolId: extractSchoolId(req.user.schoolId),
        activityType: 'student_deleted',
        description: `Student ${student.name} soft-deleted`,
        performedBy: req.user?.id,
        details: { studentId: student._id, name: student.name, admissionId: student.admissionId },
      });
    }

    res.json({
      success: true,
      message: 'Student deleted successfully',
      deletedStudentId: student._id,
      trashItemId,
    });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(error.status || 500).json({ error: error.message });
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
