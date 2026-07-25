import { resolveAcademicYear } from '../utils/academicYear.js';
import express from 'express';
import mongoose from 'mongoose';
import { FeeStructure, Class } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { validateObjectIdParam } from '../middleware/validation.js';
import { applyClassFeeStructureToStudents } from '../utils/applyClassFeeStructure.js';
import { createLogger } from '../utils/logger.js';
import {
  validateZod,
  saveFeeStructureSchema,
  applyFeeStructureSchema,
  feeStructureSummaryQuerySchema,
} from '../validators/index.js';

const logger = createLogger('FeeStructure');

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) return extractSchoolId(req.user.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

// Bulk summary: returns the fee-structure status for every class in one
// academic year in a single request. Used by the dashboard to avoid an N+1
// fan-out of GET /fee-structure/class/:classId calls (one per class). Returns
// only the fields the class grid needs (annual total, mode, applied count,
// template name); unset classes are simply absent from `structures`.
router.get('/', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const parsed = feeStructureSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.flatten(),
      });
    }

    const schoolId = await resolveRequestSchoolId(req);
    const resolvedAcademicYear = await resolveAcademicYear(
      parsed.data.academicYear,
      req.user?.schoolId
    );

    const structures = await FeeStructure.find(
      scopeBySchool(schoolId, { academicYear: resolvedAcademicYear })
    )
      .populate('templateId', 'name')
      .lean();

    const payload = structures.map((s) => ({
      classId: String(s.classId),
      isSet: true,
      totalAnnualFee: s.totalAnnualFee ?? 0,
      collectionMode: s.collectionSchedule?.mode || null,
      appliedCount: Array.isArray(s.appliedTo) ? s.appliedTo.length : 0,
      templateName: s.templateId?.name || null,
    }));

    res.json({ academicYear: resolvedAcademicYear, structures: payload });
  } catch (error) {
    logger.error('GET /fee-structure (bulk) failed', error);
    res.status(500).json({ error: error.message });
  }
});

