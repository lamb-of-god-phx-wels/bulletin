import type { BulletinDocumentV1, TemplateV1 } from './types.js';

export function templateForBulletin(template: TemplateV1, document: BulletinDocumentV1): TemplateV1 {
  const marginIn = document.layout?.marginIn;
  const responsiveReading = document.responsiveReading;
  if ((marginIn === undefined || marginIn === template.theme.marginIn) && !responsiveReading) return template;
  return {
    ...template,
    ...(responsiveReading ? { responsiveReading } : {}),
    theme: marginIn === undefined ? template.theme : { ...template.theme, marginIn },
  };
}
