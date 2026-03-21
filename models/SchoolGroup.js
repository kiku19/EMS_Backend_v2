import mongoose from 'mongoose';

const schoolGroupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    plan: {
      type: String,
      enum: ['starter', 'growth', 'enterprise'],
      default: 'enterprise',
      index: true,
    },
    planStatus: {
      type: String,
      enum: ['trialing', 'active', 'past_due', 'cancelled'],
      default: 'trialing',
      index: true,
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    contactPhone: {
      type: String,
      trim: true,
      default: null,
    },
    billingContactName: {
      type: String,
      trim: true,
      default: null,
    },
    billingEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    billingPhone: {
      type: String,
      trim: true,
      default: null,
    },
    // Whether branches can share fee templates
    sharedFeeTemplates: {
      type: Boolean,
      default: false,
    },
    // White-label / custom domain configuration for the group portal
    whiteLabelSettings: {
      enabled: { type: Boolean, default: false },
      // Custom domain pointing to this group's school portal (e.g. portal.acme.edu)
      customDomain: { type: String, default: '', trim: true, lowercase: true },
      domainVerified: { type: Boolean, default: false },
      // DNS TXT record token placed at _ems-verify.<customDomain> for verification
      domainVerificationToken: { type: String, default: null },
      branding: {
        appName: { type: String, default: '', trim: true },
        logo: { type: String, default: '' }, // URL or base64
        favicon: { type: String, default: '' }, // URL
        primaryColor: { type: String, default: '#0d9488' },
        secondaryColor: { type: String, default: '#134e4a' },
      },
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

schoolGroupSchema.index({ createdAt: -1 });

export default mongoose.models.SchoolGroup || mongoose.model('SchoolGroup', schoolGroupSchema);
