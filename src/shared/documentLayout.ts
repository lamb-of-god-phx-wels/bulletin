import type { BulletinDocumentV1, TemplateV1 } from './types.js';

export function templateForBulletin(template: TemplateV1, document: BulletinDocumentV1): TemplateV1 {
  const marginIn = document.layout?.marginIn;
  if (marginIn === undefined || marginIn === template.theme.marginIn) return template;
  return { ...template, theme: { ...template.theme, marginIn } };
}
