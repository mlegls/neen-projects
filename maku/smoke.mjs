// neen.ink Maku integration smoke. Run from the repository root with:
//   bun projects/maku/smoke.mjs
// Set MAKU_BASE_URL=http://127.0.0.1:PORT to include served-route/MIME checks.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initMaku, { createMaku, releaseIdentity } from './pkg/dist/index.js';
import { ALL_CARDS, CARD_FILES, REFERENCES, TUTORIALS, cardSlug } from './manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const integration = JSON.parse(readFileSync(join(here, 'maku-integration.json'), 'utf8'));
const release = JSON.parse(readFileSync(join(here, 'pkg/wasm/release.json'), 'utf8'));
await initMaku({ moduleOrPath: readFileSync(join(here, 'pkg/wasm/maku_bg.wasm')) });
const identity = releaseIdentity();
if (identity.makuVersion !== release.maku_version
    || identity.frameAbiVersion !== release.frame_abi_version
    || identity.sourceRevision !== release.source_revision
    || identity.sourceRevision !== integration.maku_source_revision) {
  throw new Error(`mixed downstream release: ${JSON.stringify({ identity, release, integration })}`);
}

const slugs = ALL_CARDS.map(cardSlug);
if (new Set(slugs).size !== slugs.length) throw new Error(`duplicate card URL slug: ${slugs.join(', ')}`);

const maku = createMaku();
for (const path of CARD_FILES) maku.add_file(path, readFileSync(join(here, path), 'utf8'));
maku.boot('cards/render-pack-showcase.maku', 'showcase');
if (!maku.running()) throw new Error(`showcase boot failed: ${maku.status()}`);
maku.step(2);
maku.build_render_frame();
const draws = maku.draw_commands(), stride = maku.draw_command_stride();
const tags = new Set();
for (let i = 0; i < draws.length; i += stride) {
  const material = draws[i], tag = draws[i + 1];
  if (material >= maku.material_count() || maku.material_layout(material) !== tag) {
    throw new Error('downstream command/material mismatch');
  }
  tags.add(tag);
}
if (![0, 1, 3].every(tag => tags.has(tag))) throw new Error(`showcase frame is incomplete: ${[...tags]}`);
if (!maku.render_diagnostics().includes('showcase-unknown-family')) {
  throw new Error('showcase fallback diagnostic is missing');
}
const main = readFileSync(join(here, 'main.js'), 'utf8');
if (!main.includes("'./canvas-renderer.js'") || /\.dots\(|\.beams\(/.test(main)) {
  throw new Error('site runtime is not using the synchronized ordered-frame adapter');
}
for (const tutorial of TUTORIALS) {
  const source = readFileSync(join(here, tutorial.doc), 'utf8');
  const link = `https://neen.ink/projects/maku/play.html?card=${cardSlug(tutorial)}`;
  if (!source.includes(link)) throw new Error(`${tutorial.doc} omits interactive deep link`);
}
for (const reference of REFERENCES) readFileSync(join(here, reference.doc), 'utf8');
const reader = readFileSync(join(here, 'tutorials.html'), 'utf8');
if (!reader.includes('id="reference-list"')) throw new Error('reader omits reference section');

if (process.env.MAKU_BASE_URL) {
  const base = new URL(process.env.MAKU_BASE_URL);
  const request = async path => {
    const response = await fetch(new URL(path, base));
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response;
  };
  const player = await request('/projects/maku/play.html');
  if (!(await player.text()).includes('main.js')) throw new Error('player route omits main.js');
  await request('/projects/maku/pkg/dist/index.js');
  const wasm = await request('/projects/maku/pkg/wasm/maku_bg.wasm');
  if (!(wasm.headers.get('content-type') || '').startsWith('application/wasm')) {
    throw new Error(`wrong wasm MIME: ${wasm.headers.get('content-type')}`);
  }
  for (const tutorial of TUTORIALS) {
    const slug = tutorial.doc.split('/').pop().replace(/\.md$/, '');
    await request(`/projects/maku/tutorials/${slug}.html`);
  }
  for (const reference of REFERENCES) {
    const slug = reference.doc.split('/').pop().replace(/\.md$/, '');
    await request(`/projects/maku/reference/${slug}.html`);
  }
}
console.log(`NEEN MAKU SMOKE PASS · ${identity.sourceRevision} · tags ${[...tags]}`);
