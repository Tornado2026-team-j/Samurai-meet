const MINUTES_PER_DAY = 24 * 60;

function parseTime(time: string): number {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(time);

  if (!match) {
    throw new RangeError(`Invalid time: ${time}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23) {
    throw new RangeError(`Invalid time: ${time}`);
  }

  return hours * 60 + minutes;
}

function formatMinutes(totalMinutes: number): string {
  const normalizedMinutes =
    ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function calculateFinishTime(
  startTime: string,
  durationHours: number,
): string {
  if (!Number.isFinite(durationHours) || durationHours < 0) {
    throw new RangeError(`Invalid duration: ${durationHours}`);
  }

  const durationMinutes = Math.round(durationHours * 60);
  return formatMinutes(parseTime(startTime) + durationMinutes);
}

export function formatTimeRange(
  startTime: string,
  durationHours: number,
): string {
  return `${startTime}~${calculateFinishTime(startTime, durationHours)}`;
}

export function shiftTime(time: string, amountMinutes: number): string {
  if (!Number.isInteger(amountMinutes)) {
    throw new RangeError(`Invalid minute amount: ${amountMinutes}`);
  }

  return formatMinutes(parseTime(time) + amountMinutes);
}

/** Returns whether a JST-scheduled plan has reached its stated end time. */
export function isJSTScheduleEnded(
  date: string,
  endTime: string,
  now = new Date(),
): boolean {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):([0-5]\d)$/.exec(endTime.trim());
  if (!dateMatch || !timeMatch || Number(timeMatch[1]) > 23) return false;

  const end = new Date(`${date}T${endTime}:00+09:00`);
  if (Number.isNaN(end.getTime())) return false;

  const endParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  }).formatToParts(end);
  const values = Object.fromEntries(endParts.map((part) => [part.type, part.value]));
  if (
    values.year !== dateMatch[1]
    || values.month !== dateMatch[2]
    || values.day !== dateMatch[3]
    || values.hour !== timeMatch[1]
    || values.minute !== timeMatch[2]
  ) {
    return false;
  }

  return end.getTime() <= now.getTime();
}
