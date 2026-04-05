import express from 'express';
import { z } from 'zod';
import { SchoolSettings, Student, Class, Exam, Staff } from '../../database.js';
import School from '../../models/School.js';
import SchoolGroup from '../../models/SchoolGroup.js';
import { authenticate } from '../../middleware/auth.js';
import FeeHead from '../../models/FeeHead.js';
import StudentFeeStructure from '../../models/StudentFeeStructure.js';
import { CURRENT_ACADEMIC_YEAR } from '../../utils/constants.js';
import {
  ensureSchoolSettings,
  getDefaultSchoolSettings,
  isValidAcademicYear,
  parseAcademicYear,
} from '../../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';
import { checkPermission } from '../../middleware/auth/permissions.js';

const router = express.Router();

// Public branding endpoint — no auth required, used on login page
// Query: ?schoolCode=ABC or ?domain=school.example.com
router.get('/public-branding', async (req, res) => {
  try {
    const { schoolCode, domain } = req.query;
    if (!schoolCode && !domain) {
      return res.status(400).json({ error: 'schoolCode or domain is required' });
    }

    let school = null;
    if (domain) {
      const normalizedDomain = domain.toLowerCase().trim();

      // 1) Check per-school custom domain in SchoolSettings
      const settings = await SchoolSettings.findOne({ customDomain: normalizedDomain })
        .select('schoolId name logo primaryColor secondaryColor')
        .lean();
      if (settings) {
        return res.json({
          schoolName: settings.name,
          logo: settings.logo || null,
          primaryColor: settings.primaryColor || '#0d9488',
          secondaryColor: settings.secondaryColor || '#134e4a',
          source: 'school',
        });
      }

      // 2) Check group-level white-label domain
      const group = await SchoolGroup.findOne({
        'whiteLabelSettings.customDomain': normalizedDomain,
        'whiteLabelSettings.enabled': true,
        'whiteLabelSettings.domainVerified': true,
      })
        .select('name whiteLabelSettings')
        .lean();

      if (group) {
        const b = group.whiteLabelSettings?.branding || {};
        return res.json({
          schoolName: b.appName || group.name,
          logo: b.logo || null,
          favicon: b.favicon || null,
          primaryColor: b.primaryColor || '#0d9488',
          secondaryColor: b.secondaryColor || '#134e4a',
          source: 'group',
          groupId: group._id,
        });
      }

      return res.status(404).json({ error: 'No school found for this domain' });
    }

    school = await School.findOne({ code: schoolCode.trim(), status: 'active' })
      .select('_id name')
      .lean();
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    const settings = await SchoolSettings.findOne({ schoolId: school._id })
      .select('name logo primaryColor secondaryColor')
      .lean();

    res.json({
      schoolName: settings?.name || school.name,
      logo: settings?.logo || null,
      primaryColor: settings?.primaryColor || '#0d9488',
      secondaryColor: settings?.secondaryColor || '#134e4a',
    });
  } catch (error) {
    console.error('Error fetching public branding:', error);
    res.status(500).json({ error: 'Failed to fetch branding' });
  }
});
router.use(authenticate);

const getSettingsQuery = (req) => buildSchoolScopedQuery(req.user?.schoolId);
const findSchoolSettings = (req) => SchoolSettings.findOne(getSettingsQuery(req));

const academicYearSchema = z.object({
  academicYear: z.string().trim().refine(isValidAcademicYear, {
    message:
      'academicYear must be in YYYY-YY format where YY = last two digits of the following year (e.g. "2025-26")',
  }),
  academicYearStart: z.string().optional(),
  academicYearEnd: z.string().optional(),
});

const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

const schoolSettingsSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  schoolName: z.string().trim().min(1).max(200).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().or(z.literal('')).optional(),
  website: z.string().url().or(z.literal('')).optional(),
  logo: z.string().optional(),
  primaryColor: z
    .string()
    .regex(hexColorRegex, 'Must be a valid hex color (e.g. #0d9488)')
    .optional(),
  secondaryColor: z
    .string()
    .regex(hexColorRegex, 'Must be a valid hex color (e.g. #134e4a)')
    .optional(),
  customDomain: z
    .string()
    .refine((v) => v === '' || domainRegex.test(v), {
      message: 'Must be a valid domain (e.g. school.example.com)',
    })
    .optional(),
  udiseNo: z.string().max(20).optional(),
  affiliationNo: z.string().max(50).optional(),
  boardOfEducation: z.string().max(100).optional(),
  principalSignature: z.string().optional(),
  correspondentSignature: z.string().optional(),
  examDefaults: z
    .object({
      maxMarks: z.number().int().min(1).max(1000).optional(),
      passingMarks: z.number().int().min(0).max(1000).optional(),
      duration: z.number().int().min(1).max(600).optional(),
      weightage: z.number().int().min(0).max(100).optional(),
      defaultTerm: z.string().max(50).optional(),
    })
    .optional(),
  gradingScale: z
    .array(
      z.object({
        minPercentage: z.number().min(0).max(100),
        grade: z.string().trim().min(1).max(10),
        color: z.string().regex(hexColorRegex).or(z.literal('')).optional(),
      })
    )
    .optional(),
  reportCardFormat: z
    .object({
      boardType: z.enum(['CBSE', 'ICSE', 'StateBoard', 'IB', 'IGCSE', 'Custom']).optional(),
      customTitle: z.string().max(100).optional(),
      showGrade: z.boolean().optional(),
      showMarks: z.boolean().optional(),
      showRank: z.boolean().optional(),
      showAttendance: z.boolean().optional(),
      showRemarks: z.boolean().optional(),
      useGradePoints: z.boolean().optional(),
      passingGrade: z.string().max(5).optional(),
    })
    .optional(),
  attendanceRules: z
    .object({
      defaulterThreshold: z.number().int().min(0).max(100).optional(),
      lockTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/, 'Must be in HH:MM format')
        .optional(),
      allowEdit: z.boolean().optional(),
      editWindow: z
        .number()
        .int()
        .refine((v) => [12, 24, 48].includes(v), { message: 'Must be 12, 24, or 48' })
        .optional(),
      notifyAbsent: z.boolean().optional(),
      notifyDefaulter: z.boolean().optional(),
      permissions: z
        .array(
          z.object({
            role: z.string().min(1),
            canMark: z.boolean(),
            canEdit: z.boolean(),
            canLock: z.boolean(),
          })
        )
        .optional(),
    })
    .optional(),
});

const DEFAULT_GRADING_SCALE = [
  { minPercentage: 90, grade: 'A+', color: '#16a34a' },
  { minPercentage: 80, grade: 'A', color: '#22c55e' },
  { minPercentage: 70, grade: 'B+', color: '#2563eb' },
  { minPercentage: 60, grade: 'B', color: '#3b82f6' },
  { minPercentage: 50, grade: 'C+', color: '#d97706' },
  { minPercentage: 40, grade: 'C', color: '#f59e0b' },
  { minPercentage: 35, grade: 'D', color: '#ea580c' },
  { minPercentage: 0, grade: 'F', color: '#dc2626' },
];

