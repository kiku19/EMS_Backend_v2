import express from 'express';
import { z } from 'zod';
import { Student } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/permissions.js';
import { scopeBySchool } from './helpers.js';
import { extractSchoolId } from '../../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

const tcSchema = z.object({
  tcNumber: z.string().min(1, 'TC number is required'),
  issueDate: z.string().min(1, 'Issue date is required'),
  reasonForLeaving: z.string().optional().default(''),
  lastClassAttended: z.string().optional().default(''),
  daysPresent: z.number().int().nonnegative().optional(),
  workingDays: z.number().int().nonnegative().optional(),
  generalConduct: z.string().optional().default('Good'),
  remarks: z.string().optional().default(''),
});

// GET /students/tc/next-number — Generate the next TC number for this school
router.get('/tc/next-number', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);

    // Find the highest TC number issued so far for this school
    const lastStudent = await Student.findOne(
      scopeBySchool(schoolId, { 'transferCertificate.tcNumber': { $exists: true } }),
      { 'transferCertificate.tcNumber': 1 }
    )
      .sort({ 'transferCertificate.issuedAt': -1 })
      .lean();

    let nextNumber = 1;
    if (lastStudent?.transferCertificate?.tcNumber) {
      const lastNum = parseInt(lastStudent.transferCertificate.tcNumber.replace(/\D/g, ''), 10);
      if (!isNaN(lastNum)) nextNumber = lastNum + 1;
    }

    const year = new Date().getFullYear();
    res.json({ tcNumber: `TC-${year}-${String(nextNumber).padStart(4, '0')}` });
  } catch (err) {
    console.error('[TC] next-number error:', err);
    res.status(500).json({ error: 'Failed to generate TC number' });
  }
});

// POST /students/:id/transfer-certificate — Record TC issuance
router.post('/:id/transfer-certificate', checkPermission('students', 'edit'), async (req, res) => {
  try {
    const parsed = tcSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
      });
    }

    const schoolId = extractSchoolId(req.user?.schoolId);
    const student = await Student.findOne(scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }));

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
    } = parsed.data;

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
      issuedBy: req.user.id,
      reasonForLeaving,
      lastClassAttended,
      daysPresent,
      workingDays,
      generalConduct,
      remarks,
    };

    await student.save();

    res.status(201).json({
      success: true,
      message: 'Transfer certificate recorded',
      transferCertificate: student.transferCertificate,
    });
  } catch (err) {
    console.error('[TC] record error:', err);
    res.status(500).json({ error: 'Failed to record transfer certificate' });
  }
});

export default router;
