import { z } from 'zod';
export const eventTypes = [
  'lead.created',
  'contact.created',
  'inquiry.received',
  'feedback.submitted',
] as const;
const singleLine = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((v) => ![...v].some((c) => c.charCodeAt(0) < 32));
export const eventBody = z
  .object({
    event: z.enum(eventTypes),
    externalEventId: z.string().trim().min(1).max(128),
    contact: z
      .object({
        name: singleLine,
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        phone: z.string().max(40).optional(),
      })
      .strict(),
    data: z
      .object({
        source: z.string().max(100).optional(),
        message: z.string().trim().min(1).max(4000),
        subject: singleLine.optional(),
        interest: singleLine.optional(),
      })
      .strict(),
    communicationPreferences: z
      .object({
        emailTransactional: z.boolean(),
        emailMarketing: z.boolean().default(false),
      })
      .strict()
      .optional(),
    communicationEvidence: z
      .object({
        basis: z.literal('customer_request'),
        source: z.string().trim().min(1).max(100),
        reference: z.string().min(1).max(128),
        occurredAt: z.iso.datetime({ offset: true }),
      })
      .strict()
      .optional(),
  })
  .strict();
export const aliasBody = eventBody.omit({ event: true });
export type EventInput = z.infer<typeof eventBody>;
const template = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine(
    (v) =>
      !v
        .replace(/\{\{(businessName|contactName|reference)\}\}/g, '')
        .includes('{{'),
  );
export const automationBody = z
  .object({
    enabled: z.boolean(),
    followUpEnabled: z.boolean().optional(),
    enabledEvents: z.array(z.enum(eventTypes)).min(1).max(4),
    subject: template.refine((v) => v.length <= 180 && !/[\r\n]/.test(v)),
    body: template,
    dailyLimit: z.number().int().min(1).max(10000),
  })
  .strict();
export const suppressionBody = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
  })
  .strict();
