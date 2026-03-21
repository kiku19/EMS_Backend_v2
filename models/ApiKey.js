import crypto from 'crypto';
import mongoose from 'mongoose';

export const API_KEY_SCOPES = [
  'read:all',
  'read:students',
  'read:fees',
  'read:attendance',
  'read:academics',
  'read:staff',
  'write:fees',
  'write:attendance',
];

const apiKeySchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    // SHA-256 hash of the raw key — raw key is never stored
    keyHash: {
      type: String,
      required: true,
    },
    // First 8 chars of raw key (after "ems_" prefix) for UI identification
    keyPrefix: {
      type: String,
      required: true,
    },
    scopes: {
      type: [String],
      enum: API_KEY_SCOPES,
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'At least one scope must be selected',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Optional hard expiry date
    expiresAt: Date,
    // Usage tracking
    usageCount: {
      type: Number,
      default: 0,
    },
    lastUsedAt: Date,
    lastUsedEndpoint: {
      type: String,
      maxlength: 200,
    },
    // Rate limiting — max requests per hour per key
    rateLimitPerHour: {
      type: Number,
      default: 1000,
      min: 1,
      max: 100000,
    },
    // Key rotation — previous key remains valid for 24 hours after rotation
    previousKeyHash: String,
    previousKeyExpiresAt: Date,
    // Revocation
    revokedAt: Date,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
  },
  {
    timestamps: true,
  }
);

apiKeySchema.index({ schoolId: 1, isActive: 1 });
apiKeySchema.index({ keyHash: 1 }, { unique: true });
apiKeySchema.index({ previousKeyHash: 1 }, { sparse: true });

/**
 * Hash a raw API key with SHA-256
 */
export function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new raw API key.
 * Format: ems_<64 random hex chars>
 * Only the hash is ever stored; the raw value is returned once.
 */
export function generateApiKey() {
  const raw = crypto.randomBytes(32).toString('hex');
  return `ems_${raw}`;
}

/**
 * Extract the 8-char prefix from a raw key (after "ems_")
 */
export function getKeyPrefix(rawKey) {
  return rawKey.startsWith('ems_') ? rawKey.slice(4, 12) : rawKey.slice(0, 8);
}

export default mongoose.model('ApiKey', apiKeySchema);
