import mongoose from 'mongoose';
import { PERMISSION_MODULES } from '../constants/permissionModules.js';

const modulePermissionSchema = new mongoose.Schema(
  {
    module: {
      type: String,
      required: true,
      enum: PERMISSION_MODULES,
    },
    view: { type: Boolean, default: false },
    create: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
    publish: { type: Boolean, default: false },
    approve: { type: Boolean, default: false },
  },
  { _id: false }
);

const customRoleSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    permissions: [modulePermissionSchema],
    locked: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
  },
  { timestamps: true }
);

customRoleSchema.index({ schoolId: 1, name: 1 }, { unique: true });

const CustomRole = mongoose.model('CustomRole', customRoleSchema);

export default CustomRole;
