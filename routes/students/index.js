import express from 'express';
import documentsRouter from './documents.js';
import feesRouter from './fees.js';
import academicsRouter from './academics.js';
import crudRouter from './crud.js';
import createUpdateRouter from './createUpdate.js';
import promotionsRouter from './promotions.js';

const router = express.Router();

// Sub-routers are mounted in this order to preserve correct route matching:
// 1. Documents — specific /:id/documents sub-paths
// 2. Fees — includes static /class/:classId/fee-status before /:id/fee-summary
// 3. Academics — /:id/results and /:id/remarks
// 4. CRUD — includes GET /, GET /next-admission-id (static) before GET /:id
// 5. CreateUpdate — POST / and PUT /:id
// 6. Promotions — includes static /promote/year-end before /:id/promote
router.use(documentsRouter);
router.use(feesRouter);
router.use(academicsRouter);
router.use(crudRouter);
router.use(createUpdateRouter);
router.use(promotionsRouter);

export default router;
