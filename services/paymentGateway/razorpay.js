import crypto from 'crypto';
import { PaymentGatewayAdapter } from './base.js';

export class RazorpayAdapter extends PaymentGatewayAdapter {
  constructor() {
    super();
    this._instance = null;
  }

  get name() {
    return 'razorpay';
  }

  get isConfigured() {
    return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  }

  async _getInstance() {
    if (this._instance) return this._instance;
    const Razorpay = (await import('razorpay')).default;
    this._instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    return this._instance;
  }

  async createSubscriptionPaymentLink({
    amount,
    currency,
    description,
    customer,
    referenceId,
    notes,
  }) {
    const razorpay = await this._getInstance();

    const paymentLink = await razorpay.paymentLink.create({
      amount: Math.round(amount * 100),
      currency,
      description,
      customer: {
        name: customer.name,
        email: customer.email || undefined,
        contact: customer.phone || undefined,
      },
      notify: {
        email: Boolean(customer.email),
        sms: Boolean(customer.phone),
      },
      reference_id: referenceId,
      notes,
    });

    return {
      paymentLinkId: paymentLink.id,
      hostedUrl: paymentLink.short_url || paymentLink.url || null,
      provider: 'razorpay',
    };
  }

  async createOrder({ amount, currency, receipt, notes }) {
    const razorpay = await this._getInstance();
    const amountInPaise = Math.round(amount * 100);

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency,
      receipt,
      notes,
    });

    return {
      orderId: order.id,
      amount: order.amount / 100,
      amountInPaise: order.amount,
      currency: order.currency,
      notes: order.notes,
      keyId: process.env.RAZORPAY_KEY_ID,
      mock: false,
    };
  }

  async verifyPayment({ orderId, paymentId, signature }) {
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    return { valid: expectedSignature === signature };
  }
}