const BOARD_CONFIG_PRESETS = {
  CBSE: {
    boardType: 'CBSE',
    customTitle: 'PROGRESS REPORT',
    showGrade: true,
    showMarks: true,
    showRank: false,
    showAttendance: true,
    showRemarks: true,
    useGradePoints: false,
    passingGrade: 'D',
    gradingScale: [
      { minPercentage: 91, grade: 'A1', color: '#16a34a' },
      { minPercentage: 81, grade: 'A2', color: '#22c55e' },
      { minPercentage: 71, grade: 'B1', color: '#2563eb' },
      { minPercentage: 61, grade: 'B2', color: '#3b82f6' },
      { minPercentage: 51, grade: 'C1', color: '#d97706' },
      { minPercentage: 41, grade: 'C2', color: '#f59e0b' },
      { minPercentage: 33, grade: 'D', color: '#ea580c' },
      { minPercentage: 21, grade: 'E1', color: '#dc2626' },
      { minPercentage: 0, grade: 'E2', color: '#b91c1c' },
    ],
  },
  ICSE: {
    boardType: 'ICSE',
    customTitle: 'REPORT CARD',
    showGrade: true,
    showMarks: true,
    showRank: true,
    showAttendance: true,
    showRemarks: true,
    useGradePoints: false,
    passingGrade: 'C',
    gradingScale: [
      { minPercentage: 90, grade: 'A+', color: '#16a34a' },
      { minPercentage: 80, grade: 'A', color: '#22c55e' },
      { minPercentage: 70, grade: 'B+', color: '#2563eb' },
      { minPercentage: 60, grade: 'B', color: '#3b82f6' },
      { minPercentage: 50, grade: 'C+', color: '#d97706' },
      { minPercentage: 40, grade: 'C', color: '#f59e0b' },
      { minPercentage: 35, grade: 'D', color: '#ea580c' },
      { minPercentage: 0, grade: 'F', color: '#dc2626' },
    ],
  },
  StateBoard: {
    boardType: 'StateBoard',
    customTitle: 'PROGRESS REPORT CARD',
    showGrade: true,
    showMarks: true,
    showRank: true,
    showAttendance: true,
    showRemarks: true,
    useGradePoints: false,
    passingGrade: 'D',
    gradingScale: [
      { minPercentage: 90, grade: 'A+', color: '#16a34a' },
      { minPercentage: 80, grade: 'A', color: '#22c55e' },
      { minPercentage: 70, grade: 'B+', color: '#2563eb' },
      { minPercentage: 60, grade: 'B', color: '#3b82f6' },
      { minPercentage: 50, grade: 'C+', color: '#d97706' },
      { minPercentage: 40, grade: 'C', color: '#f59e0b' },
      { minPercentage: 35, grade: 'D', color: '#ea580c' },
      { minPercentage: 0, grade: 'F', color: '#dc2626' },
    ],
  },
  IB: {
    boardType: 'IB',
    customTitle: 'ACADEMIC REPORT',
    showGrade: true,
    showMarks: true,
    showRank: false,
    showAttendance: true,
    showRemarks: true,
    useGradePoints: true,
    passingGrade: '3',
    gradingScale: [
      { minPercentage: 86, grade: '7', color: '#16a34a' },
      { minPercentage: 72, grade: '6', color: '#22c55e' },
      { minPercentage: 58, grade: '5', color: '#2563eb' },
      { minPercentage: 44, grade: '4', color: '#d97706' },
      { minPercentage: 30, grade: '3', color: '#ea580c' },
      { minPercentage: 16, grade: '2', color: '#dc2626' },
      { minPercentage: 0, grade: '1', color: '#b91c1c' },
    ],
  },
  IGCSE: {
    boardType: 'IGCSE',
    customTitle: 'CAMBRIDGE IGCSE REPORT',
    showGrade: true,
    showMarks: true,
    showRank: false,
    showAttendance: true,
    showRemarks: true,
    useGradePoints: false,
    passingGrade: 'C',
    gradingScale: [
      { minPercentage: 90, grade: 'A*', color: '#16a34a' },
      { minPercentage: 80, grade: 'A', color: '#22c55e' },
      { minPercentage: 70, grade: 'B', color: '#2563eb' },
      { minPercentage: 60, grade: 'C', color: '#3b82f6' },
      { minPercentage: 50, grade: 'D', color: '#d97706' },
      { minPercentage: 40, grade: 'E', color: '#f59e0b' },
      { minPercentage: 30, grade: 'F', color: '#ea580c' },
      { minPercentage: 0, grade: 'G', color: '#dc2626' },
    ],
  },
  Custom: {
    boardType: 'Custom',
    customTitle: '',
    showGrade: true,
    showMarks: true,
    showRank: true,
    showAttendance: true,
    showRemarks: true,
    useGradePoints: false,
    passingGrade: 'D',
    gradingScale: DEFAULT_GRADING_SCALE,
  },
};

// Get school settings
router.get('/school', authenticate, async (req, res) => {
  try {
    const settings = await ensureSchoolSettings(req.user?.schoolId);
    res.json(settings);
  } catch (error) {
    console.error('Error fetching school settings:', error);
    res.status(500).json({ error: 'Failed to fetch school settings' });
  }
});

// Get exam defaults from school settings
router.get('/exam-defaults', authenticate, async (req, res) => {
  try {
    const settings = await ensureSchoolSettings(req.user?.schoolId);
    const d = settings.examDefaults || {};
    res.json({
      maxMarks: d.maxMarks ?? 100,
      passingMarks: d.passingMarks ?? 35,
      duration: d.duration ?? 60,
      weightage: d.weightage ?? 10,
      defaultTerm: d.defaultTerm ?? 'Term 1',
    });
  } catch (error) {
    console.error('Error fetching exam defaults:', error);
    res.status(500).json({ error: 'Failed to fetch exam defaults' });
  }
});

