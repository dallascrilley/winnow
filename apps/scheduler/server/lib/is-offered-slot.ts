/**
 * Validates a requested booking interval against the slots the availability
 * engine actually offers: the start must equal an offered slot start and the
 * duration must equal the event type length. Compared as parsed instants so
 * equivalent ISO forms ("Z" vs "+00:00") match.
 */

export function isOfferedSlot(
  slots: readonly { start: string }[],
  startTime: string,
  endTime: string,
  lengthMinutes: number,
): boolean {
  const startMs = Date.parse(startTime);
  const endMs = Date.parse(endTime);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
  if (endMs - startMs !== lengthMinutes * 60_000) return false;
  return slots.some((slot) => Date.parse(slot.start) === startMs);
}
