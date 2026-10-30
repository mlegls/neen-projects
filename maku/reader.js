import { REFERENCES, TUTORIALS, assetUrl } from './manifest.js';
import { markdownToHtml } from './markdown.js';
import { highlightCodeBlocks } from './maku-highlight.js';

const tutorialList = document.getElementById('tutorial-list');
const referenceList = document.getElementById('reference-list');
const body = document.getElementById('doc-body');
const documents = [...TUTORIALS, ...REFERENCES];
let selected = TUTORIALS[0];

function renderItems(container, items) {
  container.replaceChildren(...items.map(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = item === selected ? 'active' : '';
    btn.textContent = item.title;
    btn.onclick = () => select(item);
    return btn;
  }));
}

function renderLists() {
  renderItems(tutorialList, TUTORIALS);
  renderItems(referenceList, REFERENCES);
}

function slugFor(item) {
  return item.doc.split('/').pop().replace(/\.md$/, '');
}

async function select(item) {
  selected = item;
  renderLists();
  body.textContent = 'Loading...';
  const section = item.doc.split('/')[0];
  const htmlBase = globalThis.DANMAKU_DOC_HTML_BASES?.[section];
  if (htmlBase) {
    const res = await fetch(new URL(`${slugFor(item)}.html`, htmlBase).toString());
    if (!res.ok) throw new Error(`${item.doc}: HTTP ${res.status}`);
    body.innerHTML = await res.text();
  } else {
    const md = await (await fetch(assetUrl(item.doc))).text();
    body.innerHTML = markdownToHtml(md);
  }
  highlightCodeBlocks(body);
  history.replaceState(null, '', `#${slugFor(item)}`);
}

const slug = location.hash.slice(1);
const initial = documents.find(item => slugFor(item) === slug) || selected;
select(initial);
