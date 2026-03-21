import express from 'express';
import { authenticateParent } from '../middleware/parentAuth.js';
import profileRouter from './parent/profile.js';
import academicsRouter from './parent/academics.js';
import feesRouter from './parent/fees.js';
import scheduleRouter from './parent/schedule.js';
import activitiesRouter from './parent/activities.js';

const router = express.Router();

router.use(authenticateParent);

router.use(profileRouter);
router.use(academicsRouter);
router.use(feesRouter);
router.use(scheduleRouter);
router.use(activitiesRouter);

export default router;
