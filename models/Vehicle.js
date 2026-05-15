import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    registrationNumber: { type: String, required: true },
    make: String,
    model: String,
    year: Number,
    capacity: { type: Number, min: 1 },
    color: String,
    status: {
      type: String,
      enum: ['active', 'inactive', 'maintenance'],
      default: 'active',
    },

    // Staff references
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', index: true },
    conductorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', index: true },

    // Driver license info (preserved from legacy embedded driver object)
    driverLicenseNumber: String,
    driverLicenseExpiry: Date,

    // GPS integration ready
    gpsDeviceId: String,
    lastGpsUpdate: Date,
    lastLocation: {
      lat: Number,
      lng: Number,
    },

    notes: String,

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

vehicleSchema.index(
  { schoolId: 1, registrationNumber: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);

export default mongoose.model('Vehicle', vehicleSchema);
