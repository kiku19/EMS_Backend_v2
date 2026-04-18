import { z } from 'zod';
import { objectId, optionalObjectId, optionalString } from './zodHelpers.js';

// Only http(s) file URLs are accepted — without this, callers could smuggle
// javascript: / data: / file: URIs through the sendMessage endpoint and
// clients rendering fileUrl as <a href> would execute them on click.
const safeFileUrl = z
  .string()
  .max(2000)
  .refine(
    (v) => !v || /^https?:\/\//i.test(v),
    'fileUrl must be an http(s) URL'
  )
  .optional();

// ─── MESSAGE: SEND ──────────────────────────────────────────────
export const sendMessageSchema = z
  .object({
    conversationId: objectId,
    receiverId: objectId,
    receiverModel: z.enum(['Staff', 'Student', 'Parent']).optional(),
    content: z.string().max(10000).default(''),
    type: z.enum(['text', 'image', 'file', 'audio', 'video', 'voice']).optional().default('text'),
    fileUrl: safeFileUrl,
    fileName: optionalString(500),
    fileSize: z.number().int().min(0).optional(),
    replyTo: z.union([z.string(), z.object({ messageId: z.string() })]).optional(),
    forwardedFrom: z.object({ messageId: z.string() }).optional(),
    duration: z.number().min(0).optional().default(0),
    waveform: z.array(z.number()).optional().default([]),
    clientMessageId: optionalString(100),
  })
  // text messages must have non-empty content; media messages may have
  // empty content (the placeholder is supplied server-side).
  .refine(
    (d) => d.type !== 'text' || (typeof d.content === 'string' && d.content.trim().length > 0),
    { message: 'Text messages require non-empty content', path: ['content'] }
  );

// ─── MESSAGE: EDIT ──────────────────────────────────────────────
export const editMessageSchema = z.object({
  content: z.string().min(1, 'Content is required').max(10000),
});

// ─── CONVERSATION: CREATE ───────────────────────────────────────
export const createConversationSchema = z.object({
  participantId: objectId,
  participantModel: z.enum(['Staff', 'Student', 'Parent']).optional(),
  type: z.enum(['direct', 'group']).optional().default('direct'),
  name: optionalString(200),
});

// ─── REACTION ───────────────────────────────────────────────────
export const reactionSchema = z.object({
  emoji: z.string().min(1).max(10),
});
