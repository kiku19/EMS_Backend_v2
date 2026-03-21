import { PaymentGatewayAdapter } from './base.js';

/**
 * Manual/mock payment adapter.
 * Used for development, testing, or schools that prefer offline billing management.
 * All payments are accepted without real gateway interaction.
 */
export class ManualAdapter extends PaymentGatewayAdapter {
  get name() {
    return 'manual';
  }
  get isConfigured() {
    return true;
  }

  async createSubscriptionPaymentLink() {
    // No hosted URL — admin handles payment offline
    return null;
  }

  async createOrder({ amount, currency, notes }) {
    return {
      orderId: `order_dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      amount,
      amountInPaise: Math.round(amount * 100),
      currency,
      notes,
      keyId: 'manual_placeholder',
      mock: true,
    };
  }

  async verifyPayment() {
    return { valid: true };
  }
}
