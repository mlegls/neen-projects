/// <reference lib="dom" />
// 英漢字 transcriber — renders English into the constructed Anglo-Sinitic script.
// The deterministic layers only; sound-borrows and most calques are the author's.
// Dictionary (CMUDict) and Zipf frequency are fetched as plaintext TSV siblings
// (cmudict.txt, zipf.txt) — editable directly, gzipped by the server in flight.

// ================= phoneme + mapping tables =================
// Voicing rides the MC 清/濁 split: each voiced consonant's root has the
// corresponding 全濁 initial (並 b, 定 d, 邪 z, 禪 ð/ʒ, 崇 dʒ).
const C: Record<string, string> = {
  P: "卜", B: "皮", T: "丁", D: "大", K: "工", G: "求", M: "冖", N: "乚", NG: "乙",
  F: "方", V: "万", TH: "矢", DH: "氏", S: "厶", Z: "夕", SH: "尸", ZH: "石",
  CH: "扎", JH: "乍", HH: "厂", R: "儿", L: "力", W: "云", Y: "丨",
};
const VOW: Record<string, string> = {
  IH: "已", IY: "夷", EH: "也", AE: "丫", AH: "之", UH: "乇", UW: "于", AA: "五",
  AO: "幺", EY: "乁", AY: "歹", OW: "冘", AW: "夬", OY: "弔", ER: "儿",
};
const VOWELS = new Set(Object.keys(VOW));
const isVowel = (p: string) => VOWELS.has(p);

// promoted cluster atoms (ARPABET joined by space -> glyph), sourced by most-informative member.
// One shared cluster->glyph table (a cluster keeps its glyph in any position it is legal).
const CLUSTER: Record<string, string> = {
  // onset-legal
  "S P": "巴", "S T": "多", "S K": "古", "S L": "立", "S W": "王", "S N": "尼", "S M": "木", "S T R": "束",
  "P R": "不", "B R": "白", "T R": "才", "D R": "丈", "K R": "克", "G R": "巨", "F R": "弗",
  "P L": "必", "B L": "百", "K L": "可", "G L": "各", "F L": "乏", "K W": "瓜",
  // coda-legal
  "N T": "寸", "N D": "乃", "M P": "内", "NG K": "乞", "L T": "卡", "L D": "乜", "L K": "卢",
  "R T": "斥", "R D": "叉", "R K": "卬", "K T": "七", "F T": "干", "P T": "弁",
};
// 'S T','S K','S P' are legal in BOTH positions and share their glyph across them.
const ONSET_OK = new Set(["S P", "S T", "S K", "S L", "S W", "S N", "S M", "S T R", "P R", "B R", "T R", "D R", "K R", "G R", "F R", "P L", "B L", "K L", "G L", "F L", "K W"]);
const CODA_OK = new Set(["N T", "N D", "M P", "NG K", "L T", "L D", "L K", "R T", "R D", "R K", "K T", "F T", "P T", "S T", "S K", "S P"]);
const LEGAL2 = new Set("S P,S T,S K,S M,S N,S F,S L,S W,P L,B L,K L,G L,F L,P R,B R,T R,D R,K R,G R,F R,TH R,SH R,T W,D W,K W,G W,TH W,HH Y,P Y,B Y,K Y,F Y,M Y,V Y".split(","));
const LEGAL3 = new Set("S P L,S P R,S T R,S K R,S K W,S P Y,S T Y,S K Y".split(","));

function legalOnset(c: string[]): boolean {
  if (c.length <= 1) return true;
  if (c.length === 2) return LEGAL2.has(c.join(" "));
  if (c.length === 3) return LEGAL3.has(c.join(" "));
  return false;
}

type Syllable = { onset: string[]; nucleus: string | null; coda: string[] };

