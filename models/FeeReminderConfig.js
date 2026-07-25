import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

/**
 * FeeReminderConfig — school-wide configuration for fee reminders.
 *
 * Replaces the hardcoded constants in services/feeReminderService.js
 * (DUE_REMINDER_DAYS_AHEAD = 7, cooldown = 24h) with values the school
 * admin can tune from the Fees UI. One document per school+academic year.
 *
 * The reminder Agenda job (config/agenda.js, daily 07:00) reads this config
 * at run time; when no document exists the service falls back to defaults.
 */
const manualReminderSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    message: { type: String, default: '' },
    // Audience scope: 'all' | 'overdue' | 'unpaid' | specific class ids
    audience: {
      type: { type: String, enum: ['all', 'overdue', 'unpaid', 'class'], default: 'overdue' },
      classIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    },
    triggerDate: { type: String }, // ISO "YYYY-MM-DD" — when the manual reminder should fire
    sentAt: { type: Date }, // set when actually dispatched
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    recipientCount: { type: Number, default: 0 },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const feeReminderConfigSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    academicYear: { type: String, required: true, default: CURRENT_ACADEMIC_YEAR },

    enabled: { type: Boolean, default: true },

    // "Fee due soon" reminders — sent N days before an installment's due date.
    dueReminder: {
      enabled: { type: Boolean, default: true },
      daysBefore: { type: Number, default: 3, min: 0, max: 60 },
      // cadence constrains which installments are considered. 'custom' uses
      // customDates as explicit reminder dates in addition to daysBefore.
      cadence: {
        type: String,
        enum: ['term', 'quarter', 'year', 'month', 'week', 'custom'],
        default: 'term',
      },
      customDates: [{ type: String }], // ["YYYY-MM-DD", ...]
    },

    // "Fee overdue" reminders — recurring nudges after the due date passes.
    overdueReminder: {
      enabled: { type: Boolean, default: true },
      repeatEveryDays: { type: Number, default: 7, min: 1, max: 90 },
      maxReminders: { type: Number, default: 4, min: 0, max: 30 },
    },

    // Delivery channels — gates which notifyParents() actually sends through.
    channels: {
      inApp: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
    },

    // Per-student cooldown between reminders of the same type.
    cooldownHours: { type: Number, default: 24, min: 1, max: 168 },

    // Manually-created reminders (one-off blasts created from the UI).
    manualReminders: [manualReminderSchema],

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

// One config per school per academic year.
feeReminderConfigSchema.index({ schoolId: 1, academicYear: 1 }, { unique: true });

/**
 * Build a plain default-config object (used by GET when none exists yet).
 * Kept in sync with the schema defaults above.
 */
export const DEFAULT_FEE_REMINDER_CONFIG = Object.freeze({
  enabled: true,
  dueReminder: { enabled: true, daysBefore: 3, cadence: 'term', customDates: [] },
  overdueReminder: { enabled: true, repeatEveryDays: 7, maxReminders: 4 },
  channels: { inApp: true, push: true, whatsapp: false, email: false },
  cooldownHours: 24,
  manualReminders: [],
});

export default mongoose.model('FeeReminderConfig', feeReminderConfigSchema);
