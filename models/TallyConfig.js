import mongoose from 'mongoose';

const ledgerMappingSchema = new mongoose.Schema(
  {
    feeHeadName: { type: String, required: true },
    tallyLedger: { type: String, required: true },
    tallyGroup: { type: String, default: 'Income' },
  },
  { _id: false }
);

const syncHistorySchema = new mongoose.Schema(
  {
    exportedAt: { type: Date, required: true },
    dateFrom: { type: String, required: true },
    dateTo: { type: String, required: true },
    recordCount: { type: Number, default: 0 },
    status: { type: String, enum: ['success', 'failed'], default: 'success' },
    triggeredBy: { type: String, enum: ['manual', 'scheduled'], default: 'manual' },
    errorMessage: { type: String, default: null },
  },
  { _id: false }
);

const tallyConfigSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, unique: true },

    // GST & Company Info
    gstin: { type: String, default: '' },
    companyName: { type: String, default: '' },

    // Payment mode → Tally ledger mapping
    defaultCashLedger: { type: String, default: 'Cash' },
    defaultBankLedger: { type: String, default: 'Bank' },
    defaultOnlineLedger: { type: String, default: 'Online Payment Gateway' },
    defaultChequeLedger: { type: String, default: 'Cheque Clearing' },

    // Fee head → Tally income ledger mapping
    ledgerMappings: [ledgerMappingSchema],

    // Auto-export schedule config
    autoExport: {
      enabled: { type: Boolean, default: false },
      schedule: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'daily' },
      time: { type: String, default: '06:00' },
      lastExportAt: { type: Date, default: null },
      lastExportStatus: { type: String, enum: ['success', 'failed', null], default: null },
    },

    // Last 50 sync records (trimmed in route handler)
    syncHistory: [syncHistorySchema],
  },
  { timestamps: true }
);

export default mongoose.model('TallyConfig', tallyConfigSchema);