function syllabify(ph: string[]): Syllable[] {
  const idx: number[] = [];
  ph.forEach((p, i) => { if (isVowel(p)) idx.push(i); });
  if (!idx.length) return [{ onset: ph, nucleus: null, coda: [] }];
  const r: Syllable[] = idx.map((vi) => ({ onset: [], nucleus: ph[vi]!, coda: [] }));
  r[0]!.onset = ph.slice(0, idx[0]);
  for (let v = 0; v < idx.length - 1; v++) {
    const a = idx[v]!, b = idx[v + 1]!;
    const cons = ph.slice(a + 1, b);
    let split = cons.length;
    for (let k = 0; k <= cons.length; k++) {
      if (legalOnset(cons.slice(k))) { split = k; break; }
    }
    r[v]!.coda = cons.slice(0, split);
    r[v + 1]!.onset = cons.slice(split);
  }
  r[r.length - 1]!.coda = ph.slice(idx[idx.length - 1]! + 1);
  return r;
}

function mapCluster(arr: string[], okSet: Set<string>): string[] {
  // greedily emit the longest promoted cluster atom legal in this position; singles otherwise
  const out: string[] = [];
  let i = 0;
  while (i < arr.length) {
    let matched = false;
    for (let L = 3; L >= 2; L--) {
      if (i + L <= arr.length) {
        const key = arr.slice(i, i + L).join(" ");
        if (CLUSTER[key] && okSet.has(key)) { out.push(CLUSTER[key]!); i += L; matched = true; break; }
      }
    }
    if (!matched) { out.push(C[arr[i]!] || "?"); i++; }
  }
  return out;
}

type MappedSyl = { onset: string[]; nucleus: string; coda: string[] };

function mapSyl(s: Syllable): MappedSyl {
  // ER is 儿 standing alone as the nucleus — the one glyph covers both onset /r/
  // and the rhotic vowel, so no R is unshifted into the coda.
  const nuc = s.nucleus;
  return { onset: mapCluster([...s.onset], ONSET_OK), nucleus: nuc ? (VOW[nuc] || "?") : "", coda: mapCluster([...s.coda], CODA_OK) };
}

function zipf(w: string): number {
  const v = ZIPF.get(w);
  return v === undefined ? 0 : v / 10;
}
function dictHas(w: string): boolean {
  return DICT.has(w);
}

// Candidate orthographic stems for a written word + a suffix, by English spelling rules.
function orthStems(word: string, suffix: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  if (suffix === "s") {
    if (w.endsWith("s")) {
      out.push(w.slice(0, -1));                 // cats -> cat
      if (w.endsWith("es")) {
        out.push(w.slice(0, -2));               // boxes -> box, kisses -> kiss
        if (w.endsWith("ies")) out.push(w.slice(0, -3) + "y"); // tries -> try
      }
    }
  } else if (suffix === "ed") {
    if (w.endsWith("ed")) {
      out.push(w.slice(0, -2));                 // walked -> walk
      out.push(w.slice(0, -1));                 // baked -> bake (kept -e)
      if (w.endsWith("ied")) out.push(w.slice(0, -3) + "y"); // tried -> try
      const b = w.slice(0, -2);                 // doubled consonant: stopped -> stop
      if (b.length >= 2 && b[b.length - 1] === b[b.length - 2]) out.push(b.slice(0, -1));
    }
  } else if (suffix === "ing") {
    if (w.endsWith("ing")) {
      out.push(w.slice(0, -3));                 // walking -> walk
      out.push(w.slice(0, -3) + "e");           // baking -> bake
      if (w.endsWith("ying")) out.push(w.slice(0, -4) + "ie"); // dying -> die
      const b = w.slice(0, -3);
      if (b.length >= 2 && b[b.length - 1] === b[b.length - 2]) out.push(b.slice(0, -1)); // running -> run
    }
  }
  return out;
}

type Peel = { stemWord: string; glyph: string; tag: string };

