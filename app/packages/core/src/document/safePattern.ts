/**
 * Linear-time matcher for the documented v1 field-pattern subset.
 *
 * Supported RE2-compatible syntax: literals, `.`, `^`/`$` anchors, escaped
 * literals, `\d`/`\w`/`\s` (and their uppercase negations), character
 * classes/ranges, and `?`, `*`, `+`, `{m}`, `{m,n}`, `{m,}` quantifiers.
 * Groups, alternation, lookaround, and backreferences are deliberately absent.
 * Patterns are compiled to a bounded epsilon-NFA, avoiding host RegExp and
 * catastrophic backtracking.
 */

const MAX_PATTERN_UNITS = 256;
const MAX_NFA_STATES = 512;

type Predicate = (character: string) => boolean;

interface PatternCharacter {
  readonly character: string;
  readonly next: number;
}

interface CharacterAtom {
  readonly predicate: Predicate;
  /** Present only for a single literal code point that may bound a range. */
  readonly literal?: string;
}

interface Token {
  readonly predicate: Predicate;
  readonly min: number;
  readonly max: number | undefined;
}

interface State {
  readonly epsilon: number[];
  readonly transitions: Array<{
    readonly predicate: Predicate;
    readonly target: number;
  }>;
}

interface CompiledPattern {
  readonly states: readonly State[];
  readonly start: number;
  readonly accept: number;
  readonly anchoredStart: boolean;
  readonly anchoredEnd: boolean;
}

function escapedAt(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor--) {
    slashes++;
  }
  return slashes % 2 === 1;
}

function readPatternCharacter(
  value: string,
  index: number,
): PatternCharacter | undefined {
  const first = value.charCodeAt(index);
  if (Number.isNaN(first)) return undefined;
  if (first >= 0xd800 && first <= 0xdbff) {
    const second = value.charCodeAt(index + 1);
    if (Number.isNaN(second) || second < 0xdc00 || second > 0xdfff) {
      return undefined;
    }
    return { character: value.slice(index, index + 2), next: index + 2 };
  }
  if (first >= 0xdc00 && first <= 0xdfff) return undefined;
  return { character: value[index] as string, next: index + 1 };
}

function asciiWhitespace(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\f" ||
    character === "\r"
  );
}

function escapePredicate(code: string): Predicate | undefined {
  switch (code) {
    case "d": return (character) => /^[0-9]$/u.test(character);
    case "D": return (character) => !/^[0-9]$/u.test(character);
    case "w": return (character) => /^[A-Za-z0-9_]$/u.test(character);
    case "W": return (character) => !/^[A-Za-z0-9_]$/u.test(character);
    case "s": return asciiWhitespace;
    case "S": return (character) => !asciiWhitespace(character);
    default: return undefined;
  }
}

function escapedAtom(character: string): CharacterAtom | undefined {
  const characterClass = escapePredicate(character);
  if (characterClass !== undefined) return { predicate: characterClass };
  // The documented subset permits an escaped literal, not arbitrary regexp
  // escape dialects. Unknown ASCII letters/digits include backreferences,
  // named-reference prefixes, boundaries, and unsupported control escapes.
  if (/^[A-Za-z0-9]$/u.test(character)) return undefined;
  const point = character.codePointAt(0);
  if (point === undefined || point < 0x20 || point === 0x7f) return undefined;
  return {
    literal: character,
    predicate: (candidate) => candidate === character,
  };
}

function classAtomAt(
  source: string,
  index: number,
): { readonly atom: CharacterAtom; readonly next: number } | undefined {
  const value = readPatternCharacter(source, index);
  if (value === undefined) return undefined;
  if (value.character !== "\\") {
    return {
      atom: {
        literal: value.character,
        predicate: (candidate) => candidate === value.character,
      },
      next: value.next,
    };
  }
  const escaped = readPatternCharacter(source, value.next);
  if (escaped === undefined) return undefined;
  const atom = escapedAtom(escaped.character);
  return atom === undefined ? undefined : { atom, next: escaped.next };
}

function classPredicate(source: string): Predicate | undefined {
  let negate = false;
  let index = 0;
  if (source.startsWith("^")) {
    negate = true;
    index++;
  }
  const predicates: Predicate[] = [];
  while (index < source.length) {
    const start = classAtomAt(source, index);
    if (start === undefined) return undefined;
    if (
      start.atom.literal !== undefined &&
      source[start.next] === "-" &&
      start.next + 1 < source.length
    ) {
      const end = classAtomAt(source, start.next + 1);
      if (end?.atom.literal === undefined) return undefined;
      const from = start.atom.literal.codePointAt(0);
      const through = end.atom.literal.codePointAt(0);
      if (from === undefined || through === undefined || from > through) return undefined;
      predicates.push((character) => {
        const point = character.codePointAt(0);
        return point !== undefined && point >= from && point <= through;
      });
      index = end.next;
      continue;
    }
    predicates.push(start.atom.predicate);
    index = start.next;
  }
  if (predicates.length === 0) return undefined;
  return (character) => {
    const matched = predicates.some((predicate) => predicate(character));
    return negate ? !matched : matched;
  };
}

