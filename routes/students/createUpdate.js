import express from 'express';
import mongoose from 'mongoose';
import {
  Student,
  Class,
  StudentFeeStructure,
  Attendance,
  Result,
  getNextAdmissionId,
  getNextRollNumber,
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
import { parseAcademicYear } from '../../utils/academicYear.js';
import {
  scopeBySchool,
  formatStudentClass,
  cleanObject,
  processParents,
  mergeParentsForUpdate,
  mergeSubdocArray,
  mergeNestedObject,
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

        // Auto-assign roll number server-side inside the transaction. The client
        // no longer picks the roll number — `getNextRollNumber` derives the next
        // free slot for the class, and the transaction serialises concurrent
        // admits so two requests can't grab the same number. Any client-supplied
        // `rollNo` is intentionally ignored on create (admins can still adjust it
        // later via PUT). Mirrors how admission IDs are generated.
        const assignedRollNo = await getNextRollNumber(req.body.classId, req.user?.schoolId);

        const studentData = {
          name: req.body.name,
          admissionId: req.body.admissionId,
          academicYear: req.body.academicYear,
          // S1: admissionDate was captured client-side and validated by Zod +
          // declared in the Mongoose model, but never copied into studentData,
          // so it was silently lost on create (and broke TC generator prefill).
          admissionDate: req.body.admissionDate,
          rollNo: assignedRollNo,
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
          // S3: alternatePhone captured by ContactSection, now persisted.
          alternatePhone: req.body.alternatePhone,
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
          // S2: legacy flat allergies list (top-level). The structured home
          // is healthInfo.allergies.
          allergies: req.body.allergies,
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

        await createOrUpdateParentAccount(populatedStudent, {
          session,
          throwOnError: true,
        });
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
        if (error.keyPattern?.email || error.keyPattern?.phone) {
          const field = error.keyPattern.email ? 'email' : 'phone';
          return res.status(409).json({
            error: `A parent account with this ${field} already exists in your school`,
            field: `parents.${field}`,
            code: 11000,
          });
        }
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
        // S1: admissionDate was never copied into updateData, so PUT silently
        // dropped it (also broke TC generator prefill + About-tab display).
        admissionDate: req.body.admissionDate,
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
        // S3: alternatePhone captured by ContactSection, now persisted on update.
        alternatePhone: req.body.alternatePhone,
        email: req.body.email,
        address: req.body.address,
        city: req.body.city,
        state: req.body.state,
        zipCode: req.body.zipCode,
        // S6: parents merge is resolved AFTER originalStudent is fetched
        // (see mergeParentsForUpdate below). Leave undefined here.
        parents: undefined,
        siblings: req.body.siblings,
        previousSchool: req.body.previousSchool,
        tcNumber: req.body.tcNumber,
        mediumOfInstruction: req.body.mediumOfInstruction,
        house: req.body.house,
        medicalConditions: req.body.medicalConditions,
        // S2: legacy flat allergies list (top-level).
        allergies: req.body.allergies,
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

      // S6: Merge incoming parents against the existing array instead of
      // blind $set replacement. The About-tab single-parent edit previously
      // rebuilt a fresh array containing only the edited parent — $set then
      // deleted the other parent AND stripped parentId/isWhatsapp/isParent
      // (which the rebuilt objects omitted). Match by _id first, then by
      // stable identity (name+phone+relationship), falling back to index.
      // Untouched existing parents are carried forward verbatim.
      if (req.body.parents) {
        updateData.parents = mergeParentsForUpdate(
          originalStudent.parents || [],
          processParents(req.body.parents)
        );
      }

      // S8: Same pattern for siblings — carry forward age/class/school that
      // the client's useStudentFormState rebuild drops (it only kept
      // {name, inSameSchool, classId}). Match by _id, then name, then index.
      if (req.body.siblings) {
        updateData.siblings = mergeSubdocArray(
          originalStudent.siblings || [],
          req.body.siblings,
          (existing) => existing.name
        );
      }

      // Nested objects are stored as one Mongoose path. `$set: {healthInfo:
      // partial}` replaces that whole path, so merge the submitted keys over
      // the stored value first. Arrays explicitly supplied by the client still
      // replace their corresponding arrays; omitted sibling keys survive.
      if (req.body.healthInfo != null) {
        updateData.healthInfo = mergeNestedObject(originalStudent.healthInfo, req.body.healthInfo);
      }
      if (req.body.alumniInfo != null) {
        updateData.alumniInfo = mergeNestedObject(originalStudent.alumniInfo, req.body.alumniInfo);
      }
      if (req.body.ratings != null) {
        updateData.ratings = mergeNestedObject(originalStudent.ratings, req.body.ratings);
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
      if (
        classChanged ||
        (updateData.academicYear && updateData.academicYear !== originalStudent.academicYear)
      ) {
        const targetClassId = updateData.classId || originalStudent.classId;
        const targetClass = await Class.findOne(
          scopeBySchool(req.user?.schoolId, {
            _id: targetClassId,
            isDeleted: { $ne: true },
          })
        );
        if (!targetClass) {
          return res
            .status(400)
            .json({ error: req.t('common:routes.targetClassNotFoundInYourSchool') });
        }
        const targetAcademicYear = updateData.academicYear || originalStudent.academicYear;
        if (targetClass.academicYear && targetClass.academicYear !== targetAcademicYear) {
          return res.status(400).json({
            error: `Target class belongs to ${targetClass.academicYear}, not ${targetAcademicYear}`,
          });
        }
        if (classChanged) {
          const capacityResult = await checkClassCapacity(updateData.classId, req.user?.schoolId);
          if (capacityResult?.isFull) {
            return res.status(400).json({
              error: `Target class is at full capacity (${capacityResult.currentCount}/${capacityResult.capacity}).`,
            });
          }
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

      let feeWarning = null;
      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async (session) => {
          const currentStudent = await Student.findOne(
            scopeBySchool(req.user?.schoolId, {
              _id: req.params.id,
              isDeleted: { $ne: true },
            })
          ).session(session);
          if (!currentStudent) {
            const error = new Error(req.t('common:routes.studentNotFound1'));
            error.status = 404;
            throw error;
          }

          const oldAcademicYear = currentStudent.academicYear;
          const oldClassId = currentStudent.classId;
          const historicalFeeStructure = await StudentFeeStructure.findOne({
            studentId: currentStudent._id,
            academicYear: oldAcademicYear,
            schoolId: extractSchoolId(req.user?.schoolId),
          }).session(session);

          Object.assign(currentStudent, updateData);
          await currentStudent.save({ session });

          // A mid-year class move migrates only records from that same
          // academic year. A year transition must leave the prior year's
          // attendance/results in the original class as historical truth.
          if (classChanged && !academicYearChanged) {
            const { startYear, endYear } = parseAcademicYear(oldAcademicYear);
            const yearStartDate = `${startYear}-04-01`;
            const yearEndDate = `${endYear}-03-31`;
            await Attendance.updateMany(
              {
                studentId: currentStudent._id,
                classId: oldClassId,
                schoolId: extractSchoolId(req.user?.schoolId),
                date: { $gte: yearStartDate, $lte: yearEndDate },
                isDeleted: { $ne: true },
              },
              { $set: { classId: currentStudent.classId } },
              { session }
            );
            await Result.updateMany(
              {
                studentId: currentStudent._id,
                classId: oldClassId,
                schoolId: extractSchoolId(req.user?.schoolId),
                academicYear: oldAcademicYear,
                isDeleted: { $ne: true },
              },
              { $set: { classId: currentStudent.classId } },
              { session }
            );
          }

          if (academicYearChanged) {
            await initializeFeeStructure(currentStudent, { session });
          } else if (classChanged) {
            await resyncFeeStructureForClassChange(currentStudent, { session });
          }

          // Student.parents and the canonical Parent collection are one
          // consistency boundary. Reconcile them before commit and propagate
          // any failure so replacing a guardian cannot detach the old account
          // while silently failing to create/link the new one.
          await createOrUpdateParentAccount(currentStudent, {
            session,
            throwOnError: true,
          });

          if ((historicalFeeStructure?.totalBalance || 0) > 0) {
            feeWarning = `Unpaid balance of ₹${historicalFeeStructure.totalBalance} remains recorded against ${oldAcademicYear}.`;
          }
        });
      } finally {
        await mongoSession.endSession();
      }

      const student = await Student.findOne(
        scopeBySchool(req.user?.schoolId, {
          _id: req.params.id,
          isDeleted: { $ne: true },
        })
      ).populate('classId', 'name section');

      dispatchWebhookEvent(req.user?.schoolId, 'student.updated', {
        id: student._id,
        name: student.name,
        admissionId: student.admissionId,
        classId: student.classId?._id ?? student.classId,
        status: student.status,
      }).catch(() => {});

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
      if (error.code === 11000 && (error.keyPattern?.email || error.keyPattern?.phone)) {
        const field = error.keyPattern.email ? 'email' : 'phone';
        return res.status(409).json({
          error: `A parent account with this ${field} already exists in your school`,
          field: `parents.${field}`,
          code: 11000,
        });
      }
      res.status(error.status || 500).json({ error: error.message });
    }
  }
);

export default router;