// Returns a peel only if the word is genuinely inflected: its written form ends in the
// suffix AND a de-suffixed stem is a real dictionary word at least about as frequent.
function peelInflection(word: string): Peel | null {
  const w = word.toLowerCase();
  const zw = zipf(w);
  // A false peel (kiss->kis, basis->basi) leaves a fragment far rarer than the word.
  // Require stem_zipf >= word_zipf - 0.5; with no frequency signal, fall back to dict check.
  const okStem = (stem: string): boolean => {
    if (stem.length < 2 || !dictHas(stem)) return false;
    if (zw > 0) return zipf(stem) >= zw - 0.5;
    return true;
  };
  const suffixes: [string, string, string][] = [["s", "們", "-s"], ["ed", "了", "-ed"], ["ing", "中", "-ing"]];
  for (const [suffix, glyph, tag] of suffixes) {
    for (const stem of orthStems(w, suffix)) {
      if (okStem(stem)) return { stemWord: stem, glyph, tag };
    }
  }
  return null;
}

// ================= semantic layers (2 & 3) =================
// briefs: whole-word function words
const BRIEF: Record<string, string> = {
  "in": "在", "the": "其", "and": "与", "of": "之", "now": "今", "over": "上",
  "a": "个", "an": "个", "to": "到", "for": "為", "that": "那", "this": "此", "with": "以", "not": "不", "no": "無",
  // nominative pronouns
  "i": "我", "you": "你", "he": "他", "she": "她", "it": "其", "we": "吾", "they": "彼",
  // accusative pronouns — Classical 文言 doesn't case-mark pronouns, so the object
  // form reuses the nominative glyph. ("her" is handled specially; see herBlocks.)
  "me": "我", "him": "他", "us": "吾", "them": "彼",
  "on": "上", "at": "在", "by": "以", "as": "如", "or": "或", "but": "但", "if": "若", "all": "皆", "god": "神",
  // copula -> 是 ; was/being/were handled by AUX paradigm below
  "is": "是", "be": "是", "are": "是", "am": "是", "been": "是",
  // base modals
  "will": "會", "shall": "該", "can": "能", "may": "可", "must": "須",
};

// ===== Sino-compound coinages for learned vocabulary (one clique's conventions; read as English) =====
const SINO: Record<string, string[]> = {
  // ——— primal / elemental words: a mundane, everyday word-magic, so the charged
  //     register is broad. each is the charged single character for the spoken word. ———
  "death": ["死"], "dead": ["死"], "die": ["死"],
  "blood": ["血"], "bloody": ["血"], "bone": ["骨"], "flesh": ["肉"], "heart": ["心"],
  "earth": ["地"], "ground": ["地"], "water": ["水"], "fire": ["火"], "air": ["氣"], "wind": ["風"],
  "sun": ["日"], "moon": ["月"], "star": ["星"], "sky": ["天"], "heaven": ["天"],
  "night": ["夜"], "day": ["日"], "dark": ["冥"], "darkness": ["冥"], "light": ["明"], "sea": ["海"], "rain": ["雨"],
  "mountain": ["山"], "stone": ["石"], "tree": ["木"], "root": ["根"], "seed": ["種"], "beast": ["獸"], "snake": ["蛇"],
  "name": ["名"], "word": ["言"], "soul": ["魂"], "ghost": ["鬼"], "spirit": ["靈"],
  "dream": ["夢"], "birth": ["生"], "born": ["生"], "life": ["生"], "love": ["愛"], "hate": ["憎"],
  "fear": ["懼"], "rage": ["怒"], "king": ["王"], "gold": ["金"], "iron": ["鐵"], "salt": ["鹽"], "milk": ["乳"],

  // ——— the taboo cluster: the primal true name is lost, so every surviving
  //     surface word — euphemism or slang — collapses onto the one charged calque. ———
  "sex": ["媾"], "fuck": ["媾"], "screw": ["媾"],
  "shag": ["媾"], "bang": ["媾"], "copulate": ["媾"], "intercourse": ["媾"], "coitus": ["媾"],

  // ——— esoteric coinages: the post-Renaissance allusive register. a writer who holds
  //     that the term names a real hidden essence calques it; the body is the claim. ———
  "shadow": ["陰"],          // Jung's Schatten — the disowned dark half
  "anima": ["魂"],           // the soul-image; 魂 the ethereal soul
  "archetype": ["原", "型"], // primordial form
  "self": ["真", "我"],      // the Jungian Self, the true centre
  "egregore": ["群", "靈"],  // the spirit of a collective
  "gnosis": ["明"],          // direct knowing / illumination
  "numen": ["靈"],           // indwelling divine presence
  "logos": ["道"],           // the Word / the Way
  "rhizome": ["塊", "莖"],   // Deleuze — the acentred root-mass
  "assemblage": ["配", "置"],// agencement — arrangement of heterogeneous parts
  "becoming": ["化"],        // devenir — transformation as such
  "multiplicity": ["多", "重"],
  "void": ["虛"], "abyss": ["淵"], "eternity": ["永"], "chaos": ["混", "沌"],
};

