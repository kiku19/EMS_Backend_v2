import express from 'express';
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

const router = express.Router();

router.use('/', schoolRouter);
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

export default router;
