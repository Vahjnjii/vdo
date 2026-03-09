const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');

const WORKER_URL  = 'https://vdo.shreevathsa2k21-4fa.workers.dev';
const ZODIAC_TEXT = process.env.ZODIAC_TEXT;
const POST_EMOJIS = ["✨","🌟","🌙","💫","🔮","🧿","🔥","💎","🌈","🛸","🪐","⚡","🍀"];

// ── Ask Cloudflare Worker AI to format the text ───────────────────────────────
async function formatWithWorkerAI(text) {
  console.log('🤖 Calling Cloudflare Workers AI via Worker /format ...');

  const res = await fetch(`${WORKER_URL}/format`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Worker /format failed: ${res.status} — ${body}`);
  }

  const data = await res.json();
  if (!data.posts?.length) throw new Error('Worker returned 0 posts');

  console.log(`✅ Got ${data.posts.length} posts from Cloudflare AI`);
  return data.posts;
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

  const posts = await formatWithWorkerAI(ZODIAC_TEXT);

  console.log(`\n🎨 Rendering ${posts.length} posts...`);
  await render(posts);
  console.log('✅ All done!');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
