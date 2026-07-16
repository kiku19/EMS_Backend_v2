import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import piiPlugin from '../utils/piiPlugin.js';

const parentSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      default: null,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    firebaseUid: {
      type: String,
      sparse: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
    },
    password: {
      type: String,
      default: null,
    },
    // Set to true when an admin generates/resets the password so the parent is
    // forced to choose their own password on next login.
    mustChangePassword: {
      type: Boolean,
      default: false,
    },
    avatar: {
      type: String,
      default: null,
    },
    children: [
      {
        studentId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Student',
          required: true,
        },
        relationship: {
          type: String,
          enum: ['father', 'mother', 'guardian', 'other'],
          required: true,
        },
        isPrimary: {
          type: Boolean,
          default: false,
        },
      },
    ],
    fcmTokens: [
      {
        token: {
          type: String,
          required: true,
        },
        deviceInfo: {
          type: String,
          default: null,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    preferences: {
      language: {
        type: String,
        default: 'en',
      },
      notifications: {
        type: Boolean,
        default: true,
      },
      whatsappOptIn: {
        type: Boolean,
        default: false,
      },
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended'],
      default: 'active',
      index: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
parentSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password instance method
parentSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// ── PII encryption: encrypt sensitive fields at rest ─────────────────────────
parentSchema.plugin(piiPlugin, {
  fields: ['phone', 'email'],
  searchableFields: ['phone', 'email'],
});

// AES-GCM ciphertext is intentionally non-deterministic, so uniqueness must be
// enforced on the deterministic companion hashes produced by piiPlugin. The
// old encrypted-value indexes allowed duplicate guardian accounts under load.
parentSchema.index(
  { schoolId: 1, phoneHash: 1 },
  { unique: true, partialFilterExpression: { phoneHash: { $type: 'string' } } }
);
parentSchema.index(
  { schoolId: 1, emailHash: 1 },
  { unique: true, partialFilterExpression: { emailHash: { $type: 'string' } } }
);
parentSchema.index({ 'children.studentId': 1 });
parentSchema.index({ createdAt: -1 });

export default mongoose.models.Parent || mongoose.model('Parent', parentSchema);
