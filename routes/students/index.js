import express from 'express';
import documentsRouter from './documents.js';
import feesRouter from './fees.js';
import academicsRouter from './academics.js';
import crudRouter from './crud.js';
import createUpdateRouter from './createUpdate.js';
import promotionsRouter from './promotions.js';
import transferCertificateRouter from './transferCertificate.js';

const router = express.Router();

// Sub-routers are mounted in this order to preserve correct route matching:
// 1. TransferCertificate — static /tc/next-number before /:id routes
// 2. Documents — specific /:id/documents sub-paths
// 3. Fees — includes static /class/:classId/fee-status before /:id/fee-summary
// 4. Academics — /:id/results and /:id/remarks
// 5. CRUD — includes GET /, GET /next-admission-id (static) before GET /:id
// 6. CreateUpdate — POST / and PUT /:id
// 7. Promotions — includes static /promote/year-end before /:id/promote
router.use(transferCertificateRouter);
router.use(documentsRouter);
router.use(feesRouter);
router.use(academicsRouter);
router.use(crudRouter);
router.use(createUpdateRouter);
router.use(promotionsRouter);

export default router;
