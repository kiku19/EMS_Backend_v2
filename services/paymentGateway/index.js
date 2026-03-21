import { RazorpayAdapter } from './razorpay.js';
import { ManualAdapter } from './manual.js';

const GATEWAY_FACTORIES = {
  razorpay: () => new RazorpayAdapter(),
  manual: () => new ManualAdapter(),
};

/**
 * Get a payment gateway adapter by provider name.
 * Falls back to ManualAdapter if the provider is unknown.
 *
 * @param {string} provider - 'razorpay' | 'manual'
 * @returns {import('./base.js').PaymentGatewayAdapter}
 */
export function getPaymentGateway(provider) {
  const factory = GATEWAY_FACTORIES[provider?.toLowerCase()];
  return factory ? factory() : new ManualAdapter();
}

/**
 * Resolve the active gateway for parent app fee payments.
 * Uses PAYMENT_GATEWAY env var, defaulting to 'razorpay'.
 * Falls back to ManualAdapter when credentials are not configured.
 *
 * @returns {import('./base.js').PaymentGatewayAdapter}
 */
export function getFeePaymentGateway() {
  const provider = (process.env.PAYMENT_GATEWAY || 'razorpay').toLowerCase();
  const adapter = getPaymentGateway(provider);
  return adapter.isConfigured ? adapter : new ManualAdapter();
}

/**
 * Resolve the active gateway for SaaS subscription billing.
 * Uses BILLING_PROVIDER env var, defaulting to 'manual'.
 * Falls back to ManualAdapter when credentials are not configured.
 *
 * @returns {import('./base.js').PaymentGatewayAdapter}
 */
export function getBillingGateway() {
  const provider = (process.env.BILLING_PROVIDER || 'manual').toLowerCase();
  const adapter = getPaymentGateway(provider);
  return adapter.isConfigured ? adapter : new ManualAdapter();
}
