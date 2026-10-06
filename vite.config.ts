import { readFileSync, readdirSync } from 'node:fs';
import { marked } from 'marked';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serves / emits docs/QUICK-START.md as one static page, docs/quick-start.html, with its
 * images, so the in-app Help can link to it on any host (including GitHub Pages under
 * /<repo>/). Build-time only: nothing is added to the application bundle.
 */
function quickStartPage(): Plugin {
  const render = (): string => {
    let md = readFileSync('docs/QUICK-START.md', 'utf8');
    // Links to other docs/*.md: point at the repository on GitHub when known, else plain text.
    const repo = process.env.GITHUB_REPOSITORY;
    const ref = process.env.GITHUB_REF_NAME || 'main';
    md = md.replace(/\[([^\]]+)\]\(([A-Za-z-]+\.md)\)/g, (_m, text: string, file: string) =>
      repo ? `[${text}](https://github.com/${repo}/blob/${ref}/docs/${file})` : text,
    );
    const body = marked.parse(md, { async: false }) as string;
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>emmm Quick Start</title>
<style>
:root{color-scheme:light}
body{margin:0;background:#fff;color:#000;font:16px/1.55 Georgia,"Times New Roman",serif}
main{max-width:46rem;margin:0 auto;padding:1.5rem 1rem 4rem}
h1,h2,h3{font-family:Helvetica,Arial,sans-serif;line-height:1.2}
h1{border-bottom:3px solid #000;padding-bottom:.3rem}
h2{border-bottom:1px solid #000;padding-bottom:.2rem;margin-top:2.5rem}
img{max-width:100%;height:auto;border:1px solid #000}
code,pre{font-family:Menlo,Consolas,monospace;font-size:.9em}
pre{background:#f2f2f2;padding:.75rem;overflow-x:auto}
blockquote{margin:1rem 0;padding:.25rem 1rem;border-left:4px solid #000;background:#f7f7f7}
table{border-collapse:collapse;width:100%;font-size:.95em}
th,td{border:1px solid #000;padding:.3rem .5rem;text-align:left;vertical-align:top}
a{color:#000}
.back{font-family:Helvetica,Arial,sans-serif;font-size:.9rem}
</style></head>
<body><main><p class="back"><a href="../">← back to emmm</a></p>
${body}
</main></body></html>`;
  };
  return {
    name: 'emmm-quick-start',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0].endsWith('/docs/quick-start.html')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(render());
        } else next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'docs/quick-start.html', source: render() });
      for (const f of readdirSync('docs/images')) {
        if (f.endsWith('.png')) this.emitFile({ type: 'asset', fileName: `docs/images/${f}`, source: readFileSync(`docs/images/${f}`) });
      }
    },
  };
}

export default defineConfig({
  // Relative by default (works from any folder); GitHub Pages builds pass --base=/<repo>/.
  base: './',
  server: { port: 5199 },
  plugins: [quickStartPage()],
  test: { include: ['test/**/*.test.ts'] },
} as never);
