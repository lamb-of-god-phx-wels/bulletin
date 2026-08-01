import { describe, expect, it, vi } from 'vitest';
import { lookupBibleGatewayWeb } from '../electron/bibleGatewayScraper';

const page = `<!doctype html><html><body>
  <div class="passage-content passage-class-0">
    <div class="version-NIV result-text-style-normal text-html">
      <h3>John 3:16</h3>
      <p><span class="text John-3-16"><sup class="versenum">16&nbsp;</sup>For God so loved the world<br>that he gave his one and only Son.</span></p>
      <p>Whoever believes in him shall not perish but have eternal life.<sup class="footnote"><a>[a]</a></sup></p>
    </div>
  </div>
  <div class="publisher-info-bottom">Scripture quotations taken from the Holy Bible, New International Version® NIV®. Copyright © Biblica, Inc. Used by permission.</div>
</body></html>`;

describe('Bible Gateway public-page importer', () => {
  it('extracts passage text, removes page annotations, and retains publisher attribution', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(page));
    const result = await lookupBibleGatewayWeb({ reference: 'John 3:16', translation: 'NIV' }, fetchMock);

    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.hostname).toBe('www.biblegateway.com');
    expect(url.searchParams.get('search')).toBe('John 3:16');
    expect(url.searchParams.get('version')).toBe('NIV');
    expect(result.source).toBe('bible-gateway-web');
    expect(result.content).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '16', marks: ['superscript'] }, { type: 'text', text: 'For God so loved the world' }, { type: 'lineBreak' }, { type: 'text', text: 'that he gave his one and only Son.' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Whoever believes in him shall not perish but have eternal life.' }] }
    ]);
    expect(result.attribution).toContain('Copyright © Biblica, Inc.');
    expect(result.attribution).toContain('Retrieved from BibleGateway.com');
  });

  it('reports rate limiting without attempting to bypass it', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('Too many requests', { status: 429 }));
    await expect(lookupBibleGatewayWeb({ reference: 'John 3:16', translation: 'NIV' }, fetchMock)).rejects.toThrow('blocked or rate-limited');
  });

  it('preserves split verse ranges and accepts parenthesized display references', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(page));
    await lookupBibleGatewayWeb({ reference: '(John 1:1–3, 5–6)', translation: 'NIV' }, fetchMock);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('search')).toBe('John 1:1-3,5-6');
  });

  it('fails safely when passage markup or attribution is missing', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html><body>Page changed</body></html>'));
    await expect(lookupBibleGatewayWeb({ reference: 'John 3:16', translation: 'NIV' }, fetchMock)).rejects.toThrow('did not return recognizable passage text');
  });

  it('validates the request before fetching', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(lookupBibleGatewayWeb({ reference: '', translation: 'NIV' }, fetchMock)).rejects.toThrow('Enter a Scripture reference');
    await expect(lookupBibleGatewayWeb({ reference: 'Jude 2', translation: 'NIV' }, fetchMock)).rejects.toThrow('Jude has only one chapter');
    await expect(lookupBibleGatewayWeb({ reference: '2 John 3', translation: 'NIV' }, fetchMock)).rejects.toThrow('2 John has only one chapter');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts explicit verses and the whole chapter for single-chapter books', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(page));
    await lookupBibleGatewayWeb({ reference: 'Jude 1:2', translation: 'NIV' }, fetchMock);
    await lookupBibleGatewayWeb({ reference: 'Jude 1', translation: 'NIV' }, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
