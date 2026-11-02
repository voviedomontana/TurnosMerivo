import { z } from "zod";
export const roleSchema = z.enum(["owner", "admin", "barber"]);
export const credentialsSchema = z
  .object({ email: z.email().max(254), password: z.string().min(10).max(128) })
  .strict();
export const inviteSchema = z
  .object({
    email: z.email().max(254),
    role: roleSchema,
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const updateMemberSchema = z
  .object({ role: roleSchema, status: z.enum(["active", "suspended"]) })
  .strict();
export const acceptSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const membershipSchema = z.object({
  id: z.uuid(),
  business_id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  role: roleSchema,
  version: z.number().int().positive(),
});
export const meSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  full_name: z.string().nullable(),
  platform_admin: z.boolean(),
  memberships: z.array(membershipSchema),
});
export const memberSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  email: z.string(),
  role: roleSchema,
  status: z.enum(["active", "invited", "suspended"]),
  version: z.number().int(),
  expires_at: z.string().nullable(),
});
export type Me = z.infer<typeof meSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export const memberPageInputSchema = z
  .object({
    limit: z
      .union([z.number(), z.string().regex(/^[0-9]{1,3}$/)])
      .transform((value) => Number(value))
      .pipe(z.number().int().min(1).max(200))
      .default(50),
    cursor: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
export const memberPageSchema = z.object({
  data: z.array(memberSchema),
  page: z.object({ next_cursor: z.string().nullable(), has_more: z.boolean() }),
});
