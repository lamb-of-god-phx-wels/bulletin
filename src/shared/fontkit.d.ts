declare module 'fontkit' {
  export interface Font {
    familyName?: string;
    subfamilyName?: string;
    postscriptName?: string;
    italicAngle?: number;
    ['OS/2']?: { usWeightClass?: number };
  }
  export function create(buffer: Uint8Array): Font;
}
