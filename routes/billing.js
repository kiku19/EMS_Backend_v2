import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  createPlanCheckout,
  getBillingSummary,
  updateAutoRenew,
  updateBillingAccount,
  cancelSubscription,
  scheduleDowngrade,
  getInvoiceList,
  markInvoicePaid,
  generateInvoicePdf,
  handleRazorpayBillingWebhook,
} from '../services/billingService.js';
import { applyReferralCreditIfEligible } from '../services/referralService.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  cancelSubscriptionSchema,
  scheduleDowngradeSchema,
  checkoutSchema,
  autoRenewSchema,
  invoiceListQuerySchema,
  markPaidSchema,
} from '../validators/billingSchema.js';

const router = express.Router();

router.get('/summary', authenticate, checkPermission('settings', 'view'), async (req, res) => {
  try {
    const summary = await getBillingSummary(req.user.schoolId);
    res.json(summary);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Failed to fetch billing summary',
      details: error.details,
    });
  }
});

router.put('/account', authenticate, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const summary = await updateBillingAccount(req.user.schoolId, req.body || {});
    res.json(summary);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Failed to update billing account',
      details: error.details,
    });
  }
});

router.post(
  '/auto-renew',
  authenticate,
  checkPermission('settings', 'edit'),
  validateZod(autoRenewSchema),
  async (req, res) => {
    try {
      const subscription = await updateAutoRenew(req.user.schoolId, req.body.autoRenew);
      res.json({
        success: true,
        autoRenew: subscription.autoRenew,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to update auto-renew settings',
        details: error.details,
      });
    }
  }
);

router.post(
  '/checkout',
  authenticate,
  checkPermission('settings', 'edit'),
  validateZod(checkoutSchema),
  async (req, res) => {
    try {
      const { planKey, billingCycle, couponCode } = req.body;
      const checkout = await createPlanCheckout({
        schoolId: req.user.schoolId,
        planKey,
        billingCycle,
        couponCode: couponCode || null,
      });

      // When a school activates a paid plan, apply referral credit to their referrer (non-blocking)
      if (planKey !== 'starter') {
        applyReferralCreditIfEligible(req.user.schoolId).catch(() => {});
      }

      res.status(201).json({
        success: true,
        ...checkout,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to create checkout',
        details: error.details,
      });
    }
  }
);

router.post(
  '/cancel',
  authenticate,
  checkPermission('settings', 'edit'),
  validateZod(cancelSubscriptionSchema),
  async (req, res) => {
    try {
      const { immediate, reason } = req.body;
      const subscription = await cancelSubscription(req.user.schoolId, { immediate, reason });
      res.json({
        success: true,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        cancelledAt: subscription.cancelledAt,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to cancel subscription',
        details: error.details,
      });
    }
  }
);

router.post(
  '/downgrade',
  authenticate,
  checkPermission('settings', 'edit'),
  validateZod(scheduleDowngradeSchema),
  async (req, res) => {
    try {
      const { planKey } = req.body;
      const subscription = await scheduleDowngrade(req.user.schoolId, { planKey });
      res.json({
        success: true,
        scheduledDowngradePlanKey: subscription.scheduledDowngradePlanKey,
        scheduledDowngradeAt: subscription.scheduledDowngradeAt,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to schedule downgrade',
        details: error.details,
      });
    }
  }
);

// GET /billing/invoices - paginated invoice list
router.get(
  '/invoices',
  authenticate,
  checkPermission('settings', 'view'),
  validateZod(invoiceListQuerySchema, 'query'),
  async (req, res) => {
    try {
      const { page, limit, status } = req.query;
      const result = await getInvoiceList(req.user.schoolId, { page, limit, status });
      res.json(result);
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to fetch invoices',
      });
    }
  }
);

// GET /billing/invoices/:invoiceNumber/pdf - download invoice PDF
router.get(
  '/invoices/:invoiceNumber/pdf',
  authenticate,
  checkPermission('settings', 'view'),
  async (req, res) => {
    try {
      const doc = await generateInvoicePdf(req.params.invoiceNumber, req.user.schoolId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=invoice-${req.params.invoiceNumber}.pdf`
      );
      doc.pipe(res);
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to generate invoice PDF',
      });
    }
  }
);

// POST /billing/invoices/:invoiceNumber/mark-paid - manually mark invoice as paid
router.post(
  '/invoices/:invoiceNumber/mark-paid',
  authenticate,
  checkPermission('settings', 'edit'),
  validateZod(markPaidSchema),
  async (req, res) => {
    try {
      const invoice = await markInvoicePaid(req.params.invoiceNumber, req.user.schoolId, {
        notes: req.body.notes,
      });
      res.json({ success: true, invoice });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || 'Failed to mark invoice as paid',
      });
    }
  }
);

// POST /billing/razorpay-webhook - Razorpay payment gateway webhook (no auth)
router.post('/razorpay-webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing webhook signature' });
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
      return res.status(400).json({ error: 'Raw body unavailable' });
    }
    const result = await handleRazorpayBillingWebhook(rawBody, signature);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Webhook processing failed',
    });
  }
});

export default router;
