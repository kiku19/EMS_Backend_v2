import express from 'express';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { validateZod, objectId } from '../validators/index.js';
import {
  getBillingOverview,
  listSubscriptions,
  listInvoices,
  overrideSubscription,
  markInvoicePaidCrossSchool,
  voidInvoice,
  refundInvoice,
} from '../services/superAdminBillingService.js';
import { BILLING_PLANS } from '../services/billingService.js';

const router = express.Router();
router.use(authenticate, requireSuperAdmin);

const PLAN_KEYS = Object.keys(BILLING_PLANS);
const SUB_STATUS_ENUM = ['trialing', 'active', 'past_due', 'cancelled', 'paused'];
const INVOICE_STATUS_ENUM = ['draft', 'issued', 'paid', 'failed', 'void', 'refunded'];

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10000).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  schoolId: objectId.optional(),
});

const subscriptionsQuerySchema = listQuerySchema.extend({
  planKey: z.enum(PLAN_KEYS).optional(),
  status: z.enum(SUB_STATUS_ENUM).optional(),
});

const invoicesQuerySchema = listQuerySchema.extend({
  status: z.enum(INVOICE_STATUS_ENUM).optional(),
});

const overrideBodySchema = z
  .object({
    planKey: z.enum(PLAN_KEYS).optional(),
    status: z.enum(SUB_STATUS_ENUM).optional(),
    billingCycle: z.enum(['monthly', 'annual']).optional(),
    trialEndsAt: z.coerce.date().nullable().optional(),
    autoRenew: z.boolean().optional(),
    cancelAtPeriodEnd: z.boolean().optional(),
    gracePeriodEndsAt: z.coerce.date().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to override',
  });

const invoiceActionBodySchema = z.object({
  reason: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

const schoolIdParamSchema = z.object({ schoolId: objectId });
const invoiceNumberParamSchema = z.object({
  invoiceNumber: z.string().min(1).max(80),
});

// GET /api/v1/super-admin/billing — revenue rollup (MRR/ARR/counts/collected/outstanding)
router.get('/', async (req, res) => {
  try {
    const overview = await getBillingOverview();
    res.json(overview);
  } catch (err) {
    req.log?.error?.({ err }, 'Failed to load billing overview');
    res.status(500).json({ error: 'Failed to load billing overview' });
  }
});

// GET /api/v1/super-admin/billing/subscriptions — every subscription across schools
router.get(
  '/subscriptions',
  validateZod(subscriptionsQuerySchema, 'query'),
  async (req, res) => {
    try {
      const result = await listSubscriptions(req.query);
      res.json(result);
    } catch (err) {
      req.log?.error?.({ err }, 'Failed to list subscriptions');
      res.status(500).json({ error: 'Failed to list subscriptions' });
    }
  }
);

// GET /api/v1/super-admin/billing/invoices — every invoice across schools
router.get('/invoices', validateZod(invoicesQuerySchema, 'query'), async (req, res) => {
  try {
    const result = await listInvoices(req.query);
    res.json(result);
  } catch (err) {
    req.log?.error?.({ err }, 'Failed to list invoices');
    res.status(500).json({ error: 'Failed to list invoices' });
  }
});

// PATCH /api/v1/super-admin/billing/subscriptions/:schoolId — override a subscription
router.patch(
  '/subscriptions/:schoolId',
  validateZod(schoolIdParamSchema, 'params'),
  validateZod(overrideBodySchema),
  async (req, res) => {
    try {
      const result = await overrideSubscription(req.params.schoolId, req.body);
      res.json(result);
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: err.message });
      req.log?.error?.({ err }, 'Failed to override subscription');
      res.status(500).json({ error: 'Failed to override subscription' });
    }
  }
);

// POST /api/v1/super-admin/billing/invoices/:invoiceNumber/mark-paid
router.post(
  '/invoices/:invoiceNumber/mark-paid',
  validateZod(invoiceNumberParamSchema, 'params'),
  validateZod(invoiceActionBodySchema),
  async (req, res) => {
    try {
      await markInvoicePaidCrossSchool(req.params.invoiceNumber, { notes: req.body.notes });
      res.json({ success: true, message: 'Invoice marked paid' });
    } catch (err) {
      if (err.status === 404 || err.status === 409) {
        return res.status(err.status).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'Failed to mark invoice paid');
      res.status(500).json({ error: 'Failed to mark invoice paid' });
    }
  }
);

// POST /api/v1/super-admin/billing/invoices/:invoiceNumber/void
router.post(
  '/invoices/:invoiceNumber/void',
  validateZod(invoiceNumberParamSchema, 'params'),
  async (req, res) => {
    try {
      await voidInvoice(req.params.invoiceNumber);
      res.json({ success: true, message: 'Invoice voided' });
    } catch (err) {
      if (err.status === 404 || err.status === 409) {
        return res.status(err.status).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'Failed to void invoice');
      res.status(500).json({ error: 'Failed to void invoice' });
    }
  }
);

// POST /api/v1/super-admin/billing/invoices/:invoiceNumber/refund
router.post(
  '/invoices/:invoiceNumber/refund',
  validateZod(invoiceNumberParamSchema, 'params'),
  validateZod(invoiceActionBodySchema),
  async (req, res) => {
    try {
      await refundInvoice(req.params.invoiceNumber, { reason: req.body.reason });
      res.json({ success: true, message: 'Invoice marked refunded' });
    } catch (err) {
      if (err.status === 404 || err.status === 409) {
        return res.status(err.status).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'Failed to refund invoice');
      res.status(500).json({ error: 'Failed to refund invoice' });
    }
  }
);

export default router;
