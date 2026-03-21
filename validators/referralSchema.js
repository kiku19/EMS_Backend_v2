import { z } from 'zod';

// Apply a referral code (called by a new/existing school to claim a referral)
export const applyReferralCodeSchema = z.object({
  code: z.string().trim().min(4, 'Referral code too short').max(20, 'Referral code too long'),
});
