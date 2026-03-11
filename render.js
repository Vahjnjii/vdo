const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');

const WORKER_URL  = 'https://vdo.shreevathsa2k21-4fa.workers.dev';
const ZODIAC_TEXT = process.env.ZODIAC_TEXT;

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
  console.log(`✅ Got ${data.posts.length} posts`);
  return data.posts;
}

function buildHTML(posts) {

  // Clean title: remove emojis, #, * but keep ALL text and numbers exactly
  function cleanTitle(t) {
    return (t || '')
      .replace(/^[#\s]+/, '')
      .replace(/\*+/g, '')
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/[\u2600-\u27BF]/g, '')
      .trim();
  }

  // Render one content line as HTML — emoji + text side by side, no justify
  function renderLine(line) {
    if (!line || line.trim() === '') {
      return `<div style="height:22px"></div>`;
    }
    const html = line
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/^#+\s*/, '');

    // Split emoji prefix from rest of text so they sit side by side cleanly
    const emojiMatch = html.match(/^([\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\uD83C-\uDBFF\uDC00-\uDFFF]+\s*)/u);
    if (emojiMatch) {
      const emoji = emojiMatch[1];
      const rest  = html.slice(emoji.length);
      return `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:10px;margin-bottom:10px">
        <span style="flex-shrink:0;font-size:CSIZE px">${emoji.trim()}</span>
        <span style="flex:1;text-align:left">${rest}</span>
      </div>`;
    }
    return `<div style="margin-bottom:10px;text-align:left">${html}</div>`;
  }

  // Auto scale font based on total character count
  function layout(totalChars) {
    if (totalChars < 200) return { title:88, body:46, titleMB:70, lineMB:14, px:90, py:260 };
    if (totalChars < 400) return { title:76, body:42, titleMB:60, lineMB:12, px:90, py:240 };
    if (totalChars < 600) return { title:64, body:38, titleMB:52, lineMB:11, px:90, py:220 };
    if (totalChars < 800) return { title:56, body:34, titleMB:44, lineMB:10, px:90, py:200 };
    if (totalChars < 1000) return { title:50, body:30, titleMB:38, lineMB:9,  px:90, py:180 };
    return                        { title:44, body:27, titleMB:32, lineMB:8,  px:90, py:160 };
  }

  const cards = posts.map((post, i) => {
    const title   = cleanTitle(post.title);
    const lines   = (post.content || []);
    const total   = title.length + lines.join('').length;
    const s       = layout(total);

    const bodyHTML = lines.map(line => {
      return renderLine(line).replace(/CSIZE/g, s.body);
    }).join('');

    return `
    <div id="p${i}" style="
      width:1080px; height:1920px;
      background:#000;
      padding:${s.py}px ${s.px}px;
      box-sizing:border-box;
      display:flex;
      flex-direction:column;
      justify-content:center;
      position:absolute; top:0; left:0;
    ">
      <h1 style="
        font-family:'Poppins',sans-serif;
        font-size:${s.title}px;
        font-weight:700;
        color:#fff;
        line-height:1.2;
        margin:0 0 ${s.titleMB}px 0;
        text-align:left;
        word-break:break-word;
        hyphens:none;
      ">${title}</h1>

      <div style="
        font-family:'Poppins',sans-serif;
        font-size:${s.body}px;
        font-weight:400;
        color:#fff;
        line-height:1.6;
        text-align:left;
        word-break:normal;
        word-spacing:0;
        letter-spacing:0;
      ">${bodyHTML}</div>
    </div>`;
  }).join('');

  // Load Poppins from Google Fonts
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { background:#000; width:1080px; text-align:left; }
  strong { font-weight:700; }
  div, p, span, h1 { text-align:left !important; word-spacing:normal !important; letter-spacing:normal !important; }
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px">
${cards}
</div>
</body></html>`;
}

async function render(posts) {
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox','--disable-setuid-sandbox',
      '--disable-dev-shm-usage','--disable-gpu',
      '--font-render-hinting=none',
      '--enable-font-antialiasing'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width:1080, height:1920, deviceScaleFactor:2 });

  const html = buildHTML(posts);
  await page.setContent(html, { waitUntil: 'networkidle0' });

  // Wait for Poppins font to load
  await page.waitForFunction(() => document.fonts.ready.then(() => true));
  await new Promise(r => setTimeout(r, 1500));

  for (let i = 0; i < posts.length; i++) {
    console.log(`📸 [${i+1}/${posts.length}] ${posts[i].title}`);

    // Show only this card
    await page.evaluate((idx, total) => {
      for (let j = 0; j < total; j++) {
        const el = document.getElementById(`p${j}`);
        if (el) el.style.display = j === idx ? 'flex' : 'none';
      }
    }, i, posts.length);

    const safe = (posts[i].title || `post${i}`)
      .substring(0, 40)
      .replace(/[^a-zA-Z0-9\s\-]/g, '')
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
  console.log(`\n🎨 Rendering ${posts.length} posts...`);
  await render(posts);
  console.log('✅ All done!');
})().catch(e => { console.error('❌', e.message); process.exit(1); }); 
