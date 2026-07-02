// Zod validation schemas and middleware for EMS
// All validation uses Zod — Joi has been fully removed

export { validateZod } from './zodHelpers.js';
export {
  objectId,
  optionalObjectId,
  phone10,
  optionalPhone,
  optionalEmail,
  optionalUri,
  academicYear,
  dateString,
  optionalString,
  bloodGroupEnum,
  genderEnum,
} from './zodHelpers.js';

export { createStudentSchema, updateStudentSchema } from './studentSchema.js';
export { createStaffSchema, updateStaffSchema, teacherAssignmentSchema } from './staffSchema.js';
export {
  createClassSchema,
  updateClassSchema,
  updateClassTeacherSchema,
  updateClassSubjectsSchema,
  updateClassTagSchema,
  updateStrengthLimitSchema,
  promoteClassSchema,
  studentPromoteSchema,
  yearEndPromotionSchema,
  bulkStudentPromoteSchema,
  weekAttendanceQuerySchema,
} from './classSchema.js';
export {
  createExamSchema,
  updateExamSchema,
  bulkResultsSchema,
  createExamScheduleSchema,
  updateExamScheduleSchema,
} from './examSchema.js';
export {
  superAdminCreateSchoolSchema,
  superAdminUpdateSchoolSchema,
  superAdminProvisionSchoolSchema,
  mongoIdParamSchema,
} from './superAdminSchema.js';
export {
  createFeePaymentSchema,
  createRefundSchema,
  studentFeePaymentSchema,
  updateDiscountSchema,
  defaultersQuerySchema,
  paymentsSummaryQuerySchema,
  refundsSummaryQuerySchema,
  createFeeTemplateSchema,
  updateFeeTemplateSchema,
} from './feeSchema.js';
export {
  bulkPromotionSchema,
  rollbackPromotionSchema,
  newAcademicYearSchema,
  promotionRulesSchema,
  multiClassPromotionSchema,
} from './promotionSchema.js';
export {
  createSchoolGroupSchema,
  updateSchoolGroupSchema,
  groupBranchParamsSchema,
  transferStudentSchema,
  staffBranchAssignmentSchema,
  groupFeeTemplateSchema,
  updateGroupWhiteLabelSchema,
} from './schoolGroupSchema.js';
export { searchQuerySchema } from './searchSchema.js';
export { homeworkListQuerySchema, homeworkStatsQuerySchema } from './homeworkSchema.js';
export {
  cancelSubscriptionSchema,
  scheduleDowngradeSchema,
  checkoutSchema,
  autoRenewSchema,
} from './billingSchema.js';
export { updateStaffIdConfigSchema, updateSchoolSettingsSchema } from './systemConfigSchema.js';
export { changePasswordSchema } from './parentAuthSchema.js';
export { hallTicketQuerySchema } from './hallTicketSchema.js';
export { bulkAttendanceSchema, singleAttendanceSchema } from './attendanceSchema.js';
export { singleStaffAttendanceSchema, bulkStaffAttendanceSchema } from './staffAttendanceSchema.js';
export {
  createVisitorSchema,
  updateVisitorSchema,
  checkOutVisitorSchema,
  createGatePassSchema,
  updateGatePassSchema,
} from './frontDeskSchema.js';
export {
  createIntakeFormSchema,
  updateIntakeFormSchema,
  assignFormSchema,
  reviewSubmissionSchema,
  reviewEnhancedSchema,
  requestEditSchema,
} from './intakeFormSchema.js';
export { createSubjectSchema, updateSubjectSchema } from './settingsSubjectSchema.js';
export {
  updatePeriodsSchema,
  updateScheduleSchema,
  updateSlotSchema,
  autoGenerateSchema,
} from './timetableSchema.js';
export {
  createSubstitutionSchema,
  updateSubstitutionSchema,
  bulkAssignSchema,
  substitutionDateQuerySchema,
} from './substitutionSchema.js';
export {
  applyLeaveSchema,
  updateLeaveStatusSchema,
  createStudentLeaveSchema,
  updateStudentLeaveSchema,
  updateStudentLeaveStatusSchema,
  studentLeaveQuerySchema,
} from './leaveSchema.js';
export { aiChatSchema, aiChatMessageSchema } from './aiSchema.js';
export { updateOnboardingStepSchema, ONBOARDING_STEPS } from './onboardingStepSchema.js';
