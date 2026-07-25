import { z } from 'zod';

export const opsDeploymentSchema = z
  .object({
    version: z.string().trim().min(1).max(100).optional(),
    commitSha: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{7,64}$/i, 'Invalid commit SHA')
      .optional(),
  })
  .strict()
  .refine((data) => Boolean(data.version || data.commitSha), {
    message: 'version or commitSha is required',
  });
