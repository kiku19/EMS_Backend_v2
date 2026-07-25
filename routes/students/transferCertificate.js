import express from 'express';
import { Student, getNextTransferCertificateNumber } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/permissions.js';
import { validateZod } from '../../middleware/validation.js';
import { studentIdParamSchema, transferCertificateSchema } from '../../validators/index.js';
import { scopeBySchool } from './helpers.js';
import { extractSchoolId } from '../../utils/schoolContext.js';
import { archiveStudent } from '../../services/studentArchiveService.js';

const router = express.Router();
router.use(authenticate);

// GET /students/tc/next-number — atomically reserve the next TC number for this school
router.get('/tc/next-number', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const tcNumber = await getNextTransferCertificateNumber(schoolId);
    res.json({ tcNumber });
  } catch (err) {
    console.error('[TC] next-number error:', err);
    res.status(500).json({ error: 'Failed to generate TC number' });
  }
});

// POST /students/:id/transfer-certificate — Record TC issuance
router.post(
  '/:id/transfer-certificate',
  checkPermission('students', 'edit'),
  validateZod(studentIdParamSchema, 'params'),
  validateZod(transferCertificateSchema),
  async (req, res) => {
    try {
      const schoolId = extractSchoolId(req.user?.schoolId);
      const student = await Student.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );

      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }

      const {
        tcNumber,
        issueDate,
        reasonForLeaving,
        lastClassAttended,
        daysPresent,
        workingDays,
        generalConduct,
        remarks,
      } = req.body;

      // Check for duplicate TC number in this school
      const duplicate = await Student.findOne(
        scopeBySchool(schoolId, {
          'transferCertificate.tcNumber': tcNumber,
          _id: { $ne: student._id },
          isDeleted: { $ne: true },
        })
      ).lean();

      if (duplicate) {
        return res
          .status(409)
          .json({ error: `TC number ${tcNumber} is already assigned to another student` });
      }

      student.transferCertificate = {
        tcNumber,
        issuedAt: new Date(issueDate),
        issuedBy: req.user.userId || req.user.id || req.user._id,
        reasonForLeaving,
        lastClassAttended,
        daysPresent,
        workingDays,
        generalConduct,
        remarks,
      };

      // S12: Issuing a TC must move the student off active rolls — previously
      // only the transferCertificate subdoc was written, so the student stayed
      // 'active' and kept appearing in rosters, attendance, fee rolls, etc.
      // 'transferred' is a valid value on Student.status enum
      // (['active','inactive','graduated','transferred','alumni']).
      student.status = 'transferred';

      await student.save();

      // Run the same dependent-record cascade archiveStudent uses
      // (Attendance/Result/Remark/GatePass/Conversation/Parent.children
      // suppression + trash record) so the transferred student leaves every
      // active surface. archiveStudent also soft-deletes the student and
      // records a trash entry for reversibility.
      await archiveStudent({
        studentId: student._id,
        schoolId,
        deletedBy: req.user.userId || req.user.id || req.user._id,
      });

      // archiveStudent sets status='inactive'; restore the semantically
      // correct 'transferred' status so reports/dashboards distinguish a
      // transfer from a generic archive/deletion.
      await Student.updateOne({ _id: student._id }, { $set: { status: 'transferred' } });

      res.status(201).json({
        success: true,
        message: 'Transfer certificate recorded',
        transferCertificate: student.transferCertificate,
      });
    } catch (err) {
      console.error('[TC] record error:', err);
      if (err?.code === 11000 && err?.keyPattern?.['transferCertificate.tcNumber']) {
        return res.status(409).json({
          error: `TC number ${req.body.tcNumber} is already assigned to another student`,
        });
      }
      res.status(500).json({ error: 'Failed to record transfer certificate' });
    }
  }
);

export default router;
