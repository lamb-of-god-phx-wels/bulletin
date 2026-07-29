interface ParsedVersion {
  numbers: [number, number, number];
  prerelease: Array<number | string>;
}

function parseIdentifier(value: string): number | string {
  return /^\d+$/.test(value) ? Number(value) : value;
}

export function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return undefined;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.').map(parseIdentifier) : []
  };
}

export function compareVersions(leftValue: string, rightValue: string): number | undefined {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return undefined;
  for (let index = 0; index < left.numbers.length; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) return left.numbers[index] > right.numbers[index] ? 1 : -1;
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length ? -1 : 1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === 'number' && typeof rightPart === 'string') return -1;
    if (typeof leftPart === 'string' && typeof rightPart === 'number') return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function meetsMinimumVersion(currentVersion: string, minimumVersion?: string): boolean {
  if (!minimumVersion) return true;
  const comparison = compareVersions(currentVersion, minimumVersion);
  return comparison === undefined ? false : comparison >= 0;
}
