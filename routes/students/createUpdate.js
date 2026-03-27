import express from 'express';
import { Student, Class, StudentFeeStructure } from '../../database.js';
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
import { resolveAcademicYear } from '../../utils/academicYear.js';
import {
  scopeBySchool,
  formatStudentClass,
  cleanObject,
  processParents,
  initializeFeeStructure,
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
    try {
      const existingAdmission = await Student.findOne(
        scopeBySchool(req.user?.schoolId, {
          admissionId: req.body.admissionId,
          isDeleted: { $ne: true },
        })
      );
      if (existingAdmission) {
        return res.status(409).json({
          error: req.t('common:routes.admissionIdAlreadyExists'),
          field: 'admissionId',
          value: req.body.admissionId,
        });
      }

      const classExists = await Class.findById(req.body.classId);
      if (!classExists) {
        return res.status(400).json({
          error: req.t('common:routes.classDoesNotExist'),
          field: 'classId',
          value: req.body.classId,
        });
      }

      // Check class capacity before allowing student creation
      const capacityResult = await checkClassCapacity(req.body.classId, req.user?.schoolId);
      if (capacityResult && capacityResult.isFull) {
        return res.status(400).json({
          error: `Class is at full capacity (${capacityResult.currentCount}/${capacityResult.capacity}). Cannot add more students.`,
          field: 'classId',
          value: req.body.classId,
        });
      }

      if (req.body.rollNo != null) {
        const existingRollNo = await Student.findOne(
          scopeBySchool(req.user?.schoolId, {
            rollNo: req.body.rollNo,
            classId: req.body.classId,
            academicYear: req.body.academicYear,
            isDeleted: { $ne: true },
          })
        );

        if (existingRollNo) {
          return res.status(409).json({
            error: req.t('common:routes.rollNumberAlreadyExistsInThisClassForTheAcademicYear'),
            field: 'rollNo',
            value: req.body.rollNo,
          });
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
        parentName: req.body.parentName,
        parentPhone: req.body.parentPhone,
        parentEmail: req.body.parentEmail,
        parentRelationship: req.body.parentRelationship,
        parentOccupation: req.body.parentOccupation,
        alternatePhone: req.body.alternatePhone,
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
        feeStatus: req.body.feeStatus || 'pending',
        status: req.body.status || 'active',
        photo: req.body.photo,
        documents: req.body.documents || [],
        // LEGAL-03: COPPA — flag students under 13 for compliance tracking
        coppaApplicable: isCoppaApplicable(req.body.dateOfBirth),
      };

      cleanObject(studentData);

      const student = new Student(studentData);
      await student.save();

      dispatchWebhookEvent(req.user?.schoolId, 'student.created', {
        id: student._id,
        name: student.name,
        admissionId: student.admissionId,
        classId: student.classId,
        academicYear: student.academicYear,
      }).catch(() => {});

      if (req.user?.schoolId) {
        await incrementUsageMetric(req.user.schoolId, 'students', 1);
      }

      try {
        await initializeFeeStructure(student);
      } catch (feeError) {
        console.error('Error auto-initializing fee structure:', feeError);
      }

      // Re-fetch to get decrypted PII fields (pre-save encrypts in-place)
      const populatedStudent = await Student.findById(student._id).populate(
        'classId',
        'name section'
      );

      try {
        await createOrUpdateParentAccount(populatedStudent);
      } catch (parentError) {
        console.error('Error auto-creating parent accounts:', parentError);
      }
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

      res.status(error.status || 500).json({
        error: error.message,
        details: error.details,
      });
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
        parentName: req.body.parentName,
        parentPhone: req.body.parentPhone,
        parentEmail: req.body.parentEmail,
        parentRelationship: req.body.parentRelationship,
        parentOccupation: req.body.parentOccupation,
        alternatePhone: req.body.alternatePhone,
        parents: req.body.parents ? processParents(req.body.parents) : undefined,
        siblings: req.body.siblings,
        previousSchool: req.body.previousSchool,
        tcNumber: req.body.tcNumber,
        mediumOfInstruction: req.body.mediumOfInstruction,
        house: req.body.house,
        medicalConditions: req.body.medicalConditions,
        emergencyContactName: req.body.emergencyContactName,
        emergencyContactPhone: req.body.emergencyContactPhone,
        healthInfo: req.body.healthInfo !== undefined ? req.body.healthInfo : undefined,
        transportRequired: req.body.transportRequired,
        hostelRequired: req.body.hostelRequired,
        isWhatsapp: req.body.isWhatsapp,
        whatsappNumber: req.body.whatsappNumber,
        feeStatus: req.body.feeStatus,
        status: req.body.status,
        photo: req.body.photo,
        documents: Array.isArray(req.body.documents) ? req.body.documents : undefined,
        alumniInfo: req.body.alumniInfo !== undefined ? req.body.alumniInfo : undefined,
        ratings: req.body.ratings !== undefined ? req.body.ratings : undefined,
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

      const student = await Student.findOneAndUpdate(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id }),
        updateData,
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

      try {
        if (classChanged || academicYearChanged) {
          // Warn if there are unpaid fees before wiping the fee structure
          const unpaidFees = await StudentFeeStructure.find({
            schoolId: req.user?.schoolId,
            studentId: student._id,
            totalBalance: { $gt: 0 },
          });

          if (unpaidFees.length > 0) {
            const totalUnpaid = unpaidFees.reduce((sum, fs) => sum + fs.totalBalance, 0);
            console.warn(
              `Deleting fee structures for student ${student._id} with ₹${totalUnpaid} unpaid balance`
            );
          }

          const resolvedYear = await resolveAcademicYear(student.academicYear);
          await StudentFeeStructure.deleteMany({
            studentId: student._id,
            academicYear: resolvedYear,
          });
          await initializeFeeStructure(student);
        }

        if (updateData.feeStatus && updateData.feeStatus !== originalStudent.feeStatus) {
          const feeStructure = await StudentFeeStructure.findOne({
            schoolId: req.user?.schoolId,
            studentId: student._id,
            academicYear: await resolveAcademicYear(student.academicYear),
          });

          if (feeStructure) {
            feeStructure.overallStatus = updateData.feeStatus;
            await feeStructure.save();
          }
        }
      } catch (feeError) {
        console.error('Error syncing fee structure:', feeError);
      }

      const classFormatted = student.classId
        ? `${student.classId.name.replace('Class ', '')}-${student.classId.section}`
        : student.class || null;

      res.json({
        id: student._id,
        ...student.toObject(),
        class: classFormatted,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
