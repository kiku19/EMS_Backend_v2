import express from 'express';
import mongoose from 'mongoose';
import {
  Student,
  Class,
  StudentFeeStructure,
  Attendance,
  Result,
  getNextAdmissionId,
} from '../../database.js';
import { createOrUpdateParentAccount } from '../../utils/parentAccountHelper.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/permissions.js';
import { validateZod, createStudentSchema, updateStudentSchema } from '../../validators/index.js';
import { isCoppaApplicable } from '../../utils/coppaUtils.js';
import { incrementUsageMetric } from '../../services/billingService.js';
import { planLimitGate } from '../../middleware/auth/planLimitGate.js';
import { extractSchoolId } from '../../utils/schoolContext.js';
import { checkClassCapacity } from '../../utils/classCapacity.js';
import { dispatchWebhookEvent } from '../../services/webhookService.js';
import { EVENTS, emitEvent } from '../../utils/socketEvents.js';
import { resolveAcademicYear, parseAcademicYear } from '../../utils/academicYear.js';
import {
  scopeBySchool,
  formatStudentClass,
  cleanObject,
  processParents,
  initializeFeeStructure,
  resyncFeeStructureForClassChange,
} from './helpers.js';

const router = express.Router();
router.use(authenticate);

router.post(
  '/',
  authenticate,
  checkPermission('students', 'create'),
  planLimitGate('students'),
  validateZod(createStudentSchema),
  async (req, res) => {
    const mongoSession = await mongoose.startSession();
    try {
      let student;
      let populatedStudent;

      await mongoSession.withTransaction(async (session) => {
        // Auto-generate admission ID server-side if not provided (avoids race condition
        // where a separate GET /next-admission-id call increments the counter but the
        // subsequent student creation fails, permanently consuming the ID).
        if (!req.body.admissionId) {
          req.body.admissionId = await getNextAdmissionId(req.user.schoolId);
        }

        const existingAdmission = await Student.findOne(
          scopeBySchool(req.user?.schoolId, {
            admissionId: req.body.admissionId,
            isDeleted: { $ne: true },
          })
        ).session(session);
        if (existingAdmission) {
          const err = new Error(req.t('common:routes.admissionIdAlreadyExists'));
          err.status = 409;
          err.field = 'admissionId';
          err.value = req.body.admissionId;
          throw err;
        }

        const classExists = await Class.findOne({
          _id: req.body.classId,
          schoolId: req.user?.schoolId,
        }).session(session);
        if (!classExists) {
          const err = new Error(req.t('common:routes.classDoesNotExist'));
          err.status = 400;
          err.field = 'classId';
          err.value = req.body.classId;
          throw err;
        }

        // Check class capacity before allowing student creation
        const capacityResult = await checkClassCapacity(req.body.classId, req.user?.schoolId);
        if (capacityResult && capacityResult.isFull) {
          const err = new Error(
            `Class is at full capacity (${capacityResult.currentCount}/${capacityResult.capacity}). Cannot add more students.`
          );
          err.status = 400;
          err.field = 'classId';
          err.value = req.body.classId;
          throw err;
        }

        if (req.body.rollNo != null) {
          const existingRollNo = await Student.findOne(
            scopeBySchool(req.user?.schoolId, {
              rollNo: req.body.rollNo,
              classId: req.body.classId,
              academicYear: req.body.academicYear,
              isDeleted: { $ne: true },
            })
          ).session(session);

          if (existingRollNo) {
            const err = new Error(
              req.t('common:routes.rollNumberAlreadyExistsInThisClassForTheAcademicYear')
            );
            err.status = 409;
            err.field = 'rollNo';
            err.value = req.body.rollNo;
            throw err;
          }
        }

        const studentData = {
          name: req.body.name,
          admissionId: req.body.admissionId,
          academicYear: req.body.academicYear,
          rollNo: req.body.rollNo,
          classId: req.body.classId,
          schoolId: req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined,
          gender: req.body.gender,
          dateOfBirth: req.body.dateOfBirth,
          bloodGroup: req.body.bloodGroup,
          nationality: req.body.nationality,
          religion: req.body.religion,
          category: req.body.category,
          motherTongue: req.body.motherTongue,
          aadhaarNumber: req.body.aadhaarNumber,
          phone: req.body.phone,
          email: req.body.email,
          address: req.body.address,
          city: req.body.city,
          state: req.body.state,
          zipCode: req.body.zipCode,
          parents: processParents(req.body.parents || []),
          siblings: req.body.siblings,
          previousSchool: req.body.previousSchool,
          tcNumber: req.body.tcNumber,
          mediumOfInstruction: req.body.mediumOfInstruction,
          house: req.body.house,
          medicalConditions: req.body.medicalConditions,
          emergencyContactName: req.body.emergencyContactName,
          emergencyContactPhone: req.body.emergencyContactPhone,
          healthInfo: req.body.healthInfo,
          transportRequired: req.body.transportRequired || false,
          hostelRequired: req.body.hostelRequired || false,
          isWhatsapp: req.body.isWhatsapp || false,
          whatsappNumber: req.body.whatsappNumber,
          // feeStatus is server-derived from the fee structure, never accepted
          // from the client. Always initialise to 'pending' — overallStatus
          // will flip to 'paid'/'partial'/'overdue' as payments land.
          feeStatus: 'pending',
          status: req.body.status || 'active',
          photo: req.body.photo,
          documents: req.body.documents || [],
          // LEGAL-03: COPPA — flag students under 13 for compliance tracking
          coppaApplicable: isCoppaApplicable(req.body.dateOfBirth),
        };

        cleanObject(studentData);

        student = new Student(studentData);
        await student.save({ session });

        if (req.user?.schoolId) {
          await incrementUsageMetric(req.user.schoolId, 'students', 1, { session });
        }

        await initializeFeeStructure(student, { session });

        // Re-fetch to get decrypted PII fields (pre-save encrypts in-place)
        populatedStudent = await Student.findOne({
          _id: student._id,
          schoolId: req.user?.schoolId,
        })
          .populate('classId', 'name section')
          .session(session);

        await createOrUpdateParentAccount(populatedStudent, { session });
      });

      // Non-transactional side effects: webhooks, sockets
      dispatchWebhookEvent(req.user?.schoolId, 'student.created', {
        id: student._id,
        name: student.name,
        admissionId: student.admissionId,
        classId: student.classId,
        academicYear: student.academicYear,
      }).catch(() => {});

      const classInfo = formatStudentClass(populatedStudent);

      const io = req.app.get('io');
      emitEvent(io, EVENTS.STUDENT_CREATED, {
        schoolId: req.user.schoolId?.toString(),
        studentId: populatedStudent._id.toString(),
        name: populatedStudent.name,
        admissionId: populatedStudent.admissionId,
        class: classInfo,
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
        ...populatedStudent.toObject(),
      });
    } catch (error) {
      console.error('Error creating student:', error);

      if (error.code === 11000) {
        const duplicateField = Object.keys(error.keyPattern)[0];
        const fieldLabels = {
          admissionId: 'Admission ID',
          rollNo: 'Roll Number',
        };

        return res.status(409).json({
          error: `${fieldLabels[duplicateField] || duplicateField} already exists`,
          field: duplicateField,
          code: 11000,
        });
      }

      if (error.status) {
        return res.status(error.status).json({
          error: error.message,
          field: error.field,
          value: error.value,
        });
      }

      res.status(error.status || 500).json({
        error: error.message,
        details: error.details,
      });
    } finally {
      await mongoSession.endSession();
    }
  }
);
router.put(
  '/:id',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(updateStudentSchema),
  async (req, res) => {
    try {
      const updateData = {
        name: req.body.name,
        admissionId: req.body.admissionId,
        academicYear: req.body.academicYear,
        rollNo: req.body.rollNo,
        classId: req.body.classId,
        gender: req.body.gender,
        dateOfBirth: req.body.dateOfBirth,
        bloodGroup: req.body.bloodGroup,
        nationality: req.body.nationality,
        religion: req.body.religion,
        category: req.body.category,
        motherTongue: req.body.motherTongue,
        aadhaarNumber: req.body.aadhaarNumber,
        phone: req.body.phone,
        email: req.body.email,
        address: req.body.address,
        city: req.body.city,
        state: req.body.state,
        zipCode: req.body.zipCode,
        parents: req.body.parents ? processParents(req.body.parents) : undefined,
        siblings: req.body.siblings,
        previousSchool: req.body.previousSchool,
        tcNumber: req.body.tcNumber,
        mediumOfInstruction: req.body.mediumOfInstruction,
        house: req.body.house,
        medicalConditions: req.body.medicalConditions,
        emergencyContactName: req.body.emergencyContactName,
        emergencyContactPhone: req.body.emergencyContactPhone,
        // Reject client-supplied null for nested objects — the buggy
        // behaviour silently wiped healthInfo / alumniInfo / ratings when a
        // partial client form sent {healthInfo:null}. Treat null as
        // "don't touch" (same as undefined).
        healthInfo: req.body.healthInfo != null ? req.body.healthInfo : undefined,
        transportRequired: req.body.transportRequired,
        hostelRequired: req.body.hostelRequired,
        isWhatsapp: req.body.isWhatsapp,
        whatsappNumber: req.body.whatsappNumber,
        // feeStatus is server-derived — not accepted from the client.
        status: req.body.status,
        photo: req.body.photo,
        documents: Array.isArray(req.body.documents) ? req.body.documents : undefined,
        alumniInfo: req.body.alumniInfo != null ? req.body.alumniInfo : undefined,
        ratings: req.body.ratings != null ? req.body.ratings : undefined,
      };

      // Auto-set alumniInfo.since when status is first changed to alumni
      if (req.body.status === 'alumni') {
        if (!updateData.alumniInfo) updateData.alumniInfo = {};
        if (!updateData.alumniInfo.since) {
          updateData.alumniInfo.since = new Date().toISOString();
        }
      }

      cleanObject(updateData);

      const originalStudent = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!originalStudent) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      // Optimistic locking: if the client sent the updatedAt it loaded, reject if stale
      if (req.body.clientUpdatedAt) {
        const clientTs = new Date(req.body.clientUpdatedAt).getTime();
        const serverTs = new Date(originalStudent.updatedAt).getTime();
        if (clientTs !== serverTs) {
          return res.status(409).json({
            error:
              'This student record was modified in another tab or session. Please close this form and reopen to get the latest data.',
            code: 'STALE_DATA',
          });
        }
      }

      // Check admissionId uniqueness when it changes
      if (updateData.admissionId && updateData.admissionId !== originalStudent.admissionId) {
        const duplicateAdmission = await Student.findOne(
          scopeBySchool(req.user?.schoolId, {
            _id: { $ne: req.params.id },
            admissionId: updateData.admissionId,
            isDeleted: { $ne: true },
          })
        );
        if (duplicateAdmission) {
          return res.status(409).json({
            error: req.t('common:routes.admissionIdAlreadyExists'),
            field: 'admissionId',
            value: updateData.admissionId,
          });
        }
      }

      // Validate target class exists in the same school when classId changes
      const classChanged =
        updateData.classId && updateData.classId !== originalStudent.classId?.toString();
      if (classChanged) {
        const targetClass = await Class.findOne(
          scopeBySchool(req.user?.schoolId, { _id: updateData.classId })
        );
        if (!targetClass) {
          return res
            .status(400)
            .json({ error: req.t('common:routes.targetClassNotFoundInYourSchool') });
        }
        const capacityResult = await checkClassCapacity(updateData.classId, req.user?.schoolId);
        if (capacityResult?.isFull) {
          return res.status(400).json({
            error: `Target class is at full capacity (${capacityResult.currentCount}/${capacityResult.capacity}).`,
          });
        }
      }

      // Check roll number uniqueness on update if rollNo, classId, or academicYear changed
      const rollNoChanged = 'rollNo' in updateData && updateData.rollNo !== originalStudent.rollNo;
      const academicYearChanged =
        updateData.academicYear && updateData.academicYear !== originalStudent.academicYear;

      if (rollNoChanged || classChanged || academicYearChanged) {
        const checkRollNo = 'rollNo' in updateData ? updateData.rollNo : originalStudent.rollNo;
        const checkClassId = updateData.classId ?? originalStudent.classId?.toString();
        const checkAcademicYear = updateData.academicYear ?? originalStudent.academicYear;

        if (checkRollNo != null) {
          const duplicateRollNo = await Student.findOne(
            scopeBySchool(req.user?.schoolId, {
              _id: { $ne: req.params.id },
              rollNo: checkRollNo,
              classId: checkClassId,
              academicYear: checkAcademicYear,
              isDeleted: { $ne: true },
            })
          );

          if (duplicateRollNo) {
            return res.status(409).json({
              error: req.t('common:routes.rollNumberAlreadyExistsInThisClassForTheAcademicYear'),
              field: 'rollNo',
              value: checkRollNo,
            });
          }
        }
      }

      // Use $set so mongoose doesn't treat nested objects (feeDetails,
      // alumniInfo, healthInfo) as full subdocument replacements when only
      // a subset of keys is provided. Without this wrap, sending just
      // {alumniInfo: {since: '2024'}} would erase alumniInfo.reunionEmail
      // etc.
      const student = await Student.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
        { $set: updateData },
        { new: true }
      ).populate('classId', 'name section');
      if (!student) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      dispatchWebhookEvent(req.user?.schoolId, 'student.updated', {
        id: student._id,
        name: student.name,
        admissionId: student.admissionId,
        classId: student.classId?._id ?? student.classId,
        status: student.status,
      }).catch(() => {});

      try {
        await createOrUpdateParentAccount(student);
      } catch (parentError) {
        console.error('Error auto-syncing parent accounts:', parentError);
      }

      let feeWarning = null;
      try {
        if (classChanged || academicYearChanged) {
          const resolvedYear = await resolveAcademicYear(student.academicYear);

          // Check for unpaid balance before modifying fee structure
          const currentFeeStructure = await StudentFeeStructure.findOne({
            studentId: student._id,
            academicYear: resolvedYear,
            schoolId: extractSchoolId(req.user?.schoolId),
          });
          const unpaidBalance = currentFeeStructure?.totalBalance || 0;

          // Migrate attendance and result records to the new class so they remain
          // visible in new-class-scoped queries (fixes AUDIT-343 / AUDIT-15)
          if (classChanged) {
            const { startYear, endYear } = parseAcademicYear(resolvedYear);
            const yearStartDate = `${startYear}-04-01`;
            const yearEndDate = `${endYear}-03-31`;

            await Attendance.updateMany(
              {
                studentId: student._id,
                classId: originalStudent.classId,
                schoolId: req.user?.schoolId,
                date: { $gte: yearStartDate, $lte: yearEndDate },
              },
              { $set: { classId: updateData.classId } }
            );

            await Result.updateMany(
              {
                studentId: student._id,
                classId: originalStudent.classId,
                schoolId: req.user?.schoolId,
                academicYear: resolvedYear,
                isDeleted: { $ne: true },
              },
              { $set: { classId: updateData.classId } }
            );
          }

          // Re-align fee structure to the new class WITHOUT wiping paid
          // amounts. The previous deleteMany+init flow zeroed every recorded
          // paidAmount, so a student who had paid ₹10k appeared to owe the
          // full new-class amount. resyncFeeStructureForClassChange merges
          // new feeHeads over the existing structure, preserves paidAmount
          // on carry-over heads, and keeps old-class heads that still have
          // payment history so FeePayment refunds stay consistent.
          if (academicYearChanged) {
            // Academic-year change is a fresh start — initialise into the new
            // year instead of merging across year boundaries.
            await initializeFeeStructure(student);
          } else {
            await resyncFeeStructureForClassChange(student);
          }

          if (unpaidBalance > 0) {
            feeWarning = `Unpaid balance of ₹${unpaidBalance} was affected by the class/academic-year change.`;
          }
        }

        // feeStatus is no longer client-settable so the previous sync block
        // (copying updateData.feeStatus onto feeStructure.overallStatus) is
        // removed — overallStatus is authored by the fee/payment code paths.
      } catch (feeError) {
        console.error('Error syncing fee structure:', feeError);
      }

      const classFormatted = student.classId
        ? `${student.classId.name.replace('Class ', '')}-${student.classId.section}`
        : student.class || null;

      const response = {
        id: student._id,
        ...student.toObject(),
        class: classFormatted,
      };
      if (feeWarning) {
        response.warning = feeWarning;
      }

      res.json(response);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
