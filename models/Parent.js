import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const parentSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  firebaseUid: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true,
    index: true
  },
  password: {
    type: String,
    default: null
  },
  avatar: {
    type: String,
    default: null
  },
  children: [{
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true
    },
    relationship: {
      type: String,
      enum: ['father', 'mother', 'guardian', 'other'],
      required: true
    },
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],
  fcmTokens: [{
    token: {
      type: String,
      required: true
    },
    deviceInfo: {
      type: String,
      default: null
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  preferences: {
    language: {
      type: String,
      default: 'en'
    },
    notifications: {
      type: Boolean,
      default: true
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active',
    index: true
  },
  lastLogin: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Hash password before saving
parentSchema.pre('save', async function(next) {
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
parentSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Index for frequently queried fields
parentSchema.index({ status: 1 });
parentSchema.index({ 'children.studentId': 1 });
parentSchema.index({ createdAt: -1 });

export default mongoose.models.Parent || mongoose.model('Parent', parentSchema);