// Get fee structure for a class (single object)
router.get(
  '/class/:classId',
  checkPermission('fees', 'view'),
  validateObjectIdParam('classId'),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const resolvedAcademicYear = await resolveAcademicYear(
        req.query.academicYear,
        req.user?.schoolId
      );

      const classExists = await Class.findOne(scopeBySchool(req.user?.schoolId, { _id: classId }));
      if (!classExists) {
        return res.status(404).json({ error: 'Class not found' });
      }

      const feeStructure = await FeeStructure.findOne(
        scopeBySchool(req.user?.schoolId, {
          classId,
          academicYear: resolvedAcademicYear,
        })
      ).populate('templateId', 'name section totalAnnualFee');

      if (!feeStructure) {
        return res.json({
          _initialized: false,
          classId,
          academicYear: resolvedAcademicYear,
          feeHeads: [],
          collectionSchedule: { mode: 'term', installments: [] },
          totalAnnualFee: 0,
          appliedTo: [],
        });
      }

      res.json(feeStructure);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Create or update fee structure for a class (upsert)
router.post(
  '/',
  checkPermission('fees', 'create'),
  validateZod(saveFeeStructureSchema),
  async (req, res) => {
    const session = await mongoose.startSession();
    try {
      const { classId, academicYear, templateId, feeHeads, collectionSchedule, totalAnnualFee } =
        req.body;
      const resolvedAcademicYear = await resolveAcademicYear(academicYear, req.user?.schoolId);
      const schoolId = await resolveRequestSchoolId(req);
      let structure;
      let appliedCount = 0;
      await session.withTransaction(async () => {
        const classDoc = await Class.findOne(
          scopeBySchool(schoolId, {
            _id: classId,
            academicYear: resolvedAcademicYear,
            isDeleted: { $ne: true },
          })
        ).session(session);
        if (!classDoc) {
          const classError = new Error('Class not found for this academic year');
          classError.code = 'CLASS_NOT_FOUND';
          throw classError;
        }

        const existingStructure = await FeeStructure.findOne(
          scopeBySchool(schoolId, { classId, academicYear: resolvedAcademicYear })
        ).session(session);
        const normalizedFeeHeads = feeHeads.map((head) => {
          if (head.feeHeadId) return head;
          const prior = existingStructure?.feeHeads?.find(
            (candidate) =>
              String(candidate.name || '')
                .trim()
                .toLowerCase() ===
              String(head.name || '')
                .trim()
                .toLowerCase()
          );
          return prior ? { ...head, feeHeadId: prior.feeHeadId || prior._id } : head;
        });

        const structureUpdate = {
          $set: {
            schoolId,
            classId,
            academicYear: resolvedAcademicYear,
            feeHeads: normalizedFeeHeads,
            collectionSchedule,
            totalAnnualFee,
            appliedDate: new Date(),
            ...(templateId ? { templateId } : {}),
          },
          ...(!templateId ? { $unset: { templateId: 1 } } : {}),
        };
        structure = await FeeStructure.findOneAndUpdate(
          scopeBySchool(schoolId, { classId, academicYear: resolvedAcademicYear }),
          structureUpdate,
          { new: true, upsert: true, runValidators: true, session }
        );

        const result = await applyClassFeeStructureToStudents(structure, {
          schoolId,
          academicYear: resolvedAcademicYear,
          session,
          abortOnError: true,
        });
        appliedCount = result.appliedCount;
        structure.appliedTo = result.appliedStudentIds;
        await structure.save({ session });
      });

      res.status(201).json({ ...structure.toObject(), appliedCount });
    } catch (error) {
      if (error.code === 'CLASS_NOT_FOUND') {
        return res.status(404).json({ error: error.message });
      }
      logger.error({ err: error }, 'Failed to save and apply fee structure');
      res.status(500).json({ error: error.message });
    } finally {
      await session.endSession();
    }
  }
);

// Apply class fee structure to all students in the class.
// Note: since the save endpoint now auto-applies, this explicit endpoint is
// mostly a re-apply / recovery tool. It reuses the same merge helper so the
// semantics are identical.
router.post(
  '/apply-to-students',
  checkPermission('fees', 'edit'),
  validateZod(applyFeeStructureSchema),
  async (req, res) => {
    const session = await mongoose.startSession();
    try {
      const { classId, academicYear } = req.body;
      const resolvedAcademicYear = await resolveAcademicYear(academicYear, req.user?.schoolId);
      const schoolId = await resolveRequestSchoolId(req);

      let classStructure;
      let appliedCount = 0;
      await session.withTransaction(async () => {
        classStructure = await FeeStructure.findOne(
          scopeBySchool(schoolId, { classId, academicYear: resolvedAcademicYear })
        ).session(session);
        if (!classStructure) {
          const missingError = new Error(
            req.t('common:routes.feeStructureNotFoundForThisClassPleaseSaveAFeeStructureFirst')
          );
          missingError.code = 'FEE_STRUCTURE_NOT_FOUND';
          throw missingError;
        }

        const result = await applyClassFeeStructureToStudents(classStructure, {
          schoolId,
          academicYear: resolvedAcademicYear,
          session,
          abortOnError: true,
        });
        appliedCount = result.appliedCount;
        classStructure.appliedTo = result.appliedStudentIds;
        classStructure.appliedDate = new Date();
        await classStructure.save({ session });
      });

      res.json({
        success: true,
        message: `Fee structure successfully applied/updated for ${appliedCount} students.`,
        appliedCount,
      });
    } catch (error) {
      if (error.code === 'FEE_STRUCTURE_NOT_FOUND') {
        return res.status(404).json({ error: error.message });
      }
      logger.error({ err: error }, 'Failed to apply fee structure');
      res.status(500).json({ error: error.message });
    } finally {
      await session.endSession();
    }
  }
);

export default router;
