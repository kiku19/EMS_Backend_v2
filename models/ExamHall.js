import mongoose from 'mongoose';

/**
 * ExamHall — a physical hall/room used for exam seating.
 *
 * Distinct from HostelRoom (which is bed-oriented and parented to a Hostel).
 * An ExamHall is a free-standing venue with a student capacity and a bench
 * layout. `benchCapacity` records whether each bench in this hall is a
 * single-seater (1) or a double-seater (2); this is a property of the hall's
 * furniture, not of an individual exam. The seating generator reads it to lay
 * out benches correctly.
 *
 * `rows` and `columns` describe the hall's bench grid (rows of benches ×
 * benches per row). Total benches = rows × columns; capacity is the
 * authoritative student limit (≤ total benches × benchCapacity).
 */
const examHallSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },

    name: { type: String, required: true, trim: true }, // e.g. "Main Hall", "Block A - Room 101"
    block: { type: String, trim: true, default: '' }, // building / wing, free-text

    // Max students this hall can hold for an exam.
    capacity: { type: Number, required: true, min: 1 },
    // Seats per bench — 1 (single-seater) or 2 (double-seater). Property of the
    // hall's furniture; the seating generator guarantees one student per bench
    // for exams (anti-copy rule), regardless of this value, but uses it to
    // compute the hall's bench grid layout.
    benchCapacity: { type: Number, enum: [1, 2], default: 2 },

    // Bench grid dimensions (informational; drives the seat-map visualisation).
    rows: { type: Number, min: 1, default: 1 },
    columns: { type: Number, min: 1, default: 1 }, // benches per row

    notes: { type: String, trim: true, default: '' },

    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

examHallSchema.index({ schoolId: 1, isActive: 1 });
examHallSchema.index(
  { schoolId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model('ExamHall', examHallSchema);