// ===== auxiliary / copula paradigm (base semantic char + suffix) =====
const AUX: Record<string, string[]> = {
  // possessive pronouns: base pronoun + 的 (genitive particle).
  // NB: "her" is NOT here — it's syncretic with the accusative, so it's disambiguated
  // by context in herBlocks(). "hers" is unambiguously the possessive pronoun.
  "my": ["我", "的"], "mine": ["我", "的"],
  "your": ["你", "的"], "yours": ["你", "的"],
  "his": ["他", "的"],
  "hers": ["她", "的"],
  "its": ["其", "的"],
  "our": ["吾", "的"], "ours": ["吾", "的"],
  "their": ["彼", "的"], "theirs": ["彼", "的"],
  // word -> array of blocks (read aloud as the English word)
  "would": ["會", "了"], "could": ["能", "了"], "should": ["該", "了"], "might": ["可", "了"],
  "was": ["是", "了"],            // copula + past
  "being": ["是", "中"],          // copula + -ing
  "were": ["是", "儿"],           // copula + phonetic -r (irregular, no morpheme)
  "been": ["是", "了"],           // treat as past copula (homograph w/ was; phonetic if must distinguish)
  "had": ["有", "了"], "has": ["有", "們"], "have": ["有"],   // have-paradigm: 有 base
  "did": ["干", "了"], "does": ["干", "們"], "do": ["干"],
  "went": ["去", "了"], "goes": ["去", "們"], "go": ["去"],
};

// "her" disambiguation. It is the one English pronoun whose accusative (object) form and
// possessive determiner are the same surface word. With no parser we use the following
// token: possessive 她的 only when what comes next can begin the possessed noun phrase;
// otherwise the bare accusative 她. Mis-fires on "her" + bare verb ("watched her leave"),
// which genuinely needs parsing — left to the author, per the script's philosophy.
const HER_STOP = new Set([
  // determiners following "her" => "her" is an object, the next noun phrase is separate
  "the", "a", "an", "this", "that", "these", "those", "my", "your", "his", "its", "our", "their", "her", "some", "any", "no",
  // conjunctions / subordinators
  "and", "or", "but", "nor", "so", "yet", "then", "because", "since", "although", "though", "while", "whereas", "as", "than",
  // complementizers / wh-
  "which", "who", "whom", "whose", "when", "where", "why", "how", "whether",
  // prepositions
  "to", "of", "in", "on", "at", "by", "for", "with", "from", "into", "onto", "over", "under", "above", "below", "about",
  "after", "before", "against", "between", "among", "through", "during", "without", "within", "upon", "off", "out", "up", "down", "near", "beside", "beyond",
  // pronouns
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "them", "us",
  // common post-object adverbs (an accusative "her" is often clause-final but for these)
  "too", "also", "again", "here", "there", "now", "just", "even", "still", "away", "back", "alone", "only", "very", "quite",
  "yesterday", "today", "tomorrow", "tonight", "soon", "later", "earlier", "already", "instead", "anyway", "anymore",
  "once", "twice", "perhaps", "maybe", "please", "somewhere", "anywhere", "everywhere", "nowhere",
  // auxiliaries / verbs that can't head a possessed noun
  "will", "would", "can", "could", "shall", "should", "may", "might", "must", "do", "does", "did",
  "is", "are", "was", "were", "has", "have", "had", "not", "never",
]);

