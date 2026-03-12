const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');

const WORKER_URL  = 'https://vdo.shreevathsa2k21-4fa.workers.dev';
const ZODIAC_TEXT = process.env.ZODIAC_TEXT;

// ── Detect if text contains CJK (Chinese/Japanese/Korean) characters
function hasCJK(text) {
  return /[\u3000-\u9fff\u4e00-\u9fff\uff00-\uffef\u3400-\u4dbf]/.test(text);
}

async function formatWithWorkerAI(text) {
  console.log('🤖 Calling Worker /format ...');
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
  console.log(`✅ Got ${data.posts.length} posts`);
  return data.posts;
}

function buildHTML(posts, useCJK) {

  // ── Font stack based on language
  // Poppins has ZERO CJK support → boxes appear for Chinese
  // Noto Sans SC covers all Chinese characters perfectly
  const fontFamily = useCJK
    ? "'Noto Sans SC', 'Noto Sans', sans-serif"
    : "'Poppins', sans-serif";

  const fontLink = useCJK
    ? '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet">'
    : '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">';

  // ── Clean title: strip emojis, #, * — keep all text/numbers exactly
  function cleanTitle(t) {
    return (t || '')
      .replace(/^[#\s]+/, '')
      .replace(/\*+/g, '')
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/[\u2600-\u27BF]/g, '')
      .trim();
  }

  // ── Render one line: emoji prefix floated left, text right
  function renderLine(line, bodySize) {
    if (!line || line.trim() === '') return `<div style="height:18px"></div>`;

    const html = line
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/^#+\s*/, '');

    const emojiRe = /^((?:[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF])+\s*)/u;
    const m = html.match(emojiRe);
    if (m) {
      const emoji = m[1];
      const rest  = html.slice(emoji.length);
      return `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:10px;margin-bottom:10px;font-family:${fontFamily}">
        <span style="flex-shrink:0;font-size:${bodySize}px;font-family:'Noto Color Emoji','Segoe UI Emoji',sans-serif">${emoji.trim()}</span>
        <span style="flex:1;text-align:left;font-family:${fontFamily}">${rest}</span>
      </div>`;
    }
    return `<div style="margin-bottom:10px;text-align:left;font-family:${fontFamily}">${html}</div>`;
  }

  // ── Auto-scale font by content length
  function layout(totalChars) {
    if (totalChars < 200)  return { title:80, body:44, titleMB:65, px:88, py:240 };
    if (totalChars < 400)  return { title:68, body:40, titleMB:55, px:88, py:220 };
    if (totalChars < 600)  return { title:58, body:36, titleMB:47, px:88, py:200 };
    if (totalChars < 800)  return { title:50, body:32, titleMB:40, px:88, py:185 };
    if (totalChars < 1000) return { title:44, body:29, titleMB:34, px:88, py:170 };
    return                         { title:38, body:26, titleMB:28, px:88, py:155 };
  }

  const cards = posts.map((post, i) => {
    const title  = cleanTitle(post.title);
    const lines  = post.content || [];
    const total  = title.length + lines.join('').length;
    const s      = layout(total);
    const bodyHTML = lines.map(line => renderLine(line, s.body)).join('');

    return `<div id="p${i}" style="
      width:1080px;height:1920px;
      background:#000;
      padding:${s.py}px ${s.px}px;
      box-sizing:border-box;
      display:flex;flex-direction:column;justify-content:center;
      position:absolute;top:0;left:0;">
      <h1 style="
        font-family:${fontFamily};
        font-size:${s.title}px;font-weight:700;color:#fff;
        line-height:1.2;margin:0 0 ${s.titleMB}px 0;
        text-align:left;word-break:break-word;hyphens:none;">${title}</h1>
      <div style="
        font-family:${fontFamily};
        font-size:${s.body}px;font-weight:400;color:#fff;
        line-height:1.65;text-align:left;">${bodyHTML}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fontLink}
<link href="https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{background:#000;width:1080px}
  strong{font-weight:700}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px">${cards}</div>
</body></html>`;
}

async function render(posts, useCJK) {
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox','--disable-setuid-sandbox',
      '--disable-dev-shm-usage','--disable-gpu',
      '--font-render-hinting=none','--enable-font-antialiasing'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width:1080, height:1920, deviceScaleFactor:2 });

  const html = buildHTML(posts, useCJK);
  await page.setContent(html, { waitUntil: 'networkidle0' });

  // Wait for fonts
  await page.waitForFunction(() => document.fonts.ready.then(() => true));
  await new Promise(r => setTimeout(r, 2000));

  for (let i = 0; i < posts.length; i++) {
    console.log(`📸 [${i+1}/${posts.length}] ${posts[i].title}`);

    await page.evaluate((idx, total) => {
      for (let j = 0; j < total; j++) {
        const el = document.getElementById(`p${j}`);
        if (el) el.style.display = j === idx ? 'flex' : 'none';
      }
    }, i, posts.length);

    const safe = (posts[i].title || `post${i}`)
      .substring(0, 40)
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || `post${i}`;

    const el = await page.$(`#p${i}`);
    await el.screenshot({
      path: path.join(outDir, `${String(i+1).padStart(3,'0')}-${safe}.png`),
      type: 'png'
    });
    console.log(`  ✅ saved`);
  }

  await browser.close();
}

(async () => {
  if (!ZODIAC_TEXT) throw new Error('ZODIAC_TEXT not set');
  const posts = await formatWithWorkerAI(ZODIAC_TEXT);
  const useCJK = hasCJK(ZODIAC_TEXT);
  console.log(`\n🌐 Language: ${useCJK ? 'CJK (Noto Sans SC)' : 'Latin (Poppins)'}`);
  console.log(`🎨 Rendering ${posts.length} posts...`);
  await render(posts, useCJK);
  console.log('✅ All done!');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
