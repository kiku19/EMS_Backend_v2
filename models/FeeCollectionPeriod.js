import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const feeCollectionPeriodSchema = new mongoose.Schema({
  academicYear: { type: String, required: true, default: CURRENT_ACADEMIC_YEAR },
  
  collectionInterval: { 
    type: String, 
    enum: ['monthly', 'quarterly', 'term-wise', 'yearly'],
    default: 'yearly'
  },
  
  installmentPlans: [{
    name: { type: String, required: true },
    frequency: { 
      type: String, 
      enum: ['monthly', 'quarterly', 'half-yearly', 'custom']
    },
    numberOfInstallments: { type: Number, required: true },
    dueDates: [{ type: String }],  // Array of dates in format "YYYY-MM-DD"
    enabled: { type: Boolean, default: true },
    description: String
  }],
  
  autoPay: { 
    enabled: { type: Boolean, default: false },
    reminderDays: { type: Number, default: 3 }  // Days before due date
  },
  
  interestOnDelay: {
    enabled: { type: Boolean, default: false },
    type: { type: String, enum: ['rate', 'flat'], default: 'rate' },
    value: { type: Number, default: 0 }  // Percentage or flat amount per month
  }
}, { timestamps: true });

// Ensure only one config per academic year
feeCollectionPeriodSchema.index({ academicYear: 1 }, { unique: true });

export default mongoose.model('FeeCollectionPeriod', feeCollectionPeriodSchema);

