/**
 * Abstract base class for payment gateway adapters.
 * All gateway implementations must extend this class.
 */
export class PaymentGatewayAdapter {
  /** @returns {string} Gateway provider name */
  get name() {
    return 'base';
  }

  /** @returns {boolean} Whether this gateway has valid credentials configured */
  get isConfigured() {
    return false;
  }

  /**
   * Create a hosted payment link for a subscription invoice.
   * Used in the SaaS billing flow.
   *
   * @param {object} params
   * @param {number} params.amount - Amount in base currency unit (e.g., INR, not paise)
   * @param {string} params.currency - ISO currency code (e.g., 'INR')
   * @param {string} params.description - Payment description
   * @param {{ name: string, email?: string, phone?: string }} params.customer
   * @param {string} params.referenceId - Internal invoice number
   * @param {object} params.notes - Metadata to attach to the payment
   * @returns {Promise<{ paymentLinkId: string, hostedUrl: string, provider: string } | null>}
   */
  // eslint-disable-next-line no-unused-vars
  async createSubscriptionPaymentLink(params) {
    throw new Error(`${this.name} adapter does not implement createSubscriptionPaymentLink`);
  }

  /**
   * Create an order for fee payment (parent app flow).
   *
   * @param {object} params
   * @param {number} params.amount - Amount in base currency unit
   * @param {string} params.currency - ISO currency code
   * @param {string} params.receipt - Receipt identifier string
   * @param {object} params.notes - Metadata to attach to the order
   * @returns {Promise<{ orderId: string, amount: number, amountInPaise: number, currency: string, notes: object, keyId: string, mock?: boolean }>}
   */
  // eslint-disable-next-line no-unused-vars
  async createOrder(params) {
    throw new Error(`${this.name} adapter does not implement createOrder`);
  }

  /**
   * Verify a payment from the gateway callback.
   *
   * @param {object} params
   * @param {string} params.orderId
   * @param {string} params.paymentId
   * @param {string} params.signature
   * @returns {Promise<{ valid: boolean }>}
   */
  // eslint-disable-next-line no-unused-vars
  async verifyPayment(params) {
    throw new Error(`${this.name} adapter does not implement verifyPayment`);
  }
}
