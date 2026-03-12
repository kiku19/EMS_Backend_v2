import mongoose from 'mongoose';

const schoolInvoiceSchema = new mongoose.Schema({
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true,
    index: true,
  },
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SchoolSubscription',
    required: true,
    index: true,
  },
  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  planKey: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'annual'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    default: 'INR',
    uppercase: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['draft', 'issued', 'paid', 'failed', 'void'],
    default: 'draft',
    index: true,
  },
  description: {
    type: String,
    default: null,
    trim: true,
  },
  provider: {
    type: String,
    enum: ['none', 'manual', 'razorpay'],
    default: 'none',
  },
  providerInvoiceId: {
    type: String,
    default: null,
    trim: true,
  },
  providerPaymentLinkId: {
    type: String,
    default: null,
    trim: true,
  },
  hostedUrl: {
    type: String,
    default: null,
    trim: true,
  },
  dueAt: {
    type: Date,
    default: null,
  },
  paidAt: {
    type: Date,
    default: null,
  },
  periodStartsAt: {
    type: Date,
    default: null,
  },
  periodEndsAt: {
    type: Date,
    default: null,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

schoolInvoiceSchema.index({ schoolId: 1, createdAt: -1 });

export default mongoose.models.SchoolInvoice || mongoose.model('SchoolInvoice', schoolInvoiceSchema);
