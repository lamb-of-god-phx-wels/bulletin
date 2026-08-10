import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { bundledFontFamilies, effectiveFontRoles, familyCssName, fontReferenceValue, resolveFontReference } from '../shared/fonts.js';
import { bytesFromDataUrl } from '../shared/fontMetadata.js';
import type { FontFaceV1, FontReference, LibraryManifestV1, TemplateV1 } from '../shared/types.js';
import { setFontLoadErrors } from '../shared/fontRuntime.js';

export interface FontOption { value: string; label: string; previewFamily: string; group: 'Theme fonts' | 'Font families'; ref: FontReference }

interface FontContextValue {
  options: FontOption[];
  ready: boolean;
  errors: string[];
  resolve(ref?: FontReference, legacy?: string): string | undefined;
}

const fallbackContext: FontContextValue = {
  options: [], ready: true, errors: [], resolve: (_ref, legacy) => legacy,
};
const FontContext = createContext<FontContextValue>(fallbackContext);

function fontBytes(source: string): ArrayBuffer {
  const bytes = bytesFromDataUrl(source);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function ImportedFontPreview({ root, faces, label }: { root: string; faces: FontFaceV1[]; label: string }) {
  const id = useId();
  const family = useMemo(() => `BulletinFont-Draft-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`, [id]);
  const signature = faces.map(face => `${face.asset.path}:${face.weight}:${face.style}`).join('|');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!window.bulletin || typeof FontFace === 'undefined') return;
    let active = true;
    const loaded: FontFace[] = [];
    setReady(false); setError('');
    void Promise.all(faces.map(async definition => {
      const source = await window.bulletin!.readAsset(root, definition.asset.path);
      const face = new FontFace(family, fontBytes(source), { weight: String(definition.weight), style: definition.style });
      await face.load();
      if (!active) return;
      document.fonts.add(face); loaded.push(face);
    })).then(() => { if (active) setReady(true); }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; loaded.forEach(face => document.fonts.delete(face)); };
  }, [root, family, faces, signature]);
  return <div className="font-family-preview" style={{ fontFamily: ready ? family : undefined }}>
    {label || 'Font preview'} — Ag 0123
    {!ready && !error && <small>Loading preview…</small>}
    {error && <small className="font-warning">Preview unavailable: {error}</small>}
  </div>;
}

export function LibraryFontProvider({ root, library, template, children }: { root?: string; library?: LibraryManifestV1; template?: TemplateV1; children: ReactNode }) {
  const fontItems = useMemo(() => (library?.items ?? []).filter(item => item.kind === 'font'), [library]);
  const options = useMemo(() => {
    const result: FontOption[] = [];
    if (template) for (const role of effectiveFontRoles(template.theme, library)) {
      const ref: FontReference = { kind: 'themeRole', roleId: role.id };
      result.push({ value: fontReferenceValue(ref), label: role.name, group: 'Theme fonts', ref, previewFamily: familyCssName(role.family, library) ?? 'sans-serif' });
    }
    const newest = new Map<string, number>();
    fontItems.forEach(item => newest.set(item.id, Math.max(newest.get(item.id) ?? 0, item.version)));
    for (const item of [...fontItems].sort((left, right) => left.title.localeCompare(right.title) || right.version - left.version)) {
      const ref: FontReference = { kind: 'libraryFont', family: { id: item.id, version: item.version } };
      result.push({ value: fontReferenceValue(ref), label: `${item.title} · v${item.version}${newest.get(item.id) === item.version ? ' (latest)' : ''}`, group: 'Font families', ref, previewFamily: familyCssName(ref.family, library) ?? 'sans-serif' });
    }
    for (const item of bundledFontFamilies) {
      const ref: FontReference = { kind: 'libraryFont', family: { id: item.id, version: item.version } };
      if (!result.some(option => option.value === fontReferenceValue(ref))) result.push({ value: fontReferenceValue(ref), label: item.title, group: 'Font families', ref, previewFamily: item.cssFamily });
    }
    return result;
  }, [fontItems, library, template]);
  const signature = `${root ?? ''}|${fontItems.map(item => `${item.id}@${item.version}:${(item.fontFaces ?? item.assets ?? []).map(face => 'asset' in face ? face.asset.path : face.path).join(',')}`).join('|')}`;
  const [loadedSignature, setLoadedSignature] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (!template) return;
    const properties = effectiveFontRoles(template.theme, library).map(role => [`--font-role-${role.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`, familyCssName(role.family, library) ?? 'sans-serif'] as const);
    properties.forEach(([name, value]) => document.documentElement.style.setProperty(name, value));
    return () => properties.forEach(([name]) => document.documentElement.style.removeProperty(name));
  }, [template, library]);
  useEffect(() => {
    if (!root || !window.bulletin || typeof FontFace === 'undefined') { setLoadedSignature(signature); return; }
    let active = true;
    const faces: FontFace[] = [];
    setErrors([]); setFontLoadErrors([]);
    const jobs = fontItems.flatMap(item => {
      const definitions = item.fontFaces?.length
        ? item.fontFaces
        : (item.assets ?? []).map(asset => ({ asset, weight: 400, style: 'normal' as const }));
      return definitions.map(definition => ({ item, definition }));
    });
    void Promise.allSettled(jobs.map(async ({ item, definition }) => {
        const source = await window.bulletin!.readAsset(root, definition.asset.path);
        if (!active) return;
        const family = familyCssName({ id: item.id, version: item.version }, library)!;
        const face = new FontFace(family, fontBytes(source), { weight: String(definition.weight), style: definition.style });
        await face.load();
        if (!active) return;
        document.fonts.add(face); faces.push(face);
    })).then(results => {
      if (!active) return;
      const messages = results.flatMap((result, index) => result.status === 'rejected'
        ? [`${jobs[index]?.item.title ?? 'Imported font'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
        : []);
      setErrors(messages); setFontLoadErrors(messages); setLoadedSignature(signature);
    });
    return () => { active = false; faces.forEach(face => document.fonts.delete(face)); setFontLoadErrors([]); };
  }, [root, fontItems, library, signature]);
  const value = useMemo<FontContextValue>(() => ({
    options,
    ready: loadedSignature === signature,
    errors,
    resolve: (ref, legacy) => template ? resolveFontReference(ref, legacy, template, library) : legacy,
  }), [options, loadedSignature, signature, errors, template, library]);
  return <FontContext.Provider value={value}>{children}</FontContext.Provider>;
}

export const useFontOptions = () => useContext(FontContext).options;
export const useLibraryFontsReady = () => useContext(FontContext).ready;
export const useFontLoadErrors = () => useContext(FontContext).errors;
export const useFontResolver = () => useContext(FontContext).resolve;
