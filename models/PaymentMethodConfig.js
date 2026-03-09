import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const paymentMethodConfigSchema = new mongoose.Schema({
  academicYear: { type: String, required: true, default: CURRENT_ACADEMIC_YEAR },
  
  online: {
    enabled: { type: Boolean, default: true },
    bankTransfer: { type: Boolean, default: true },
    upi: { type: Boolean, default: true },
    debitCard: { type: Boolean, default: true },
    creditCard: { type: Boolean, default: true },
    emi: {
      enabled: { type: Boolean, default: false },
      providers: [{ type: String }]  // e.g., ["Bajaj Finserv", "HDFC Bank"]
    }
  },
  
  offline: {
    enabled: { type: Boolean, default: true },
    cash: { type: Boolean, default: true },
    cheque: { type: Boolean, default: true },
    dd: { type: Boolean, default: true }  // Demand Draft
  }
}, { timestamps: true });

// Ensure only one config per academic year
paymentMethodConfigSchema.index({ academicYear: 1 }, { unique: true });

export default mongoose.model('PaymentMethodConfig', paymentMethodConfigSchema);

