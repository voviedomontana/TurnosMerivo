import { describe, it, expect } from "vitest";
import {
  computeSlots,
  type PreviewSnapshot,
} from "@/modules/availability/compute";
const snapshot = (): PreviewSnapshot => ({
  now: "2026-11-02T08:00:00Z",
  min_notice_minutes: 60,
  duration_minutes: 30,
  buffer_minutes: 10,
  days: [
    {
      date: "2026-11-02",
      warning: null,
      intervals: [
        { start: "2026-11-02T09:00:00Z", end: "2026-11-02T13:00:00Z" },
        { start: "2026-11-02T14:00:00Z", end: "2026-11-02T18:00:00Z" },
      ],
      candidates: [
        { start: "2026-11-02T09:00:00Z", label: "09:00" },
        { start: "2026-11-02T12:45:00Z", label: "12:45" },
        { start: "2026-11-02T17:30:00Z", label: "17:30" },
      ],
    },
  ],
  blocks: [],
});
describe("informative scheduling preview", () => {
  it("subtracts actual occupation including buffer without touching the source", () => {
    const s = snapshot();
    s.occupied = [
      { start: "2026-11-02T09:30:00Z", end: "2026-11-02T10:00:00Z" },
    ];
    const before = JSON.stringify(s);
    expect(computeSlots(s).map((v) => v.label)).toEqual(["17:30"]);
    expect(JSON.stringify(s)).toBe(before);
    s.occupied = [
      { start: "2026-11-02T09:40:00Z", end: "2026-11-02T10:00:00Z" },
    ];
    expect(computeSlots(s).map((v) => v.label)).toContain("09:00");
  });
  it("preserves scheduling invariants across 1000 deterministic fixtures", () => {
    let seed = 1234567;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let n = 0; n < 1000; n++) {
      const s = snapshot();
      s.duration_minutes = 5 + Math.floor(random() * 476);
      s.buffer_minutes = Math.floor(random() * 121);
      const blockStart = Date.parse(s.now) + Math.floor(random() * 720) * 60000;
      s.blocks = [
        {
          start: new Date(blockStart).toISOString(),
          end: new Date(
            blockStart + Math.ceil(random() * 120) * 60000,
          ).toISOString(),
        },
      ];
      for (const slot of computeSlots(s)) {
        const start = Date.parse(slot.start),
          end = Date.parse(slot.end),
          blocked = Date.parse(slot.blocked_until);
        expect(
          s.days.some((d) =>
            d.intervals.some(
              (i) => Date.parse(i.start) <= start && end <= Date.parse(i.end),
            ),
          ),
        ).toBe(true);
        expect(
          s.blocks.every(
            (b) => blocked <= Date.parse(b.start) || start >= Date.parse(b.end),
          ),
        ).toBe(true);
        expect(end - start).toBe(s.duration_minutes * 60000);
        expect(blocked - end).toBe(s.buffer_minutes * 60000);
      }
    }
  });
  it("keeps service within a single interval and permits buffer past closing", () => {
    const v = computeSlots(snapshot());
    expect(v.map((s) => s.label)).toEqual(["09:00", "17:30"]);
    expect(v[1].blocked_until).toBe("2026-11-02T18:10:00.000Z");
  });
  it("checks buffer against blocks and uses half-open intervals", () => {
    const s = snapshot();
    s.blocks = [{ start: "2026-11-02T18:00:00Z", end: "2026-11-02T18:05:00Z" }];
    expect(computeSlots(s).map((s) => s.label)).toEqual(["09:00"]);
    s.blocks = [{ start: "2026-11-02T09:40:00Z", end: "2026-11-02T10:00:00Z" }];
    expect(computeSlots(s).map((s) => s.label)).toContain("09:00");
  });
  it("uses supplied clock and actual UTC minutes across DST", () => {
    const s = snapshot();
    s.now = "2026-11-02T09:00:00Z";
    expect(computeSlots(s).map((s) => s.label)).not.toContain("09:00");
    s.now = "2026-11-02T08:00:00Z";
    s.duration_minutes = 240;
    expect(computeSlots(s)[0].end).toBe("2026-11-02T13:00:00.000Z");
  });
  it("never books or mutates input and yields deterministic alternatives", () => {
    const s = snapshot(),
      before = JSON.stringify(s);
    expect(computeSlots(s)).toEqual(computeSlots(s));
    expect(JSON.stringify(s)).toBe(before);
    expect(computeSlots(s)[0]).not.toHaveProperty("appointment_id");
  });
});
