/** Version captured in render/build identity when this formatter is used. */
export const DATE_FORMATTER_VERSION = "cbb-date-en-v1" as const;

const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface FormattedDate {
  readonly text: string;
  readonly formatterVersion: typeof DATE_FORMATTER_VERSION;
  readonly localeUsed: "en-US" | "en";
  readonly localeFallbackFrom?: string;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Gregorian weekday, 0 = Sunday. Uses integer components only. */
function weekdayIndex(year: number, month: number, day: number): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const;
  const adjustedYear = month < 3 ? year - 1 : year;
  const offset = offsets[month - 1];
  if (offset === undefined) throw new RangeError("Invalid Gregorian month");
  const value =
    adjustedYear +
    Math.floor(adjustedYear / 4) -
    Math.floor(adjustedYear / 100) +
    Math.floor(adjustedYear / 400) +
    offset +
    day;
  return ((value % 7) + 7) % 7;
}

/**
 * Format a canonical ISO date without consulting Intl, the wall clock, or
 * host locale data. The initial v1 bundle supports the documented English
 * token set; unsupported locales/formats fail closed.
 */
export function formatIsoDate(
  value: string,
  format = "MMMM D, YYYY",
  locale = "en-US"
): FormattedDate {
  const localeUsed: "en-US" | "en" =
    locale === "en" || (locale.startsWith("en-") && locale !== "en-US")
      ? "en"
      : "en-US";
  const localeFallbackFrom =
    locale === "en" || locale === "en-US" ? undefined : locale;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new TypeError(`Invalid canonical ISO date: ${value}`);
  }

  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    throw new TypeError(`Invalid canonical ISO date: ${value}`);
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new TypeError(`Invalid Gregorian calendar date: ${value}`);
  }

  const longMonth = MONTHS_LONG[month - 1];
  const shortMonth = MONTHS_SHORT[month - 1];
  if (longMonth === undefined || shortMonth === undefined) {
    throw new TypeError(`Invalid month in canonical ISO date: ${value}`);
  }

  const replacements: Readonly<Record<string, string>> = {
    YYYY: yearText,
    YY: yearText.slice(2),
    MMMM: longMonth,
    MMM: shortMonth,
    MM: monthText,
    M: String(month),
    DD: dayText,
    D: String(day),
    dddd: WEEKDAYS_LONG[weekdayIndex(year, month, day)] as string,
    ddd: WEEKDAYS_SHORT[weekdayIndex(year, month, day)] as string,
  };

  let text = "";
  for (let index = 0; index < format.length;) {
    if (format[index] === "[") {
      const close = format.indexOf("]", index + 1);
      if (close === -1) {
        throw new RangeError("Unterminated literal in deterministic date format");
      }
      text += format.slice(index + 1, close);
      index = close + 1;
      continue;
    }

    const token = /^(YYYY|MMMM|dddd|MMM|ddd|YY|MM|DD|M|D)/.exec(
      format.slice(index)
    )?.[1];
    if (token !== undefined) {
      text += replacements[token];
      index += token.length;
      continue;
    }

    const character = format[index];
    if (character === undefined) break;
    if (/[A-Za-z]/.test(character)) {
      throw new RangeError(`Unsupported deterministic date format token near: ${format.slice(index)}`);
    }
    text += character;
    index++;
  }

  return {
    text,
    formatterVersion: DATE_FORMATTER_VERSION,
    localeUsed,
    ...(localeFallbackFrom !== undefined ? { localeFallbackFrom } : {}),
  };
}
