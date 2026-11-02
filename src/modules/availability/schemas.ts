import { z } from "zod";
export const localDate = z.iso.date();
export const interval = z
  .object({
    start_minute: z.number().int().min(0).max(1439),
    end_minute: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine((v) => v.start_minute < v.end_minute);
export const weeklyInterval = z
  .object({
    weekday: z.number().int().min(1).max(7),
    start_minute: z.number().int().min(0).max(1439),
    end_minute: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine((v) => v.start_minute < v.end_minute);
const reason = z
  .string()
  .normalize("NFC")
  .refine((v) => Array.from(v).length <= 500)
  .nullable()
  .default(null);
export const planInput = z
  .object({
    effective_from: localDate,
    intervals: z.array(weeklyInterval).max(14),
  })
  .strict();
export const exceptionInput = z
  .object({
    date: localDate,
    kind: z.enum(["closed", "custom_hours"]),
    intervals: z.array(interval).max(14),
    reason,
  })
  .strict()
  .refine((v) =>
    v.kind === "closed" ? v.intervals.length === 0 : v.intervals.length > 0,
  );
export const blockInput = z
  .object({
    start_date: localDate,
    start_minute: z.number().int().min(0).max(1439),
    end_date: localDate,
    end_minute: z.number().int().min(0).max(1440),
    kind: z.enum(["manual", "vacation", "other"]),
    reason,
  })
  .strict();
export const staffOption = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
});
export type StaffOption = z.infer<typeof staffOption>;
export const scheduleSchema = z.object({
  staff_id: z.uuid(),
  staff_version: z.number().int().positive(),
  staff_name: z.string(),
  can_manage: z.boolean(),
  timezone: z.string(),
  today: localDate,
  global_version: z.number().int().positive(),
  plans: z.array(
    z.object({
      id: z.uuid(),
      effective_from: localDate,
      intervals: z.array(weeklyInterval),
    }),
  ),
  exceptions: z.array(
    z.object({
      date: localDate,
      kind: z.enum(["closed", "custom_hours"]),
      intervals: z.array(interval),
      id: z.uuid(),
      staff_id: z.uuid().nullable(),
      reason: z.string().nullable().optional(),
    }),
  ),
  blocks: z.array(
    z.object({
      id: z.uuid(),
      staff_id: z.uuid().nullable(),
      start: z.string(),
      end: z.string(),
      kind: z.string(),
      reason: z.string().nullable().optional(),
    }),
  ),
});
export type ScheduleData = z.infer<typeof scheduleSchema>;
const utcInterval = z.object({ start: z.string(), end: z.string() });
export const previewSource = z.object({
  mode: z.literal("schedule_preview"),
  can_book: z.literal(false),
  occupancy_checked: z.boolean(),
  settings_version: z.number().int().positive().optional(),
  business_version: z.number().int().positive().optional(),
  occupied: z.array(utcInterval).default([]),
  timezone: z.string(),
  now: z.string(),
  staff_id: z.uuid(),
  staff_version: z.number(),
  service_id: z.uuid(),
  service_version: z.number(),
  global_version: z.number(),
  duration_minutes: z.number().int().min(5).max(480),
  buffer_minutes: z.number().int().min(0).max(120),
  min_notice_minutes: z.number().int().nonnegative(),
  price_cents: z.number().int().nonnegative(),
  days: z.array(
    z.object({
      date: localDate,
      warning: z.string().nullable(),
      intervals: z.array(utcInterval),
      candidates: z.array(z.object({ start: z.string(), label: z.string() })),
    }),
  ),
  blocks: z.array(utcInterval),
});
export function minute(value: string, end = false) {
  if (!/^\d{2}:\d{2}$/.test(value)) throw Error("Usá el formato HH:mm.");
  const [h, m] = value.split(":").map(Number);
  if (m > 59 || (h > 23 && !(end && h === 24 && m === 0)))
    throw Error("Hora inválida.");
  return h * 60 + m;
}
export const displayMinute = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export function parseIntervals(value: string) {
  if (!value.trim()) return [];
  return value.split(",").map((pair) => {
    const parts = pair.trim().split("-");
    if (parts.length !== 2)
      throw Error("Usá intervalos como 09:00-13:00, 14:00-18:00.");
    return interval.parse({
      start_minute: minute(parts[0].trim()),
      end_minute: minute(parts[1].trim(), true),
    });
  });
}
