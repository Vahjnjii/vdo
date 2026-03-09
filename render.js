const puppeteer  = require('puppeteer');
const { GoogleGenAI } = require('@google/genai');
const fs   = require('fs');
const path = require('path');

const WORKER_URL  = 'https://vdo.shreevathsa2k21-4fa.workers.dev';
const ZODIAC_TEXT = process.env.ZODIAC_TEXT;
const POST_EMOJIS = ["✨","🌟","🌙","💫","🔮","🧿","🔥","💎","🌈","🛸","🪐","⚡","🍀"];

const GEMINI_PROMPT = `You are a zodiac post formatter. Format the input text into structured posts.

STRICT RULES:
1. SEPARATION: Split input into individual posts.
2. TITLE: First line of each post = Title. Remove ALL emojis from title. Keep wording EXACTLY as given.
3. CONTENT:
   - If line mentions 1 or 2 zodiac signs: keep on ONE line, start with emoji, bold the sign names with **. Example: "✨ **Aries**, **Taurus**: Your explanation here."
   - If line mentions 3 or more zodiac signs: split into multiple lines. Line 1: emoji + sign names bolded. Line 2: emoji + explanation. Line 3: empty string "".
4. Every content line MUST start with an emoji. Vary the emojis. Remove all # characters.

Return ONLY a raw JSON object, no markdown, no backticks:
{"posts":[{"title":"string","content":["string"]}]}`;

// ── Ask Worker for a key, excluding already failed indices ────────────────────
async function getKeyFromWorker(failedIndices) {
  const exclude = failedIndices.length ? `?exclude=${failedIndices.join(',')}` : '';
  const res = await fetch(`${WORKER_URL}/gemini-key${exclude}`);
  if (!res.ok) throw new Error(`Worker /gemini-key failed: ${res.status}`);
  return await res.json();
}

// ── Call Gemini using same SDK pattern as working Python code ─────────────────
async function callGemini(apiKey, text) {
  try {
    // Exact same pattern: genai.Client(api_key=...) → client.models.generate_content(...)
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `${GEMINI_PROMPT}\n\nInput text to format:\n${text}`,
    });

    const raw = (response.text || '').replace(/```json|```/g, '').trim();

    if (!raw) return { ok: false, retryable: true, reason: 'empty response' };

    const s      = Math.min(...[raw.indexOf('{'), raw.indexOf('[')].filter(x => x !== -1));
    const e      = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
    if (s === Infinity || e === -1) return { ok: false, retryable: true, reason: 'no JSON in response' };

    const parsed = JSON.parse(raw.substring(s, e + 1));
    const posts  = Array.isArray(parsed) ? parsed : (parsed.posts || []);
    if (!posts.length) return { ok: false, retryable: true, reason: '0 posts parsed' };

    return { ok: true, posts };

  } catch (err) {
    const msg = err.message || '';
    // Quota / rate limit → try next key
    if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429') || msg.includes('quota')) {
      return { ok: false, retryable: true, reason: `Quota: ${msg.slice(0, 80)}` };
    }
    // Invalid key → try next key
    if (msg.includes('API_KEY_INVALID') || msg.includes('403') || msg.includes('401')) {
      return { ok: false, retryable: true, reason: `Auth: ${msg.slice(0, 80)}` };
    }
    // Unknown error → still try next key
    return { ok: false, retryable: true, reason: `Error: ${msg.slice(0, 80)}` };
  }
}

// ── Rotate: ask Worker for key → call Gemini → repeat if failed ───────────────
async function formatWithGemini(text) {
  const failedIndices = [];

  while (true) {
    const keyData = await getKeyFromWorker(failedIndices);

    if (keyData.exhausted) {
      throw new Error(`All keys exhausted after ${failedIndices.length} attempts.`);
    }

    console.log(`  🔑 Key [${keyData.index}] from Worker (${keyData.remaining} remaining)`);

    const result = await callGemini(keyData.key, text);

    if (result.ok) {
      console.log(`  ✅ Key [${keyData.index}] success — ${result.posts.length} posts`);
      return result.posts;
    }

    console.log(`  ⚠️  Key [${keyData.index}] failed: ${result.reason}`);
    failedIndices.push(keyData.index);

    await new Promise(r => setTimeout(r, 500));
  }
}