// Get exam config (terms, types, and grading scale) from school settings
router.get('/exam-config', authenticate, async (req, res) => {
  try {
    const settings = await ensureSchoolSettings(req.user?.schoolId);
    res.json({
      examTerms: settings.examTerms?.length
        ? settings.examTerms
        : ['Term 1', 'Term 2', 'Term 3', 'Final'],
      examTypes: settings.examTypes?.length
        ? settings.examTypes
        : ['written', 'oral', 'practical', 'project', 'assignment'],
      gradingScale: settings.gradingScale?.length ? settings.gradingScale : DEFAULT_GRADING_SCALE,
    });
  } catch (error) {
    console.error('Error fetching exam config:', error);
    res.status(500).json({ error: 'Failed to fetch exam config' });
  }
});

// ─── Attendance Rules ────────────────────────────────────────────────────

const DEFAULT_ATTENDANCE_PERMISSIONS = [
  { role: 'Super Admin', canMark: true, canEdit: true, canLock: true },
  { role: 'Admin', canMark: true, canEdit: true, canLock: true },
  { role: 'Teacher', canMark: true, canEdit: false, canLock: false },
];

const DEFAULT_ATTENDANCE_RULES = {
  defaulterThreshold: 75,
  lockTime: '16:00',
  allowEdit: true,
  editWindow: 24,
  notifyAbsent: true,
  notifyDefaulter: true,
  lateWeight: 100,
  permissions: DEFAULT_ATTENDANCE_PERMISSIONS,
};

// Get attendance rules
router.get('/attendance-rules', authenticate, async (req, res) => {
  try {
    const settings = await ensureSchoolSettings(req.user?.schoolId);
    const rules = settings.attendanceRules || {};
    res.json({
      defaulterThreshold: rules.defaulterThreshold ?? DEFAULT_ATTENDANCE_RULES.defaulterThreshold,
      lockTime: rules.lockTime ?? DEFAULT_ATTENDANCE_RULES.lockTime,
      allowEdit: rules.allowEdit ?? DEFAULT_ATTENDANCE_RULES.allowEdit,
      editWindow: rules.editWindow ?? DEFAULT_ATTENDANCE_RULES.editWindow,
      notifyAbsent: rules.notifyAbsent ?? DEFAULT_ATTENDANCE_RULES.notifyAbsent,
      notifyDefaulter: rules.notifyDefaulter ?? DEFAULT_ATTENDANCE_RULES.notifyDefaulter,
      lateWeight: rules.lateWeight ?? DEFAULT_ATTENDANCE_RULES.lateWeight,
      permissions: rules.permissions?.length ? rules.permissions : DEFAULT_ATTENDANCE_PERMISSIONS,
    });
  } catch (error) {
    console.error('Error fetching attendance rules:', error);
    res.status(500).json({ error: 'Failed to fetch attendance rules' });
  }
});

// Update attendance rules
const attendanceRulesSchema = z
  .object({
    defaulterThreshold: z.number().int().min(0).max(100).optional(),
    lockTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'Must be in HH:MM format')
      .optional(),
    allowEdit: z.boolean().optional(),
    editWindow: z
      .number()
      .int()
      .refine((v) => [12, 24, 48].includes(v), { message: 'Must be 12, 24, or 48' })
      .optional(),
    notifyAbsent: z.boolean().optional(),
    notifyDefaulter: z.boolean().optional(),
    lateWeight: z.number().int().min(0).max(100).optional(),
    permissions: z
      .array(
        z.object({
          role: z.string().min(1),
          canMark: z.boolean(),
          canEdit: z.boolean(),
          canLock: z.boolean(),
        })
      )
      .optional(),
  })
  .strict();

router.put(
  '/attendance-rules',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const parsed = attendanceRulesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const settings = await ensureSchoolSettings(req.user?.schoolId);
      const current = settings.attendanceRules || {};
      const updated = { ...current, ...parsed.data };

      await SchoolSettings.updateOne({ _id: settings._id }, { $set: { attendanceRules: updated } });

      const refreshed = await SchoolSettings.findById(settings._id).lean();
      res.json(refreshed.attendanceRules || updated);
    } catch (error) {
      console.error('Error updating attendance rules:', error);
      res.status(500).json({ error: 'Failed to update attendance rules' });
    }
  }
);

