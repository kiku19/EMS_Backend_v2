import { z } from 'zod';

// ─── PUT /staff-id-config ───────────────────────────────────────
export const updateStaffIdConfigSchema = z.object({
  prefix: z.string().min(1).max(20).trim(),
  separator: z.string().max(5).default(''),
  includeYear: z.boolean().default(false),
  startingNumber: z.number().int().min(1),
  digits: z.number().int().min(1).max(10),
});

// ─── PUT /school-settings ───────────────────────────────────────
const holidaySchema = z.object({
  name: z.string().min(1),
  date: z.string(),
  type: z.string().optional(),
  description: z.string().optional(),
});

const leaveTypeSchema = z.object({
  name: z.string().min(1),
  quota: z.number().int().min(0).default(0),
  applicableTo: z.string().default('both'),
  requiresApproval: z.boolean().default(true),
  approver: z.string().default('reporter'),
  paid: z.boolean().default(true),
  color: z.string().optional(),
});

const feeTermSchema = z.object({
  name: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  dueDate: z.string().optional(),
});

const customDurationSchema = z.object({
  name: z.string().optional(),
  months: z.array(z.number().int()).optional(),
});

const subjectSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  description: z.string().optional(),
});

const paymentModeSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
});

const allowedDiscountSchema = z.object({
  name: z.string().optional(),
  percentage: z.number().optional(),
  requiresApproval: z.boolean().optional(),
});

export const updateSchoolSettingsSchema = z.object({
  name: z.string().max(200).optional(),
  schoolName: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  website: z.string().optional(),
  logo: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  customDomain: z.string().optional(),
  udiseNo: z.string().optional(),
  affiliationNo: z.string().optional(),
  boardOfEducation: z.string().optional(),
  principalSignature: z.string().optional(),
  correspondentSignature: z.string().optional(),
  academicYear: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  currentSession: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  // Changing the active academic year pivots every fee structure, attendance
  // roll, and report card onto a new baseline. Doing it accidentally from this
  // generic settings endpoint (rather than the dedicated PUT /academic-year
  // route which runs a transition preview) is destructive, so require an
  // explicit confirm:true flag — mirroring academicYearSchema in
  // routes/settings/school.js. The handler enforces it whenever academicYear
  // or currentSession is present in the body.
  confirm: z.literal(true).optional(),
  academicYearStart: z.string().optional(),
  academicYearEnd: z.string().optional(),
  schoolStartTime: z.string().optional(),
  schoolEndTime: z.string().optional(),
  periodDuration: z.number().int().min(1).optional(),
  periodsPerDay: z.number().int().min(1).optional(),
  workingDays: z.array(z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])).optional(),
  holidays: z.array(holidaySchema).optional(),
  leaveTypes: z.array(leaveTypeSchema).optional(),
  feeCollection: z
    .object({
      collectionMode: z.enum(['term', 'monthly', 'quarterly', 'yearly', 'custom']).optional(),
      numberOfTerms: z.number().int().min(1).optional(),
      terms: z.array(feeTermSchema).optional(),
      customDurations: z.array(customDurationSchema).optional(),
    })
    .optional(),
  lateFee: z
    .object({
      enabled: z.boolean().optional(),
      amount: z.number().min(0).optional(),
      gracePeriodDays: z.number().int().min(0).optional(),
      maxLateFee: z.number().min(0).optional(),
    })
    .optional(),
  discount: z
    .object({
      enabled: z.boolean().optional(),
      requireApproval: z.boolean().optional(),
      maxDiscountPercentage: z.number().min(0).max(100).optional(),
      allowedDiscounts: z.array(allowedDiscountSchema).optional(),
    })
    .optional(),
  receipt: z
    .object({
      prefix: z.string().max(20).optional(),
      startingNumber: z.number().int().min(1).optional(),
    })
    .optional(),
  paymentModes: z.array(paymentModeSchema).optional(),
  payroll: z
    .object({
      disburseDate: z.number().int().min(1).max(31).optional(),
      payrollCycle: z.enum(['weekly', 'biweekly', 'monthly']).optional(),
    })
    .optional(),
  tc: z
    .object({
      prefix: z.string().max(20).optional(),
      currentNumber: z.number().int().min(1).optional(),
    })
    .optional(),
  subjects: z.array(subjectSchema).optional(),
  onboardingCompleted: z.boolean().optional(),
  onboardingProgress: z
    .object({
      schoolProfile: z.boolean().optional(),
      academicYear: z.boolean().optional(),
      classes: z.boolean().optional(),
      feeHeads: z.boolean().optional(),
      students: z.boolean().optional(),
      staff: z.boolean().optional(),
      notifications: z.boolean().optional(),
    })
    .optional(),
  backupSchedule: z
    .object({
      enabled: z.boolean().optional(),
      frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
      dayOfWeek: z.number().int().min(0).max(6).optional(),
      notifyEmail: z.string().optional(),
    })
    .optional(),
  language: z
    .object({
      defaultLanguage: z.enum(['en', 'hi', 'ta', 'te', 'kn', 'ur']).optional(),
      supportedLanguages: z.array(z.enum(['en', 'hi', 'ta', 'te', 'kn', 'ur'])).optional(),
      dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
      numberFormat: z.enum(['en-IN', 'en-US']).optional(),
      enableBilingualReports: z.boolean().optional(),
      bilingualReportLanguage: z.enum(['en', 'hi', 'ta', 'te', 'kn', 'ur']).optional(),
    })
    .optional(),
});
