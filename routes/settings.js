import express from 'express';
import { authenticate } from '../middleware/auth.js';
import schoolRouter from './settings/school.js';
import calendarRouter from './settings/calendar.js';
import examRouter from './settings/exam.js';
import feeHeadsRouter from './settings/feeHeads.js';
import documentsRouter from './settings/documents.js';
import emailTemplatesRouter from './settings/emailTemplates.js';
import smsTemplatesRouter from './settings/smsTemplates.js';
import emailDomainRouter from './settings/emailDomain.js';
import dataResidencyRouter from './settings/dataResidency.js';
import communicationRouter from './settings/communication.js';
import admissionFormConfigRouter from './settings/admissionFormConfig.js';
import admissionAndRollConfigRouter from './settings/admissionAndRollConfig.js';
import payrollRouter from './settings/payroll.js';
import salaryTemplatesRouter from './settings/salaryTemplates.js';
import modulesRouter from './settings/modules.js';

const router = express.Router();

// Mount schoolRouter first — it contains the public /public-branding endpoint
// used by the login page before authentication.
router.use('/', schoolRouter);

// All remaining sub-routers require authentication.
router.use(authenticate);

router.use('/', calendarRouter);
router.use('/', examRouter);
router.use('/', feeHeadsRouter);
router.use('/', documentsRouter);
router.use('/', emailTemplatesRouter);
router.use('/', smsTemplatesRouter);
router.use('/', emailDomainRouter);
router.use('/', dataResidencyRouter);
router.use('/', communicationRouter);
router.use('/', admissionFormConfigRouter);
router.use('/', admissionAndRollConfigRouter);
router.use('/', payrollRouter);
router.use('/', salaryTemplatesRouter);
router.use('/', modulesRouter);

export default router;
