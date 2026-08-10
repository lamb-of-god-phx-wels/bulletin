import * as fontkit from 'fontkit';
import type { FontFaceV1 } from './types.js';

const namedWeights: Array<[RegExp, number]> = [
  [/thin/i, 100], [/extra.?light|ultra.?light/i, 200], [/light/i, 300], [/medium/i, 500],
  [/semi.?bold|demi.?bold/i, 600], [/extra.?bold|ultra.?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700],
];

export function detectFontFace(bytes: Uint8Array, asset: FontFaceV1['asset']): FontFaceV1 {
  const font = fontkit.create(bytes);
  const subfamily = font.subfamilyName ?? '';
  const detectedWeight = font['OS/2']?.usWeightClass ?? namedWeights.find(([pattern]) => pattern.test(subfamily))?.[1] ?? 400;
  return {
    asset,
    weight: Math.min(900, Math.max(100, Math.round(detectedWeight / 100) * 100)),
    style: /italic|oblique/i.test(subfamily) || Boolean(font.italicAngle) ? 'italic' : 'normal',
    ...(font.familyName ? { familyName: font.familyName } : {}),
    ...(font.subfamilyName ? { subfamilyName: font.subfamilyName } : {}),
    ...(font.postscriptName ? { postscriptName: font.postscriptName } : {}),
  };
}

export function bytesFromDataUrl(value: string) {
  const encoded = value.slice(value.indexOf(',') + 1);
  const binary = atob(encoded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
