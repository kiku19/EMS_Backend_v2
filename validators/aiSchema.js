import { z } from 'zod';

export const aiChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant'], {
    errorMap: () => ({ message: 'role must be user or assistant' }),
  }),
  content: z.string().max(4000, 'content must not exceed 4000 characters'),
});

export const aiChatSchema = z.object({
  messages: z
    .array(aiChatMessageSchema, {
      invalid_type_error: 'messages must be an array of message objects',
    })
    .min(1, 'at least one message is required'),
  selectedModel: z.string().max(64).optional(),
});
