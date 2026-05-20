import mongoose from 'mongoose';

const stopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    address: String,
    lat: Number,
    lng: Number,
    pickupTime: String, // e.g. "07:30"
    dropTime: String, // e.g. "14:00"
    order: { type: Number, default: 0 },
  },
  { _id: true }
);

const studentAssignmentSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    stopId: { type: mongoose.Schema.Types.ObjectId }, // references a stop _id in stops[]
    pickupActive: { type: Boolean, default: true },
    dropActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const transportRouteSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    routeName: { type: String, required: true },
    routeNumber: { type: String, required: true },
    academicYear: { type: String, required: true },

    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },

    stops: [stopSchema],
    students: [studentAssignmentSchema],

    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },

    notes: String,

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

transportRouteSchema.index(
  { schoolId: 1, routeNumber: 1, academicYear: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model('TransportRoute', transportRouteSchema);
