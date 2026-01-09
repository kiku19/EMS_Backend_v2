import mongoose from 'mongoose';

const modulePermissionSchema = new mongoose.Schema({
  module: {
    type: String,
    required: true,
    enum: ['dashboard', 'staff', 'students', 'classes', 'attendance', 'timetable', 'fees', 'payroll', 'messaging', 'reports', 'settings', 'front-desk']
  },
  view: { type: Boolean, default: false },
  create: { type: Boolean, default: false },
  edit: { type: Boolean, default: false },
  delete: { type: Boolean, default: false }
}, { _id: false });

const userPermissionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff',
    required: true,
    unique: true
  },
  role: {
    type: String,
    required: true,
    enum: ['admin', 'teacher', 'accountant', 'receptionist', 'custom']
  },
  permissions: [modulePermissionSchema],
  customPermissions: { type: Boolean, default: false }, // If true, uses custom permissions instead of role defaults
  lastUpdated: { type: Date, default: Date.now },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  }
}, { timestamps: true });

// Default permission templates
export const PERMISSION_TEMPLATES = {
  admin: {
    dashboard: { view: true, create: true, edit: true, delete: true },
    staff: { view: true, create: true, edit: true, delete: true },
    students: { view: true, create: true, edit: true, delete: true },
    classes: { view: true, create: true, edit: true, delete: true },
    attendance: { view: true, create: true, edit: true, delete: true },
    timetable: { view: true, create: true, edit: true, delete: true },
    fees: { view: true, create: true, edit: true, delete: true },
    payroll: { view: true, create: true, edit: true, delete: true },
    messaging: { view: true, create: true, edit: true, delete: true },
    reports: { view: true, create: true, edit: true, delete: true },
    settings: { view: true, create: true, edit: true, delete: true },
    'front-desk': { view: true, create: true, edit: true, delete: true }
  },
  teacher: {
    dashboard: { view: true, create: false, edit: false, delete: false },
    staff: { view: true, create: false, edit: false, delete: false },
    students: { view: true, create: false, edit: true, delete: false },
    classes: { view: true, create: false, edit: false, delete: false },
    attendance: { view: true, create: true, edit: true, delete: false },
    timetable: { view: true, create: false, edit: false, delete: false },
    fees: { view: true, create: false, edit: false, delete: false },
    payroll: { view: false, create: false, edit: false, delete: false },
    messaging: { view: true, create: true, edit: true, delete: false },
    reports: { view: true, create: false, edit: false, delete: false },
    settings: { view: false, create: false, edit: false, delete: false },
    'front-desk': { view: false, create: false, edit: false, delete: false }
  },
  accountant: {
    dashboard: { view: true, create: false, edit: false, delete: false },
    staff: { view: true, create: false, edit: false, delete: false },
    students: { view: true, create: false, edit: false, delete: false },
    classes: { view: true, create: false, edit: false, delete: false },
    attendance: { view: true, create: false, edit: false, delete: false },
    timetable: { view: false, create: false, edit: false, delete: false },
    fees: { view: true, create: true, edit: true, delete: true },
    payroll: { view: true, create: true, edit: true, delete: false },
    messaging: { view: true, create: true, edit: false, delete: false },
    reports: { view: true, create: false, edit: false, delete: false },
    settings: { view: false, create: false, edit: false, delete: false },
    'front-desk': { view: false, create: false, edit: false, delete: false }
  },
  receptionist: {
    dashboard: { view: true, create: false, edit: false, delete: false },
    staff: { view: true, create: false, edit: false, delete: false },
    students: { view: true, create: true, edit: true, delete: false },
    classes: { view: true, create: false, edit: false, delete: false },
    attendance: { view: true, create: false, edit: false, delete: false },
    timetable: { view: false, create: false, edit: false, delete: false },
    fees: { view: true, create: false, edit: false, delete: false },
    payroll: { view: false, create: false, edit: false, delete: false },
    messaging: { view: true, create: true, edit: false, delete: false },
    reports: { view: false, create: false, edit: false, delete: false },
    settings: { view: false, create: false, edit: false, delete: false },
    'front-desk': { view: true, create: true, edit: true, delete: false }
  }
};

const UserPermission = mongoose.model('UserPermission', userPermissionSchema);

export default UserPermission;
