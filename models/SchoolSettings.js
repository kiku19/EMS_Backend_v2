import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const schoolSettingsSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, default: 'School Name', trim: true },
    schoolName: { type: String, default: 'School Name', trim: true },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    website: { type: String, default: '' },
    logo: { type: String, default: '' },
    primaryColor: { type: String, default: '#0d9488' },
    secondaryColor: { type: String, default: '#134e4a' },
    customDomain: { type: String, default: '' },
    udiseNo: { type: String, default: '' },
    affiliationNo: { type: String, default: '' },
    boardOfEducation: { type: String, default: '' },
    principalSignature: { type: String, default: '' },
    correspondentSignature: { type: String, default: '' },
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
    currentSession: { type: String, default: CURRENT_ACADEMIC_YEAR },
    academicYearStart: { type: String, default: '' },
    academicYearEnd: { type: String, default: '' },
    schoolStartTime: { type: String, default: '08:00' },
    schoolEndTime: { type: String, default: '15:00' },
    periodDuration: { type: Number, default: 45 },
    periodsPerDay: { type: Number, default: 8 },
    workingDays: [
      {
        type: String,
        enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      },
    ],
    holidays: [
      {
        name: { type: String, required: true },
        date: { type: String, required: true },
        type: { type: String, default: 'General' },
        description: { type: String, default: '' },
      },
    ],
    leaveTypes: [
      {
        name: { type: String, required: true },
        quota: { type: Number, default: 0 },
        applicableTo: { type: String, default: 'both' },
        requiresApproval: { type: Boolean, default: true },
        approver: { type: String, default: 'reporter' },
        paid: { type: Boolean, default: true },
        color: { type: String, default: '' },
      },
    ],

    // Fee Collection Configuration
    feeCollection: {
      collectionMode: {
        type: String,
        enum: ['term', 'monthly', 'quarterly', 'yearly', 'custom'],
        default: 'term',
      },
      numberOfTerms: { type: Number, default: 2 },
      terms: [
        {
          name: String,
          startDate: String,
          endDate: String,
          dueDate: String,
        },
      ],
      customDurations: [
        {
          name: String,
          months: [Number],
        },
      ],
    },

    lateFee: {
      enabled: { type: Boolean, default: false },
      amount: { type: Number, default: 0 },
      gracePeriodDays: { type: Number, default: 7 },
      maxLateFee: { type: Number, default: 1000 },
    },

    discount: {
      enabled: { type: Boolean, default: true },
      requireApproval: { type: Boolean, default: true },
      maxDiscountPercentage: { type: Number, default: 10 },
      allowedDiscounts: [
        {
          name: String,
          percentage: Number,
          requiresApproval: Boolean,
        },
      ],
    },

    receipt: {
      prefix: { type: String, default: 'RCP' },
      startingNumber: { type: Number, default: 1001 },
      currentNumber: { type: Number, default: 1001 },
    },

    paymentModes: [
      {
        name: String,
        enabled: Boolean,
      },
    ],

    // Attendance Rules Configuration
    attendanceRules: {
      defaulterThreshold: { type: Number, default: 75, min: 0, max: 100 },
      lockTime: { type: String, default: '16:00' },
      allowEdit: { type: Boolean, default: true },
      editWindow: { type: Number, default: 24, enum: [12, 24, 48] },
      notifyAbsent: { type: Boolean, default: true },
      notifyDefaulter: { type: Boolean, default: true },
      lateWeight: { type: Number, default: 100, min: 0, max: 100 },
      permissions: [
        {
          role: { type: String, required: true },
          canMark: { type: Boolean, default: false },
          canEdit: { type: Boolean, default: false },
          canLock: { type: Boolean, default: false },
        },
      ],
    },

    // Payroll Configuration
    payroll: {
      disburseDate: { type: Number, default: 1, min: 1, max: 31 },
      payrollCycle: { type: String, default: 'monthly', enum: ['weekly', 'biweekly', 'monthly'] },
      paymentMethod: {
        type: String,
        default: 'bank_transfer',
        enum: ['bank_transfer', 'cheque', 'cash', 'upi'],
      },
      autoReminder: { type: Boolean, default: false },
      reminderDays: { type: Number, default: 3, min: 0, max: 30 },
    },

    // Salary Component Definitions (earnings / deductions templates)
    salaryComponents: {
      earnings: [
        {
          id: { type: String, required: true },
          name: { type: String, required: true },
        },
      ],
      deductions: [
        {
          id: { type: String, required: true },
          name: { type: String, required: true },
        },
      ],
    },

    // Transfer Certificate Configuration
    tc: {
      prefix: { type: String, default: 'TC' },
      currentNumber: { type: Number, default: 1 },
    },

    // Subjects Configuration (master directory — synced to Class documents)
    subjects: [
      {
        name: { type: String, required: true },
        code: { type: String },
        description: { type: String },
        assignedClasses: [{ type: Number }], // class numbers 1-12
      },
    ],

    // Exam Configuration
    examTerms: [{ type: String }],
    examTypes: [{ type: String }],
    gradingScale: [
      {
        minPercentage: { type: Number, required: true, min: 0, max: 100 },
        grade: { type: String, required: true, trim: true },
        color: { type: String, default: '' },
      },
    ],

    // Exam Defaults
    examDefaults: {
      maxMarks: { type: Number, default: 100 },
      passingMarks: { type: Number, default: 35 },
      duration: { type: Number, default: 60 },
      weightage: { type: Number, default: 10 },
      defaultTerm: { type: String, default: 'Term 1' },
    },

    // Report Card Format Configuration
    reportCardFormat: {
      boardType: {
        type: String,
        enum: ['CBSE', 'ICSE', 'StateBoard', 'IB', 'IGCSE', 'Custom'],
        default: 'Custom',
      },
      customTitle: { type: String, default: '' },
      showGrade: { type: Boolean, default: true },
      showMarks: { type: Boolean, default: true },
      showRank: { type: Boolean, default: true },
      showAttendance: { type: Boolean, default: true },
      showRemarks: { type: Boolean, default: true },
      useGradePoints: { type: Boolean, default: false },
      passingGrade: { type: String, default: 'D' },
    },

    // Onboarding
    onboardingCompleted: { type: Boolean, default: false },
    onboardingProgress: {
      schoolProfile: { type: Boolean, default: false },
      academicYear: { type: Boolean, default: false },
      classes: { type: Boolean, default: false },
      feeHeads: { type: Boolean, default: false },
      students: { type: Boolean, default: false },
      staff: { type: Boolean, default: false },
      notifications: { type: Boolean, default: false },
      lastNudgeSentAt: { type: Date, default: null },
      nudgeCount: { type: Number, default: 0 },
    },

    // Backup Schedule Configuration
    backupSchedule: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'weekly' },
      dayOfWeek: { type: Number, min: 0, max: 6, default: 0 }, // 0=Sun for weekly
      notifyEmail: { type: String, default: '' },
      lastAutoBackupAt: { type: Date, default: null },
    },

    // Email Domain Configuration (DKIM/SPF/DMARC)
    emailDomain: {
      sendingDomain: { type: String, default: '' },
      senderEmail: { type: String, default: '' },
      senderName: { type: String, default: '' },
      dkimSelector: { type: String, default: 'ems' },
      dkimPrivateKey: { type: String, default: '' },
      dkimPublicKey: { type: String, default: '' },
      dmarcPolicy: { type: String, enum: ['none', 'quarantine', 'reject'], default: 'none' },
      dmarcReportingEmail: { type: String, default: '' },
      spfVerified: { type: Boolean, default: false },
      dkimVerified: { type: Boolean, default: false },
      dmarcVerified: { type: Boolean, default: false },
      verificationStatus: {
        type: String,
        enum: ['unverified', 'partial', 'verified'],
        default: 'unverified',
      },
      lastVerifiedAt: { type: Date, default: null },
    },

    // Communication Settings (SMS & Email gateway config)
    communicationSettings: {
      sms: {
        enabled: { type: Boolean, default: true },
        provider: { type: String, enum: ['twilio', 'msg91', 'textlocal'], default: 'twilio' },
        senderId: { type: String, default: '' },
        apiKey: { type: String, default: '' },
      },
      email: {
        enabled: { type: Boolean, default: true },
        provider: { type: String, enum: ['smtp', 'sendgrid', 'mailgun'], default: 'smtp' },
        smtpHost: { type: String, default: '' },
        port: { type: String, default: '587' },
        username: { type: String, default: '' },
        password: { type: String, default: '' },
      },
    },

    // Currency Configuration (ISO 4217 code, e.g. 'INR', 'USD', 'EUR')
    currency: { type: String, default: 'INR', trim: true, uppercase: true },

    // Localization Configuration
    language: {
      defaultLanguage: { type: String, enum: ['en', 'hi', 'ta', 'te', 'kn', 'ur'], default: 'en' },
      supportedLanguages: [{ type: String, enum: ['en', 'hi', 'ta', 'te', 'kn', 'ur'] }],
      dateFormat: {
        type: String,
        enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
        default: 'DD/MM/YYYY',
      },
      numberFormat: { type: String, enum: ['en-IN', 'en-US'], default: 'en-IN' },
      enableBilingualReports: { type: Boolean, default: false },
      bilingualReportLanguage: {
        type: String,
        enum: ['en', 'hi', 'ta', 'te', 'kn', 'ur'],
        default: 'hi',
      },
    },

    // NPS Survey Configuration
    nps: {
      enabled: { type: Boolean, default: true },
      cooldownDays: { type: Number, default: 90, min: 7, max: 365 },
    },

    // Data Residency Configuration
    dataResidency: {
      region: { type: String, enum: ['IN', 'US', 'EU', 'AP'], default: 'IN' },
      selectedAt: { type: Date, default: null },
      lockedAt: { type: Date, default: null },
      complianceFrameworks: [{ type: String, enum: ['DPDP', 'GDPR', 'FERPA', 'PDPA', 'PIPEDA'] }],
    },
  },
  { timestamps: true }
);

export default mongoose.model('SchoolSettings', schoolSettingsSchema);
