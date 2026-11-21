const POSTGRES_TIMESTAMPTZ = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** Parses the exact finite timestamptz grammar emitted by the benefit RPCs. */
export function parsePostgresTimestampMicros(value: unknown): bigint | null {
  if (typeof value !== 'string') return null
  const match = POSTGRES_TIMESTAMPTZ.exec(value)
  if (!match) return null

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', zone, sign, offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = zone === 'Z' ? 0 : Number(offsetHourText)
  const offsetMinute = zone === 'Z' ? 0 : Number(offsetMinuteText)
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null

  const wholeSecond = `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}${zone}`
  const epochMilliseconds = Date.parse(wholeSecond)
  if (!Number.isFinite(epochMilliseconds)) return null

  // Round-trip the represented instant to its stated local calendar. This rejects
  // any engine normalization that escaped the explicit calendar/offset checks.
  const offset = zone === 'Z' ? 0 : (sign === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute)
  const local = new Date(epochMilliseconds + offset * 60_000)
  if (local.getUTCFullYear() !== year || local.getUTCMonth() + 1 !== month || local.getUTCDate() !== day
    || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second
    || local.getUTCMilliseconds() !== 0) return null

  return BigInt(epochMilliseconds) * 1000n + BigInt(fraction.padEnd(6, '0') || '0')
}

export function comparePostgresTimestamps(left: string, right: string) {
  const leftMicros = parsePostgresTimestampMicros(left)
  const rightMicros = parsePostgresTimestampMicros(right)
  if (leftMicros === null || rightMicros === null) throw new Error('invalid timestamp')
  return leftMicros < rightMicros ? -1 : leftMicros > rightMicros ? 1 : 0
}