function herIsPossessive(rawWord: string, next: string | undefined): boolean {
  // trailing punctuation on "her" itself => clause/sentence boundary => accusative
  if (/[.,;:!?")\]]$/.test(rawWord)) return false;
  if (!next) return false;
  const n = next.toLowerCase().replace(/^[^a-z']+/, "").replace(/[^a-z'].*$/, "");
  if (!n) return false;              // next token is pure punctuation
  return !HER_STOP.has(n);
}

function herBlocks(rawWord: string, next: string | undefined): Block[] {
  const she: Block = { type: "simple", ch: "她", gloss: "her" };
  if (herIsPossessive(rawWord, next)) return [she, { type: "simple", ch: "的", gloss: "·" }];
  return [she];
}

const SUFFIX: [RegExp, string, string][] = [
  // derivational suffixes (inflection -s/-ed/-ing handled by peelInflection)
  [/^(.*)ness$/, "$1", "性"], [/^(.*)less$/, "$1", "無"], [/^(.*)ly$/, "$1", "樣"],
];

// whole-character phonetic borrows (layer 2): pick when syllable closely matches a real MC reading.
const BORROW: Record<string, string> = {
  "B IY": "比", "G IH N": "巾", "EY T": "謁", "AH N": "恩", "F AO M": "凡", "AE M": "庵",
  "T IY": "啼", "D AA K": "鐸", "S IH": "司", "D IY P": "疊", "R IH T": "栗", "AO": "訛", "D AA R K": "鐸",
};
// radicals by word (semantic) — only applied to whole word's first block
const RAD: Record<string, string> = {
  "god": "示", "heaven": "示", "heavens": "示", "spirit": "气", "earth": "土", "deep": "氵", "water": "氵", "waters": "氵",
  "create": "扌", "created": "扌", "dark": "夕", "darkness": "夕", "form": "彡", "formless": "彡", "empty": "穴",
  "hover": "羽", "hovering": "羽", "surface": "面", "begin": "日", "beginning": "日", "light": "日", "day": "日", "night": "夕",
  "sea": "氵", "sky": "天", "fish": "魚", "bird": "鳥", "tree": "木", "fruit": "木", "land": "土",
};

let DICT = new Map<string, string>();
let ZIPF = new Map<string, number>();
let MODE_BRIEF = true, MODE_SINO = true, MODE_RAD = true, SHOWGRID = false, SHOWGLOSS = true;

// ================= load dict =================
function parseTSV(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split("\n")) {
    const t = line.indexOf("\t");
    if (t < 0) continue;
    m.set(line.slice(0, t), line.slice(t + 1));
  }
  return m;
}

async function loadDict(): Promise<void> {
  const dictText = await (await fetch("cmudict.txt")).text();
  DICT = parseTSV(dictText);
  try {
    const zipfText = await (await fetch("zipf.txt")).text();
    ZIPF = new Map([...parseTSV(zipfText)].map(([k, v]) => [k, Number(v)]));
  } catch { ZIPF = new Map(); }
  const status = document.getElementById("status");
  if (status) status.textContent = DICT.size.toLocaleString() + " words loaded · ready";
  run();
}

// ================= transcribe a word =================
type Block =
  | { type: "unknown"; text: string }
  | { type: "simple"; ch: string; gloss: string }
  | { type: "borrow"; rad: string; ph: string; gloss: string }
  | { type: "comp"; rad: string; on: string[]; nu: string; co: string[]; gloss: string };

function transcribeWord(word: string, next?: string): Block[] | null {
  const w = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!w) return null;

  // LAYER 3: brief (whole function word)
  if (MODE_BRIEF) {
    if (w === "her") return herBlocks(word, next);
    const brief = BRIEF[w];
    if (brief) return [{ type: "simple", ch: brief, gloss: w }];
    const aux = AUX[w];
    if (aux) return aux.map((ch, i) => ({ type: "simple", ch, gloss: i === 0 ? w : "·" }));
  }
  if (MODE_SINO) {
    const sino = SINO[w];
    if (sino) return sino.map((ch, i) => ({ type: "simple", ch, gloss: i === 0 ? w : "·" }));
  }

  // LAYER 3b: morphology-aware inflection peel (-s 們, -ed 了, -ing 中) when enabled.
  // Only fires when the de-suffixed stem is itself a real word, so "this"/"bus"/"fast" aren't peeled.
  if (MODE_BRIEF) {
    const peel = peelInflection(w);
    if (peel) {
      const stemBlocks = transcribeWord(peel.stemWord) || [];
      if (stemBlocks.length && stemBlocks[0]!.type !== "unknown") {
        return [...stemBlocks, { type: "simple", ch: peel.glyph, gloss: peel.tag }];
      }
    }
  }

  // LAYER 3c: derivational suffixes (-ness 性, -less 無, -ly 様), dict-validated stem.
  if (MODE_BRIEF) {
    const zw = zipf(w);
    for (const [re, rep, gl] of SUFFIX) {
      const m = w.match(re);
      if (m && m[1] && m[1].length >= 3) {
        const stem = w.replace(re, rep);
        const ok = !!BRIEF[stem] || (dictHas(stem) && (zw === 0 || zipf(stem) >= zw - 0.5));
        if (ok) {
          const stemBlocks = transcribeWord(stem) || [];
          if (stemBlocks.length && stemBlocks[0]!.type !== "unknown")
            return [...stemBlocks, { type: "simple", ch: gl, gloss: "-" + w.slice(stem.length) }];
        }
      }
    }
  }

  const pron = DICT.get(w);
  if (!pron) return [{ type: "unknown", text: word }];
  const sylls = syllabify(pron.split(" "));
  const rad = MODE_RAD ? (RAD[w] || "") : "";
  return sylls.map((s, i): Block => {
    const m = mapSyl(s);
    // LAYER 2: whole-char borrow if this single syllable matches BORROW
    const key = [...s.onset, s.nucleus, ...s.coda].join(" ");
    const borrowGlyph = BORROW[key];
    const radical = i === 0 ? rad : ""; // radical only on first syllable
    if (borrowGlyph) {
      return { type: "borrow", rad: radical, ph: borrowGlyph, gloss: syllGloss(s) };
    }
    return { type: "comp", rad: radical, on: m.onset, nu: m.nucleus, co: m.coda, gloss: syllGloss(s) };
  });
}

