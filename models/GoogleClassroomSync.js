import mongoose from 'mongoose';

const classMappingSchema = new mongoose.Schema(
  {
    emsClassId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    googleCourseId: {
      type: String,
      required: true,
      trim: true,
    },
    googleCourseName: {
      type: String,
      trim: true,
      default: null,
    },
    syncStudents: {
      type: Boolean,
      default: true,
    },
    syncAssignments: {
      type: Boolean,
      default: true,
    },
    syncGrades: {
      type: Boolean,
      default: true,
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: true }
);

const teacherMappingSchema = new mongoose.Schema(
  {
    emsStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    googleUserId: {
      type: String,
      required: true,
      trim: true,
    },
    googleEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
  },
  { _id: true }
);

const syncLogSchema = new mongoose.Schema(
  {
    triggeredBy: {
      type: String,
      enum: ['manual', 'scheduled'],
      default: 'manual',
    },
    status: {
      type: String,
      enum: ['running', 'completed', 'failed', 'partial'],
      default: 'running',
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    summary: {
      classesProcessed: { type: Number, default: 0 },
      studentsAdded: { type: Number, default: 0 },
      studentsRemoved: { type: Number, default: 0 },
      assignmentsCreated: { type: Number, default: 0 },
      gradesUpdated: { type: Number, default: 0 },
      conflicts: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  { _id: true }
);

const googleClassroomSyncSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      unique: true,
      index: true,
    },

    // OAuth credentials (stored encrypted via app-level encryption in service layer)
    oauth: {
      accessToken: { type: String, default: null },
      refreshToken: { type: String, default: null },
      tokenExpiresAt: { type: Date, default: null },
      scopes: [{ type: String }],
      connectedEmail: { type: String, trim: true, lowercase: true, default: null },
      connectedAt: { type: Date, default: null },
    },

    // Sync settings
    settings: {
      syncFrequency: {
        type: String,
        enum: ['manual', 'hourly', 'daily', 'weekly'],
        default: 'daily',
      },
      syncStudents: { type: Boolean, default: true },
      syncAssignments: { type: Boolean, default: true },
      syncGrades: { type: Boolean, default: true },
      conflictResolution: {
        type: String,
        enum: ['ems_wins', 'google_wins', 'newer_wins', 'flag_conflict'],
        default: 'ems_wins',
      },
      academicYear: { type: String, default: null },
    },

    // Class mappings: EMS class ↔ Google course
    classMappings: [classMappingSchema],

    // Teacher mappings: EMS staff ↔ Google user
    teacherMappings: [teacherMappingSchema],

    // Last scheduled sync
    lastScheduledSync: { type: Date, default: null },
    nextScheduledSync: { type: Date, default: null },

    // Sync history (keep last 50)
    syncHistory: {
      type: [syncLogSchema],
      default: [],
    },

    isConnected: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

// Keep sync history capped at 50 entries
googleClassroomSyncSchema.pre('save', function (next) {
  if (this.syncHistory.length > 50) {
    this.syncHistory = this.syncHistory.slice(-50);
  }
  next();
});

const GoogleClassroomSync = mongoose.model('GoogleClassroomSync', googleClassroomSyncSchema);
export default GoogleClassroomSync;
