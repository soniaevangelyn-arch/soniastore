import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: 'api-shopee-metadata-dev',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url && req.url.startsWith('/api/shopee-metadata')) {
            const { default: handler } = await import('./api/shopee-metadata.js');
            if (req.method === 'POST') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', async () => {
                try {
                  req.body = JSON.parse(body);
                } catch (e) {
                  req.body = {};
                }
                const mockRes = {
                  statusCode: 200,
                  setHeader(k, v) { res.setHeader(k, v); },
                  status(code) { this.statusCode = code; return this; },
                  json(data) {
                    res.statusCode = this.statusCode;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(data));
                  },
                  end() { res.end(); }
                };
                await handler(req, mockRes);
              });
            } else {
              const urlObj = new URL(req.url, 'http://localhost:3000');
              req.query = Object.fromEntries(urlObj.searchParams.entries());
              const mockRes = {
                statusCode: 200,
                setHeader(k, v) { res.setHeader(k, v); },
                status(code) { this.statusCode = code; return this; },
                json(data) {
                  res.statusCode = this.statusCode;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(data));
                },
                end() { res.end(); }
              };
              await handler(req, mockRes);
            }
            return;
          }
          next();
        });
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        admin: resolve(rootDir, 'admin.html')
      }
    }
  }
});
