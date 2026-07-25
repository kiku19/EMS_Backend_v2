import mongoose from 'mongoose';
import { TOGGLEABLE_MODULE_KEYS } from '../config/moduleRegistry.js';

const schoolSchema = new mongoose.Schema(
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
      // active     — normal operation
      // inactive   — dormant (legacy soft state; NOT access-blocked)
      // suspended  — access blocked (e.g. non-payment); data intact, reactivate to restore
      // locked     — admin/security lock; harder to reactivate
      // churned    — offboarded permanently (sessions revoked, subscription cancelled)
      enum: ['active', 'inactive', 'suspended', 'locked', 'churned'],
      default: 'active',
      index: true,
    },
    plan: {
      type: String,
      enum: ['starter', 'growth', 'scale'],
      default: 'starter',
      index: true,
    },
    planStatus: {
      type: String,
      // 'paused' mirrors SchoolSubscription.status so the denormalized cache can
      // represent the full billing lifecycle without validation drift.
      enum: ['trialing', 'active', 'past_due', 'cancelled', 'paused'],
      default: 'trialing',
      index: true,
    },
    trialEndsAt: {
      type: Date,
      default: null,
    },
    isDefault: {
      type: Boolean,
      default: false,
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
    frontendUrl: {
      type: String,
      trim: true,
      default: null,
    },
    backendUrl: {
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
    provisioning: {
      status: {
        type: String,
        enum: ['pending', 'ready', 'error'],
        default: 'pending',
      },
      lastProvisionedAt: {
        type: Date,
        default: null,
      },
      lastProvisionedBy: {
        type: String,
        default: null,
      },
      notes: {
        type: String,
        default: null,
      },
    },
    // School group (multi-branch): reference to the parent SchoolGroup
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SchoolGroup',
      default: null,
      index: true,
    },
    // Per-school module enablement. Stores ONLY the toggleable modules that are
    // ON; CORE modules (students/staff/classes/…) are always implicitly enabled
    // and never stored here. A brand-new school defaults to an empty array →
    // core-only launch. Existing schools created before this field shipped have
    // NO field in the DB; lean reads therefore see `undefined`, which the
    // moduleAccess middleware treats as "unmanaged → everything allowed" until
    // an admin saves an explicit list (see resolveEnabledModules in
    // config/moduleRegistry.js). Defaults are NOT applied on `.lean()` reads, so
    // this backward-compat path is preserved.
    enabledModules: {
      type: [String],
      enum: TOGGLEABLE_MODULE_KEYS,
      default: () => [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ssoConfig: {
      google: {
        enabled: { type: Boolean, default: false },
        clientId: { type: String, default: null },
        clientSecret: { type: String, default: null },
      },
      microsoft: {
        enabled: { type: Boolean, default: false },
        clientId: { type: String, default: null },
        clientSecret: { type: String, default: null },
        tenantId: { type: String, default: null },
      },
      // SAML 2.0 configuration
      saml: {
        enabled: { type: Boolean, default: false },
        // Identity Provider metadata
        entryPoint: { type: String, default: null }, // IdP SSO URL
        issuer: { type: String, default: null }, // SP entity ID (our service)
        cert: { type: String, default: null }, // IdP signing certificate (PEM)
        // Attribute mapping
        emailAttribute: { type: String, default: 'email' },
        nameAttribute: { type: String, default: 'displayName' },
        groupAttribute: { type: String, default: null }, // Attribute name that carries group membership
      },
      // Group → EMS role mapping (applies to all SSO providers)
      groupRoleMappings: [
        {
          groupName: { type: String }, // IdP group name / claim value
          role: { type: String }, // EMS role to assign
        },
      ],
      allowedDomains: [{ type: String }],
      autoProvision: { type: Boolean, default: false },
      defaultRole: { type: String, default: 'Teacher' },
      // SSO-only mode: blocks password-based login for this school
      ssoOnly: { type: Boolean, default: false },
      // SCIM provisioning
      scim: {
        enabled: { type: Boolean, default: false },
        token: { type: String, default: null }, // Bearer token SCIM clients must send
      },
    },
  },
  {
    timestamps: true,
  }
);

schoolSchema.index({ createdAt: 1 });

export default mongoose.models.School || mongoose.model('School', schoolSchema);
