import mongoose from 'mongoose';

const hostelRoomSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    hostelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },

    roomNumber: { type: String, required: true, trim: true },
    floor: { type: Number, default: 0 },
    type: {
      type: String,
      enum: ['single', 'double', 'triple', 'dormitory'],
      default: 'double',
    },

    capacity: { type: Number, required: true, min: 1 },
    occupiedBeds: { type: Number, default: 0, min: 0 },

    // Monthly fee for this room type
    monthlyFee: { type: Number, default: 0, min: 0 },

    // Amenities (e.g. ["AC", "Attached Bathroom", "WiFi"])
    amenities: [{ type: String, trim: true }],

    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

hostelRoomSchema.index({ schoolId: 1, hostelId: 1, isActive: 1 });
hostelRoomSchema.index(
  { schoolId: 1, hostelId: 1, roomNumber: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);

export default mongoose.model('HostelRoom', hostelRoomSchema);