function syllGloss(s: Syllable): string {
  return (s.onset.join("") + (s.nucleus || "") + s.coda.join("")).toLowerCase();
}

// ================= render =================
function renderBlock(item: Block): HTMLElement {
  const cell = document.createElement("div"); cell.className = "cell";
  const blk = document.createElement("div"); blk.className = "blk";
  if (SHOWGRID) blk.classList.add("grid");
  if (item.type === "unknown") {
    blk.classList.add("unknown"); blk.textContent = item.text;
  } else if (item.type === "simple") {
    blk.classList.add("simple"); blk.textContent = item.ch;
  } else {
    const wrap = document.createElement("div"); wrap.className = "compose";
    const hasRad = !!item.rad;
    if (hasRad) { const r = document.createElement("div"); r.className = "rad"; r.textContent = item.rad; wrap.appendChild(r); }
    const body = document.createElement("div"); body.className = "body"; if (!hasRad) body.classList.add("full");
    if (item.type === "borrow") {
      body.style.display = "flex"; body.style.alignItems = "center"; body.style.justifyContent = "center";
      const sp = document.createElement("span"); sp.style.fontSize = "40px"; sp.textContent = item.ph; body.appendChild(sp);
    } else {
      const hasOnset = item.on.length > 0, hasCoda = item.co.length > 0;
      body.classList.add(hasCoda ? "coda" : "open");
      const on = document.createElement("div"); on.className = "on"; on.textContent = item.on.join("");
      const nu = document.createElement("div"); nu.className = "nu"; nu.textContent = item.nu;
      if (!hasOnset) nu.classList.add("solo");
      body.appendChild(on); body.appendChild(nu);
      if (hasCoda) {
        const co = document.createElement("div"); co.className = "co";
        item.co.forEach((p) => { const s = document.createElement("span"); s.textContent = p; co.appendChild(s); });
        body.appendChild(co);
      }
    }
    wrap.appendChild(body); blk.appendChild(wrap);
  }
  cell.appendChild(blk);
  const g = document.createElement("div"); g.className = "gloss";
  const gloss = "gloss" in item ? item.gloss : "";
  g.textContent = SHOWGLOSS ? gloss : "";
  cell.appendChild(g);
  return cell;
}

