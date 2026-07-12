import {
  absolutePt,
  absolutePx,
  fromDecimalString,
  parseLength,
  rational,
  toTypstPt,
} from "../geometry/index.js";
import type { Rational } from "../geometry/index.js";

export type LengthRole =
  | "physical"
  | "physical-or-relative"
  | "element-size"
  | "spacing"
  | "canvas-position"
  | "page-element-size"
  | "track"
  | "font-size"
  | "border-width";

/** Convert a finite ECMAScript/JSON number's shortest decimal form exactly. */
export function rationalFromJsonNumber(value: number): Rational {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Expected a finite JSON number, got ${String(value)}`);
  }

  const text = String(value);
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (match === null) {
    throw new TypeError(`Unable to canonicalize JSON number ${text}`);
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const integer = match[2];
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (integer === undefined || !Number.isSafeInteger(exponent)) {
    throw new TypeError(`Unable to canonicalize JSON number ${text}`);
  }

  const digits = BigInt(integer + fraction) * sign;
  const decimalPlaces = fraction.length - exponent;
  return decimalPlaces <= 0
    ? rational(digits * 10n ** BigInt(-decimalPlaces), 1n)
    : rational(digits, 10n ** BigInt(decimalPlaces));
}

function numberAsTypstLength(value: number, role: LengthRole): string {
  const amount = rationalFromJsonNumber(value);
  switch (role) {
    case "font-size":
    case "border-width":
      return toTypstPt(absolutePt(amount));
    case "element-size":
    case "spacing":
    case "canvas-position":
      return toTypstPt(absolutePx(amount));
    case "physical":
    case "physical-or-relative":
    case "page-element-size":
    case "track":
      throw new TypeError(`${role} does not permit legacy numeric lengths`);
  }
}

/**
 * Emit a schema-validated persisted length. Absolute values use exact rational
 * conversion and the single 0.001pt rounding boundary required by the spec.
 */
export function typstLength(value: string | number, role: LengthRole): string {
  if (typeof value === "number") return numberAsTypstLength(value, role);
  if (value === "auto") {
    if (role === "element-size" || role === "page-element-size" || role === "track") {
      return "auto";
    }
    throw new TypeError(`${role} does not permit auto`);
  }

  const parsed = parseLength(value);
  switch (parsed.kind) {
    case "absolute":
      return toTypstPt(parsed);
    case "percent":
      if (
        role === "physical-or-relative" ||
        role === "element-size" ||
        role === "page-element-size" ||
        role === "track"
      ) {
        return value;
      }
      break;
    case "fr":
      if (role === "track") return value;
      break;
    case "em":
      if (
        role === "physical-or-relative" ||
        role === "font-size" ||
        role === "border-width"
      ) return value;
      break;
    case "auto":
      break;
  }
  throw new TypeError(`Length ${JSON.stringify(value)} is not valid for ${role}`);
}

export function typstFontSize(value: string | number | undefined): string {
  return typstLength(value ?? 11, "font-size");
}

export function typstColor(value: string): string {
  if (value === "transparent") return "none";
  if (!/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value)) {
    throw new TypeError(`Invalid color value: ${value}`);
  }
  return `rgb(${JSON.stringify(value.toLowerCase())})`;
}

/** Parse a plain decimal under a known unit without a floating-point hop. */
export function typstDecimalPt(value: string): string {
  return toTypstPt(absolutePt(fromDecimalString(value)));
}