function parseQuantifier(
  body: string,
  index: number,
): { readonly min: number; readonly max: number | undefined; readonly next: number } {
  const marker = body[index];
  if (marker === "?") return { min: 0, max: 1, next: index + 1 };
  if (marker === "*") return { min: 0, max: undefined, next: index + 1 };
  if (marker === "+") return { min: 1, max: undefined, next: index + 1 };
  if (marker !== "{") return { min: 1, max: 1, next: index };
  const close = body.indexOf("}", index + 1);
  if (close === -1) return { min: -1, max: -1, next: body.length };
  const match = /^(\d+)(?:,(\d*)?)?$/u.exec(body.slice(index + 1, close));
  if (match === null) return { min: -1, max: -1, next: close + 1 };
  const min = Number(match[1]);
  const comma = body.slice(index + 1, close).includes(",");
  const max = !comma ? min : match[2] === "" ? undefined : Number(match[2]);
  if (
    !Number.isSafeInteger(min) ||
    min < 0 ||
    min > MAX_NFA_STATES ||
    (max !== undefined &&
      (!Number.isSafeInteger(max) || max < min || max > MAX_NFA_STATES))
  ) {
    return { min: -1, max: -1, next: close + 1 };
  }
  return { min, max, next: close + 1 };
}

function parseTokens(body: string): readonly Token[] | undefined {
  const tokens: Token[] = [];
  let index = 0;
  while (index < body.length) {
    const marker = body[index];
    let predicate: Predicate;
    if (marker === "\\") {
      const escaped = readPatternCharacter(body, index + 1);
      if (escaped === undefined) return undefined;
      const atom = escapedAtom(escaped.character);
      if (atom === undefined) return undefined;
      predicate = atom.predicate;
      index = escaped.next;
    } else if (marker === "[") {
      let close = index + 1;
      while (close < body.length && (body[close] !== "]" || escapedAt(body, close))) close++;
      if (close >= body.length) return undefined;
      const parsed = classPredicate(body.slice(index + 1, close));
      if (parsed === undefined) return undefined;
      predicate = parsed;
      index = close + 1;
    } else if (marker === ".") {
      predicate = (character) => character !== "\n" && character !== "\r";
      index++;
    } else {
      if (marker === undefined || "()|*+?{}".includes(marker)) return undefined;
      const literal = readPatternCharacter(body, index);
      if (literal === undefined) return undefined;
      predicate = (character) => character === literal.character;
      index = literal.next;
    }
    const quantifier = parseQuantifier(body, index);
    if (quantifier.min < 0) return undefined;
    tokens.push({ predicate, min: quantifier.min, max: quantifier.max });
    index = quantifier.next;
  }
  return tokens;
}

function compile(pattern: string): CompiledPattern | undefined {
  if (pattern.length > MAX_PATTERN_UNITS) return undefined;
  const anchoredStart = pattern.startsWith("^");
  const anchoredEnd = pattern.endsWith("$") && !escapedAt(pattern, pattern.length - 1);
  const body = pattern.slice(anchoredStart ? 1 : 0, anchoredEnd ? -1 : undefined);
  let insideClass = false;
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (escapedAt(body, index)) continue;
    if (character === "[") insideClass = true;
    else if (character === "]") insideClass = false;
    else if (!insideClass && (character === "^" || character === "$")) return undefined;
  }
  const tokens = parseTokens(body);
  if (tokens === undefined) return undefined;
  const states: State[] = [];
  const addState = (): number => {
    states.push({ epsilon: [], transitions: [] });
    return states.length - 1;
  };
  let current = addState();
  const start = current;
  for (const token of tokens) {
    for (let count = 0; count < token.min; count++) {
      const next = addState();
      states[current]?.transitions.push({ predicate: token.predicate, target: next });
      current = next;
    }
    if (token.max === undefined) {
      const next = addState();
      states[current]?.epsilon.push(next);
      states[current]?.transitions.push({ predicate: token.predicate, target: current });
      current = next;
    } else {
      for (let count = token.min; count < token.max; count++) {
        const next = addState();
        states[current]?.epsilon.push(next);
        states[current]?.transitions.push({ predicate: token.predicate, target: next });
        current = next;
      }
    }
    if (states.length > MAX_NFA_STATES) return undefined;
  }
  return { states, start, accept: current, anchoredStart, anchoredEnd };
}

function closure(pattern: CompiledPattern, initial: ReadonlySet<number>): Set<number> {
  const output = new Set(initial);
  const pending = [...initial];
  while (pending.length > 0) {
    const state = pending.pop();
    if (state === undefined) break;
    for (const target of pattern.states[state]?.epsilon ?? []) {
      if (!output.has(target)) {
        output.add(target);
        pending.push(target);
      }
    }
  }
  return output;
}

export function isSafeFieldPattern(pattern: string): boolean {
  return compile(pattern) !== undefined;
}

export function matchesSafeFieldPattern(value: string, source: string): boolean {
  const pattern = compile(source);
  if (pattern === undefined) return false;
  const startClosure = closure(pattern, new Set([pattern.start]));
  let active = new Set(startClosure);
  if (!pattern.anchoredEnd && active.has(pattern.accept)) return true;
  for (const character of Array.from(value)) {
    if (!pattern.anchoredStart) {
      for (const state of startClosure) active.add(state);
    }
    const next = new Set<number>();
    for (const state of active) {
      for (const transition of pattern.states[state]?.transitions ?? []) {
        if (transition.predicate(character)) next.add(transition.target);
      }
    }
    active = closure(pattern, next);
    if (!pattern.anchoredEnd && active.has(pattern.accept)) return true;
  }
  if (!pattern.anchoredStart) {
    for (const state of startClosure) active.add(state);
    active = closure(pattern, active);
  }
  return active.has(pattern.accept);
}