// ── BUILD HTML ────────────────────────────────────────────────────────────────
function buildHTML(posts) {
  function cleanTitle(t) {
    return (t||'').replace(/[\u2700-\u27BF\uE000-\uF8FF\uD83C-\uD83E][\uDC00-\uDFFF]?/g,'').replace(/[#*]/g,'').trim();
  }
  function cleanContent(lines) {
    return (lines||[]).map(line => {
      if (line==='') return '';
      let c = line.replace(/#/g,'').trim();
      if (!/^(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u.test(c) && c.length>0)
        c = POST_EMOJIS[Math.floor(Math.random()*POST_EMOJIS.length)] + ' ' + c;
      return c;
    });
  }
  function layout(content, title) {
    const cc = content.join('').length + title.length;
    let s = { titleSize:85, contentSize:45, lineHeight:1.4, paddingX:100, paddingY:320, sepSpace:80 };
    if (cc>300) s={...s,titleSize:70,contentSize:40,sepSpace:70,lineHeight:1.35};
    if (cc>500) s={...s,titleSize:60,contentSize:36,sepSpace:60,lineHeight:1.3};
    if (cc>700) s={...s,titleSize:50,contentSize:30,sepSpace:50,lineHeight:1.25};
    if (cc>900) s={...s,titleSize:45,contentSize:26,sepSpace:40,lineHeight:1.2};
    return s;
  }

  const postsHTML = posts.map((post,i) => {
    const title   = cleanTitle(post.title);
    const content = cleanContent(post.content);
    const s       = layout(content, title);
    const lines   = content.map(line => {
      if (line==='') return `<div style="height:20px"></div>`;
      const html = line.replace(/\*\*(.*?)\*\*/g,'<b>$1</b>').replace(/#/g,'');
      return `<div style="width:100%"><p style="font-size:${s.contentSize}px;line-height:${s.lineHeight};color:#fff;font-weight:500;margin:0;text-shadow:0 2px 4px rgba(0,0,0,.6)">${html}</p></div>`;
    }).join('');
    return `<div id="p${i}" style="width:1080px;height:1920px;background:#000;padding:${s.paddingY}px ${s.paddingX}px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;position:absolute;top:0;left:0">
      <h1 style="font-size:${s.titleSize}px;line-height:1.1;color:#fff;font-weight:700;margin:0 0 ${s.sepSpace}px;letter-spacing:-1px;text-shadow:0 4px 10px rgba(0,0,0,.8)">${title}</h1>
      <div style="display:flex;flex-direction:column">${lines}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;width:1080px}
  *{font-family:'Noto Color Emoji','Segoe UI Emoji','Segoe UI',sans-serif}
  </style></head><body>
  <div style="position:relative;width:1080px;height:1920px">${postsHTML}</div>
  </body></html>`;
}

// ── PUPPETEER ─────────────────────────────────────────────────────────────────
async function render(posts) {
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width:1080, height:1920, deviceScaleFactor:2 });
  await page.setContent(buildHTML(posts), { waitUntil:'networkidle0' });
  await page.waitForFunction(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 800));

  for (let i = 0; i < posts.length; i++) {
    console.log(`📸 [${i+1}/${posts.length}] ${posts[i].title}`);
    await page.evaluate((idx, total) => {
      for (let j=0; j<total; j++)
        document.getElementById(`p${j}`).style.display = j===idx ? 'block' : 'none';
    }, i, posts.length);
    const safe = (posts[i].title||`post${i}`).substring(0,30).replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'-').toLowerCase();
    await (await page.$(`#p${i}`)).screenshot({ path: path.join(outDir, `${String(i+1).padStart(2,'0')}-${safe}.png`), type:'png' });
    console.log(`  ✅ saved`);
  }
  await browser.close();
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
(async () => {
  if (!ZODIAC_TEXT) throw new Error('ZODIAC_TEXT not set');

  console.log('🔑 Getting Gemini key from Cloudflare Worker...');
  const posts = await formatWithGemini(ZODIAC_TEXT);
  if (!posts.length) throw new Error('No posts returned');

  console.log(`\n🎨 Rendering ${posts.length} posts...`);
  await render(posts);
  console.log('✅ All done!');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
