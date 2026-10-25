import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
export const outputDirectory = resolve(root, 'dist/buddy-menu')
export const menuManifest = { pages: [{ id: 'synapse-canvas', entry: 'index.html',
  assets: ['assets/app.js', 'assets/styles.css', 'LICENSE', 'NOTICE'] }] }

export async function buildBuddyPage(directory = outputDirectory) {
  const bundle = await build({ absWorkingDir: root, entryPoints: ['buddy/app.js'], bundle: true,
    platform: 'browser', format: 'esm', target: 'es2022', charset: 'utf8', write: false, minify: true, metafile: true })
  const inputs = Object.keys(bundle.metafile.inputs)
  if (inputs.some(path => path.startsWith('adapters/') || path.includes('node_modules/'))) {
    throw new Error('Menu demo must contain only the shared view and synthetic fixture')
  }
  const [page, baseStyle, previewStyle, license, notice] = await Promise.all([
    readFile(resolve(root, 'preview/index.html'), 'utf8'), readFile(resolve(root, 'styles.css'), 'utf8'),
    readFile(resolve(root, 'preview/preview.css'), 'utf8'), readFile(resolve(root, 'LICENSE'), 'utf8'), readFile(resolve(root, 'NOTICE'), 'utf8'),
  ])
  const html = page.replace('<title>Synapse Canvas · WorkBuddy</title>', '<title>Synapse Canvas · 侧栏示例</title>')
    .replace(/<link rel="stylesheet"[^>]+>/g, '')
    .replace('</head>', '<link rel="stylesheet" href="./assets/styles.css"></head>')
    .replace('src="/app.js"', 'src="./assets/app.js"')
  await mkdir(resolve(directory, 'assets'), { recursive: true })
  for (const [name, contents] of Object.entries({ 'index.html': html,
    'assets/app.js': bundle.outputFiles[0].text, 'assets/styles.css': `${baseStyle}\n${previewStyle}`,
    'manifest.json': JSON.stringify(menuManifest, null, 2) + '\n', LICENSE: license, NOTICE: notice })) {
    await writeFile(resolve(directory, name), contents)
  }
  return { directory, bytes: Buffer.byteLength(html), inputs }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildBuddyPage().then(result => console.log(`Buddy menu demo built: ${result.bytes} bytes`))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
