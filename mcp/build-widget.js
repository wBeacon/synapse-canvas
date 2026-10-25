import { build } from 'esbuild'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, resolve, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('../', import.meta.url))

async function dependencyNotices(inputs) {
  const packages = new Map()
  for (const input of Object.keys(inputs)) {
    if (!input.includes('node_modules/')) continue
    let directory = dirname(resolve(root, input))
    while (directory !== parse(directory).root) {
      try {
        const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
        if (metadata.name && metadata.version) {
          if (!packages.has(metadata.name)) {
            const names = await readdir(directory)
            const license = names.find(name => /^licen[cs]e(?:\.|$)/i.test(name))
            if (!license) throw new Error(`Missing license for ${metadata.name}`)
            packages.set(metadata.name, `${metadata.name}@${metadata.version}\n${await readFile(resolve(directory, license), 'utf8')}`)
          }
          break
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      directory = dirname(directory)
    }
  }
  return [...packages.values()].sort().join('\n\n---\n\n')
}

export async function buildWidget() {
  const result = await build({ absWorkingDir: root, entryPoints: ['mcp/app.js'], bundle: true,
    platform: 'browser', format: 'esm', target: 'es2022', write: false, minify: true,
    metafile: true, legalComments: 'inline' })
  const [page, baseStyle, previewStyle, notices, projectNotice, projectLicense] = await Promise.all([
    readFile(resolve(root, 'preview/index.html'), 'utf8'),
    readFile(resolve(root, 'styles.css'), 'utf8'),
    readFile(resolve(root, 'preview/preview.css'), 'utf8'), dependencyNotices(result.metafile.inputs),
    readFile(resolve(root, 'NOTICE'), 'utf8'), readFile(resolve(root, 'LICENSE'), 'utf8'),
  ])
  const embeddedStyle = '\nhtml,body{height:100%;min-height:420px}.synapse-shell{height:100vh;min-height:420px}'
  // The official SDK includes its validators. Compress the self-contained
  // module so it stays within WorkBuddy's UI resource prefetch budget.
  // Decompression and module execution use browser APIs, with no CDN or eval.
  const packed = gzipSync(result.outputFiles[0].contents, { level: 9 }).toString('base64')
  const bootstrap = `try {
    const bytes = Uint8Array.from(atob('${packed}'), c => c.charCodeAt(0));
    const source = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const script = document.createElement('script'); script.type = 'module'; script.textContent = source;
    document.body.append(script);
  } catch { const notice = document.querySelector('#notice'); notice.hidden = false; notice.textContent = '画布组件加载失败，请重新打开应用'; }`
  const html = page.replace(/<link rel="stylesheet"[^>]+>/g, '')
    .replace('</head>', `<style>${baseStyle}\n${previewStyle}${embeddedStyle}</style></head>`)
    .replace('<script type="module" src="/app.js"></script>', `<script type="module">${bootstrap}</script>`)
    .replace('</body>', `<!-- Project and Third-party notices\n${[projectNotice, projectLicense, notices].join('\n\n').replace(/-->/g, '--&gt;')}\n--></body>`)
  if (Buffer.byteLength(html) > 256 * 1024) throw new Error('Widget exceeds the host prefetch limit')
  await writeFile(resolve(root, 'mcp/widget.html'), html)
  await writeFile(resolve(root, 'mcp/THIRD_PARTY_NOTICES.txt'), notices + '\n')
  return { bytes: Buffer.byteLength(html), dependencies: Object.keys(result.metafile.inputs).filter(path => path.includes('node_modules/')).length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildWidget().then(result => console.log(`MCP widget built: ${result.bytes} bytes`))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
