import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LibraryManifestV1 } from '../shared/types';

export interface FontOption { value: string; label: string }

export const builtInFontOptions: FontOption[] = [
  { value: 'body', label: 'Template body' },
  { value: 'display', label: 'Template display' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Calibri, Arial, sans-serif', label: 'Calibri' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Times New Roman, serif', label: 'Times New Roman' },
];

const FontContext = createContext<{ options: FontOption[]; ready: boolean }>({ options: builtInFontOptions, ready: true });

export function LibraryFontProvider({ root, library, children }: { root?: string; library?: LibraryManifestV1; children: ReactNode }) {
  const families = useMemo(() => [...new Map((library?.items ?? [])
    .filter(item => item.kind === 'font' && item.assets?.length)
    .sort((a, b) => b.version - a.version)
    .map(item => [item.id, item])).values()], [library]);
  const options = useMemo(() => [
    ...builtInFontOptions,
    ...families.map(item => ({ value: item.title, label: `${item.title} · Library` })),
  ], [families]);
  const signature = `${root ?? ''}|${families.map(item => `${item.id}@${item.version}:${item.assets?.map(asset => asset.path).join(',')}`).join('|')}`;
  const [loadedSignature, setLoadedSignature] = useState('');
  useEffect(() => {
    if (!root || !window.bulletin || typeof FontFace === 'undefined') { setLoadedSignature(signature); return; }
    let active = true;
    const faces: FontFace[] = [];
    void Promise.all(families.flatMap(item => (item.assets ?? []).map(async asset => {
      const source = await window.bulletin!.readAsset(root, asset.path);
      if (!active) return;
      const face = new FontFace(item.title, `url(${source})`);
      await face.load();
      if (!active) return;
      document.fonts.add(face); faces.push(face);
    }))).then(() => { if (active) setLoadedSignature(signature); }).catch(() => { if (active) setLoadedSignature(signature); });
    return () => { active = false; faces.forEach(face => document.fonts.delete(face)); };
  }, [root, families, signature]);
  return <FontContext.Provider value={{ options, ready: loadedSignature === signature }}>{children}</FontContext.Provider>;
}

export const useFontOptions = () => useContext(FontContext).options;
export const useLibraryFontsReady = () => useContext(FontContext).ready;
