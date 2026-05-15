import mongoose from 'mongoose';

const hostelSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['boys', 'girls', 'mixed'],
      required: true,
    },

    // Warden details — wardenId is the source of truth; wardenName is denormalized for search
    wardenId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    wardenName: { type: String, trim: true },
    wardenPhone: { type: String, trim: true },
    wardenEmail: { type: String, trim: true },

    // Location
    address: { type: String, trim: true },

    // Capacity summary (denormalized for quick stats)
    totalRooms: { type: Number, default: 0 },
    totalCapacity: { type: Number, default: 0 },
    occupiedBeds: { type: Number, default: 0 },

    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

hostelSchema.index({ schoolId: 1, isActive: 1 });
hostelSchema.index({ schoolId: 1, type: 1 });
hostelSchema.index(
  { schoolId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

export default mongoose.model('Hostel', hostelSchema);
