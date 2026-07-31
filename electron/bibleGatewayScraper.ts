import type { ScriptureBlock } from '../src/shared/types.js';
import {
  SCRIPTURE_LINE_BREAK,
  SCRIPTURE_PARAGRAPH_BREAK,
  scriptureParagraphsFromText,
  VERSE_NUMBER_END,
  VERSE_NUMBER_START
} from '../src/shared/scriptureText.js';
import { normalizeScriptureReference } from '../src/shared/scriptureReference.js';

export interface BibleGatewayWebRequest {
  reference: string;
  translation: string;
}

type FetchLike = typeof fetch;

function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', hellip: '…', laquo: '“', ldquo: '“', lsquo: '‘', lt: '<', nbsp: ' ', ndash: '–', quot: '"', raquo: '”', rdquo: '”', rsquo: '’' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.toLowerCase().startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function plainText(html: string, structured = false) {
  const lineBreak = structured ? SCRIPTURE_LINE_BREAK : '\n';
  const paragraphBreak = structured ? SCRIPTURE_PARAGRAPH_BREAK : '\n';
  return decodeEntities(html
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<sup\b[^>]*class=["'][^"']*(?:footnote|crossreference)[^"']*["'][^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<sup\b[^>]*class=["'][^"']*\bversenum\b[^"']*["'][^>]*>([\s\S]*?)<\/sup>/gi, (_match, number: string) => `${VERSE_NUMBER_START}${decodeEntities(number.replace(/<[^>]+>/g, '')).trim()}${VERSE_NUMBER_END} `)
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, lineBreak)
    .replace(/<\/(?:p|div|li|blockquote)>/gi, paragraphBreak)
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(new RegExp(`${SCRIPTURE_LINE_BREAK}{3,}`, 'g'), `${SCRIPTURE_LINE_BREAK}${SCRIPTURE_LINE_BREAK}`)
    .replace(new RegExp(`${SCRIPTURE_PARAGRAPH_BREAK}{2,}`, 'g'), SCRIPTURE_PARAGRAPH_BREAK)
    .trim();
}

function passageSection(html: string) {
  const startMatch = /<div\b[^>]*class=["'][^"']*\bpassage-content\b[^"']*["'][^>]*>/i.exec(html)
    ?? /<div\b[^>]*class=["'][^"']*\bpassage-text\b[^"']*["'][^>]*>/i.exec(html);
  if (!startMatch) return '';
  const start = startMatch.index + startMatch[0].length;
  const rest = html.slice(start);
  const endMarkers = [
    /<div\b[^>]*class=["'][^"']*publisher-info-bottom/i,
    /<div\b[^>]*class=["'][^"']*passage-other-trans/i,
    /<[a-z][^>]*class=["'][^"']*\bfull-chap-link\b/i,
    /<[a-z][^>]*class=["'][^"']*\bcrossrefs\b/i,
    /<div\b[^>]*id=["']crossrefs/i
  ];
  const end = Math.min(...endMarkers.map(pattern => pattern.exec(rest)?.index ?? Number.POSITIVE_INFINITY));
  return rest.slice(0, Number.isFinite(end) ? end : undefined);
}

function publisherAttribution(html: string) {
  const match = /<div\b[^>]*class=["'][^"']*publisher-info-bottom[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)
    ?? /<div\b[^>]*class=["'][^"']*publisher-info[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  return match ? plainText(match[1]) : '';
}

export async function lookupBibleGatewayWeb(input: BibleGatewayWebRequest, fetchImpl: FetchLike = fetch): Promise<NonNullable<ScriptureBlock['resolved']>> {
  const reference = normalizeScriptureReference(input.reference);
  const translation = input.translation.trim().toUpperCase();
  if (!reference) throw new Error('Enter a Scripture reference first.');
  if (!translation) throw new Error('Enter a Bible Gateway translation code, such as NIV or EHV.');

  const url = new URL('https://www.biblegateway.com/passage/');
  url.searchParams.set('search', reference);
  url.searchParams.set('version', translation);
  try {
    const response = await fetchImpl(url, { headers: { accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9', 'user-agent': 'BulletinBuilder/0.1 (+local church bulletin authoring)' }, redirect: 'follow' });
    if (response.status === 403 || response.status === 429) throw new Error('BibleGateway.com blocked or rate-limited the request. Open the passage in your browser and paste the approved text manually.');
    if (!response.ok) throw new Error(`BibleGateway.com returned ${response.status}. Open the passage and use the manual fallback.`);
    const html = await response.text();
    const text = plainText(passageSection(html), true);
    if (!text && /captcha|verify you are human|cf-chl-/i.test(html)) throw new Error('BibleGateway.com requested browser verification. Open the passage and paste the approved text manually.');
    if (!text) throw new Error('BibleGateway.com did not return recognizable passage text. The page may have changed; use the manual fallback.');
    const attribution = publisherAttribution(html);
    if (!attribution) throw new Error('BibleGateway.com did not return the translation copyright notice. Open the passage and paste both the text and required attribution manually.');
    return {
      content: scriptureParagraphsFromText(text),
      source: 'bible-gateway-web',
      retrievedAt: new Date().toISOString(),
      attribution: `${attribution} · Retrieved from BibleGateway.com`
    };
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('BibleGateway.com') || error.message.startsWith('Enter '))) throw error;
    throw new Error(`Could not reach BibleGateway.com: ${error instanceof Error ? error.message : String(error)}`);
  }
}
