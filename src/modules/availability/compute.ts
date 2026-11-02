export type TimeInterval = { start: string; end: string };
export type PreviewSnapshot = {
  now: string;
  min_notice_minutes: number;
  duration_minutes: number;
  buffer_minutes: number;
  days: {
    date: string;
    warning: string | null;
    intervals: TimeInterval[];
    candidates: { start: string; label: string }[];
  }[];
  blocks: TimeInterval[];
  occupied?: TimeInterval[];
};
export function computeSlots(snapshot: PreviewSnapshot) {
  const earliest =
    Date.parse(snapshot.now) + snapshot.min_notice_minutes * 60000;
  return snapshot.days.flatMap((day) =>
    day.candidates.flatMap((candidate) => {
      const start = Date.parse(candidate.start),
        end = start + snapshot.duration_minutes * 60000,
        blocked = end + snapshot.buffer_minutes * 60000;
      if (
        !Number.isFinite(start) ||
        start < earliest ||
        !day.intervals.some(
          (i) => Date.parse(i.start) <= start && end <= Date.parse(i.end),
        ) ||
        [...snapshot.blocks, ...(snapshot.occupied ?? [])].some(
          (b) => start < Date.parse(b.end) && Date.parse(b.start) < blocked,
        )
      )
        return [];
      return [
        {
          date: day.date,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          blocked_until: new Date(blocked).toISOString(),
          label: candidate.label,
        },
      ];
    }),
  );
}