// Get board config presets
router.get('/board-config/presets', authenticate, async (req, res) => {
  try {
    res.json(BOARD_CONFIG_PRESETS);
  } catch (error) {
    console.error('Error fetching board config presets:', error);
    res.status(500).json({ error: 'Failed to fetch board config presets' });
  }
});

// Update school settings (admin/settings-edit only)
router.put('/school', authenticate, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const parsed = schoolSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    let settings = await findSchoolSettings(req);
    const updates = { ...parsed.data };

    // NOTE: academicYear updates must go through PUT /academic-year which has
    // dedicated Zod validation (academicYearSchema).  Unknown keys are stripped
    // by Zod's default behavior, so stray academicYear keys are safely ignored.

    if (updates.name && !updates.schoolName) {
      updates.schoolName = updates.name;
    }

    if (updates.schoolName && !updates.name) {
      updates.name = updates.schoolName;
    }

    if (!settings) {
      settings = await SchoolSettings.create({
        ...getDefaultSchoolSettings(req.user?.schoolId),
        ...updates,
      });
    } else {
      // Use dot-notation $set for nested objects so partial updates don't
      // overwrite siblings (e.g. sending { examDefaults: { maxMarks: 50 } }
      // should not erase examDefaults.passingMarks).
      const flatUpdates = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [nestedKey, nestedVal] of Object.entries(value)) {
            flatUpdates[`${key}.${nestedKey}`] = nestedVal;
          }
        } else {
          flatUpdates[key] = value;
        }
      }

      await SchoolSettings.updateOne({ _id: settings._id }, { $set: flatUpdates });
      settings = await SchoolSettings.findById(settings._id);
    }

    res.json(settings);
  } catch (error) {
    console.error('Error updating school settings:', error);
    res.status(500).json({ error: 'Failed to update school settings' });
  }
});

router.get('/academic-year', authenticate, async (req, res) => {
  try {
    const settings = await ensureSchoolSettings(req.user?.schoolId);

    res.json({
      academicYear: settings.academicYear || CURRENT_ACADEMIC_YEAR,
      academicYearStart: settings.academicYearStart || '',
      academicYearEnd: settings.academicYearEnd || '',
    });
  } catch (error) {
    console.error('Error fetching academic year settings:', error);
    res.status(500).json({ error: 'Failed to fetch academic year settings' });
  }
});

router.put(
  '/academic-year',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const parsed = academicYearSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }

      const { academicYear, academicYearStart, academicYearEnd } = parsed.data;
      const settings = await ensureSchoolSettings(req.user?.schoolId);
      const { startYear, endYear } = parseAcademicYear(academicYear);

      settings.academicYear = academicYear;
      settings.currentSession = academicYear;
      settings.academicYearStart = academicYearStart || `${startYear}-04-01`;
      settings.academicYearEnd = academicYearEnd || `${endYear}-03-31`;

      await settings.save();

      res.json({
        academicYear: settings.academicYear,
        academicYearStart: settings.academicYearStart,
        academicYearEnd: settings.academicYearEnd,
      });
    } catch (error) {
      console.error('Error updating academic year settings:', error);
      res.status(500).json({ error: 'Failed to update academic year settings' });
    }
  }
);