function run(): void {
  const input = document.getElementById("in") as HTMLTextAreaElement | null;
  const out = document.getElementById("out");
  if (!input || !out) return;
  const words = input.value.split(/\s+/).filter(Boolean);
  const allBlocks: Block[] = [];
  words.forEach((w, i) => {
    const bs = transcribeWord(w, words[i + 1]);
    if (bs) bs.forEach((b) => allBlocks.push(b));
  });
  out.replaceChildren();
  // pack into columns of ~12
  let col: HTMLElement | null = null, cnt = 0;
  allBlocks.forEach((b) => {
    if (!col || cnt >= 12) { col = document.createElement("div"); col.className = "col"; out.appendChild(col); cnt = 0; }
    col.appendChild(renderBlock(b)); cnt++;
  });
}

const $ = (id: string) => document.getElementById(id);
const onClick = (id: string, fn: () => void) => { const el = $(id); if (el) el.onclick = fn; };
const onChange = (id: string, fn: (checked: boolean) => void) => {
  const el = $(id) as HTMLInputElement | null;
  if (el) el.onchange = () => fn(el.checked);
};
const setText = (id: string, v: string) => { const el = $(id) as HTMLTextAreaElement | null; if (el) el.value = v; };

onClick("run", run);
onChange("o-brief", (c) => { MODE_BRIEF = c; run(); });
onChange("o-sino", (c) => { MODE_SINO = c; run(); });
onChange("o-rad", (c) => { MODE_RAD = c; run(); });
onChange("o-grid", (c) => { SHOWGRID = c; run(); });
onChange("o-gloss", (c) => { SHOWGLOSS = c; run(); });
onClick("ex1", () => { setText("in", "In the beginning God created the heavens and the earth. Now the earth was formless and empty, darkness was over the surface of the deep, and the Spirit of God was hovering over the waters."); run(); });
onClick("ex2", () => { setText("in", "The quick brown fox jumps over the lazy dog."); run(); });

// legend — built with DOM text nodes (no innerHTML) so the entities stay literal
const legend = $("legend");
if (legend) legend.textContent =
  "onsets p卜 b皮 t丁 d大 k工 g求 f方 v万 θ矢 ð氏 s厶 z夕 ʃ尸 ʒ石 tʃ扎 dʒ乍 h厂 m冖 n乚 ŋ乙 r儿 l力 w云 y丨 · " +
  "nuclei ɪ已 iː夷 ɛ也 æ丫 ə之 ʊ乇 uː于 ɑ五 ɔ幺 ɝ儿 eɪ乁 aɪ歹 oʊ冘 aʊ夬 ɔɪ弔 · codas stack at the foot · " +
  "briefs & borrows applied where available. Unknown words shown in red.";

loadDict();
