import { z } from 'zod';
import { objectId, academicYear, dateString } from './zodHelpers.js';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const HH_MM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const ledgerMappingSchema = z.object({
  feeHeadName: z.string().min(1).max(100),
  tallyLedger: z.string().min(1).max(100),
  tallyGroup: z.string().max(100).optional().default('Income'),
});

export const tallyConfigUpdateSchema = z.object({
  gstin: z.string().regex(GSTIN_REGEX, 'Invalid GSTIN').optional().or(z.literal('')),
  companyName: z.string().max(200).optional(),
  defaultCashLedger: z.string().max(100).optional(),
  defaultBankLedger: z.string().max(100).optional(),
  defaultOnlineLedger: z.string().max(100).optional(),
  defaultChequeLedger: z.string().max(100).optional(),
  ledgerMappings: z.array(ledgerMappingSchema).optional(),
  autoExport: z
    .object({
      enabled: z.boolean(),
      schedule: z.enum(['daily', 'weekly', 'monthly']).optional(),
      time: z.string().regex(HH_MM_REGEX, 'Must be HH:MM format').optional(),
    })
    .optional(),
});

export const tallyExportQuerySchema = z.object({
  dateFrom: dateString,
  dateTo: dateString,
  academicYear: academicYear.optional(),
  format: z.enum(['xml', 'json']).optional().default('xml'),
});
