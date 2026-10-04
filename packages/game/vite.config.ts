import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const PACK_DIR = fileURLToPath(new URL('../assets/default-pack/', import.meta.url));

/** Serves the default art pack at /pack/ in dev and copies it into the build. */
function defaultPack(): Plugin {
  const files = () =>
    readdirSync(PACK_DIR, { recursive: true, withFileTypes: true })
      .filter((e) => !e.isDirectory())
      .map((e) => relative(PACK_DIR, join(e.parentPath, e.name)).split(sep).join('/'));
  return {
    name: 'ibitsa-default-pack',
    configureServer(server) {
      server.middlewares.use('/pack/', (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '');
        const file = join(PACK_DIR, path);
        if (!file.startsWith(PACK_DIR) || !existsSync(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'image/png');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const file of files()) {
        this.emitFile({
          type: 'asset',
          fileName: `pack/${file}`,
          source: readFileSync(join(PACK_DIR, file)),
        });
      }
    },
  };
}

// Default build: the webview bundle the extension loads (fixed names, no HTML, no dev overlay).
// `--mode standalone`: the browser build with the replay harness, for Playwright and demos.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [defaultPack()],
  build:
    mode === 'standalone'
      ? { outDir: 'dist-standalone', emptyOutDir: true, chunkSizeWarningLimit: 2000 }
      : {
          outDir: 'dist',
          emptyOutDir: true,
          chunkSizeWarningLimit: 2000,
          rollupOptions: {
            input: 'src/webview.ts',
            output: {
              entryFileNames: 'main.js',
              assetFileNames: (asset) =>
                asset.names?.[0]?.endsWith('.css') ? 'main.css' : '[name][extname]',
            },
          },
        },
}));