// Preview the impact of switching academic year before committing the change
router.get('/academic-year/transition-preview', authenticate, async (req, res) => {
  try {
    const { targetYear } = req.query;

    if (!targetYear || !isValidAcademicYear(targetYear)) {
      return res.status(400).json({
        error: 'targetYear query param is required and must be in YYYY-YY format (e.g. "2025-26")',
      });
    }

    const schoolId = req.user?.schoolId;
    const settings = await ensureSchoolSettings(schoolId);
    const currentYear = settings.academicYear || CURRENT_ACADEMIC_YEAR;

    if (targetYear === currentYear) {
      return res.status(400).json({ error: 'targetYear is already the current academic year' });
    }

    const scope = buildSchoolScopedQuery(schoolId);

    const [
      studentsInCurrentYear,
      classesInCurrentYear,
      activeExamsInCurrentYear,
      unpaidFeeStructures,
      studentsInTargetYear,
      classesInTargetYear,
    ] = await Promise.all([
      Student.countDocuments({ ...scope, academicYear: currentYear, isDeleted: { $ne: true } }),
      Class.countDocuments({ ...scope, academicYear: currentYear, isDeleted: { $ne: true } }),
      Exam.countDocuments({
        ...scope,
        academicYear: currentYear,
        isDeleted: { $ne: true },
        status: { $in: ['upcoming', 'ongoing'] },
      }),
      StudentFeeStructure.countDocuments({
        ...scope,
        academicYear: currentYear,
        overallStatus: { $in: ['pending', 'partial'] },
      }),
      Student.countDocuments({ ...scope, academicYear: targetYear, isDeleted: { $ne: true } }),
      Class.countDocuments({ ...scope, academicYear: targetYear, isDeleted: { $ne: true } }),
    ]);

    res.json({
      currentYear,
      targetYear,
      currentYearData: {
        students: studentsInCurrentYear,
        classes: classesInCurrentYear,
        activeExams: activeExamsInCurrentYear,
        unpaidFeeStructures,
      },
      targetYearData: {
        students: studentsInTargetYear,
        classes: classesInTargetYear,
      },
      warnings: [
        unpaidFeeStructures > 0
          ? `${unpaidFeeStructures} student(s) have unpaid/partial fees in ${currentYear}. Fee structures will NOT auto-copy to ${targetYear} — create them manually after transition.`
          : null,
        activeExamsInCurrentYear > 0
          ? `${activeExamsInCurrentYear} exam(s) are still active in ${currentYear}. Complete or cancel them before switching years.`
          : null,
        studentsInTargetYear === 0
          ? `No students found for ${targetYear} yet. Promote students or create new admissions after switching.`
          : null,
        classesInTargetYear === 0
          ? `No classes found for ${targetYear} yet. Create classes for ${targetYear} after switching.`
          : null,
      ].filter(Boolean),
    });
  } catch (error) {
    console.error('Error fetching academic year transition preview:', error);
    res.status(500).json({ error: 'Failed to fetch transition preview' });
  }
});

// Get onboarding status — dynamically checks actual data presence per step
router.get('/onboarding-status', authenticate, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const scope = buildSchoolScopedQuery(schoolId);

    const [settings, classCount, feeHeadCount, studentCount, staffCount] = await Promise.all([
      ensureSchoolSettings(schoolId),
      Class.countDocuments({ ...scope, isDeleted: { $ne: true } }),
      FeeHead.countDocuments({ ...scope, isDeleted: { $ne: true } }),
      Student.countDocuments({ ...scope, isDeleted: { $ne: true } }),
      Staff.countDocuments({ ...scope, isDeleted: { $ne: true } }),
    ]);

    const progress = {
      schoolProfile: !!(settings.name && settings.name !== 'School Name' && settings.address),
      academicYear: !!(settings.academicYear && settings.academicYear.match(/^\d{4}-\d{2}$/)),
      classes: classCount > 0,
      feeHeads: feeHeadCount > 0,
      students: studentCount > 0,
      staff: staffCount > 0,
      notifications: !!settings.onboardingProgress?.notifications,
    };

    const completedCount = Object.values(progress).filter(Boolean).length;

    res.json({
      progress,
      completedCount,
      totalSteps: 7,
      onboardingCompleted: settings.onboardingCompleted || false,
      lastNudgeSentAt: settings.onboardingProgress?.lastNudgeSentAt || null,
    });
  } catch (error) {
    console.error('Error fetching onboarding status:', error);
    res.status(500).json({ error: 'Failed to fetch onboarding status' });
  }
});

// Update onboarding step progress flag (for steps that can't be auto-detected)
router.put(
  '/onboarding-progress',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const { step, done = true } = req.body;
      const validSteps = [
        'schoolProfile',
        'academicYear',
        'classes',
        'feeHeads',
        'students',
        'staff',
        'notifications',
      ];
      if (!step || !validSteps.includes(step)) {
        return res.status(400).json({ error: `step must be one of: ${validSteps.join(', ')}` });
      }

      const settings = await ensureSchoolSettings(req.user?.schoolId);
      if (!settings.onboardingProgress) settings.onboardingProgress = {};
      settings.onboardingProgress[step] = done;
      settings.markModified('onboardingProgress');
      await settings.save();

      res.json({ ok: true, step, done });
    } catch (error) {
      console.error('Error updating onboarding progress:', error);
      res.status(500).json({ error: 'Failed to update onboarding progress' });
    }
  }
);

export default router;
