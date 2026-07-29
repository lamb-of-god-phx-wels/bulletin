import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { lookupBibleGatewayWeb } from './electron/bibleGatewayScraper';
import { lookupServiceBuilderChurchWeek } from './electron/serviceBuilder';

function requestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; if (body.length > 16_384) reject(new Error('Request is too large.')); });
    request.on('end', () => resolve(body)); request.on('error', reject);
  });
}

function bibleGatewayProxy(): Plugin {
  return {
    name: 'bulletin-bible-gateway-proxy',
    configureServer(server) {
      server.middlewares.use('/__bulletin/bible-gateway', async (request, response) => {
        response.setHeader('content-type', 'application/json');
        if (request.method !== 'POST') { response.statusCode = 405; response.end(JSON.stringify({ error: 'Method not allowed.' })); return; }
        try { response.end(JSON.stringify(await lookupBibleGatewayWeb(JSON.parse(await requestBody(request))))); }
        catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
      });
    }
  };
}

function serviceBuilderProxy(): Plugin {
  return {
    name: 'bulletin-service-builder-proxy',
    configureServer(server) {
      server.middlewares.use('/__bulletin/church-week', async (request, response) => {
        response.setHeader('content-type', 'application/json');
        if (request.method !== 'POST') { response.statusCode = 405; response.end(JSON.stringify({ error: 'Method not allowed.' })); return; }
        try {
          const input = JSON.parse(await requestBody(request)) as { date?: unknown };
          if (typeof input.date !== 'string') throw new Error('Choose a valid service date first.');
          response.end(JSON.stringify(await lookupServiceBuilderChurchWeek(input.date)));
        } catch (error) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [bibleGatewayProxy(), serviceBuilderProxy(), react()],
  base: './',
  server: { host: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
});
