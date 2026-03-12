const puppeteer  = require('puppeteer');
const fs         = require('fs');
const path       = require('path');
const { execSync } = require('child_process');

const WORKER_URL  = 'https://vdo.shreevathsa2k21-4fa.workers.dev';
const ZODIAC_TEXT = process.env.ZODIAC_TEXT;
const DURATION    = parseInt(process.env.DURATION || '10', 10); // seconds per video
const FPS         = 24;
const TOTAL_FRAMES = DURATION * FPS;   // 240 frames @ 24fps for 10s

// ── Detect CJK
function hasCJK(text) {
  return /[\u3000-\u9fff\u4e00-\u9fff\uff00-\uffef\u3400-\u4dbf]/.test(text);
}

// ── Call Worker AI to format zodiac text into posts
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

// ── Build HTML for a SINGLE post — identical layout to render.js
function buildPostHTML(post, useCJK) {
  const fontFamily = useCJK
    ? "'Noto Sans SC', 'Noto Sans', sans-serif"
    : "'Poppins', sans-serif";
  const fontLink = useCJK
    ? '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet">'
    : '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">';

  function cleanTitle(t) {
    return (t || '')
      .replace(/^[#\s]+/, '')
      .replace(/\*+/g, '')
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/[\u2600-\u27BF]/g, '')
      .trim();
  }

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

  function layout(totalChars) {
    if (totalChars < 200)  return { title:80, body:44, titleMB:65, px:88, py:240 };
    if (totalChars < 400)  return { title:68, body:40, titleMB:55, px:88, py:220 };
    if (totalChars < 600)  return { title:58, body:36, titleMB:47, px:88, py:200 };
    if (totalChars < 800)  return { title:50, body:32, titleMB:40, px:88, py:185 };
    if (totalChars < 1000) return { title:44, body:29, titleMB:34, px:88, py:170 };
    return                         { title:38, body:26, titleMB:28, px:88, py:155 };
  }

  const title    = cleanTitle(post.title);
  const lines    = post.content || [];
  const total    = title.length + lines.join('').length;
  const s        = layout(total);
  const bodyHTML = lines.map(line => renderLine(line, s.body)).join('');

  // The card is 1080×1920, positioned with translateY for a slow upward pan
  // CSS variable --pan controls the Y offset (set by JS per frame)
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fontLink}
<link href="https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{background:#000;width:1080px;height:1920px;overflow:hidden}
  strong{font-weight:700}
  #card{
    width:1080px;height:1920px;
    background:#000;
    padding:${s.py}px ${s.px}px;
    box-sizing:border-box;
    display:flex;flex-direction:column;justify-content:center;
    will-change:transform;
    transform:translateY(var(--pan,0px));
  }
  :root{--pan:0px}
</style>
</head><body>
<div id="card">
  <h1 style="
    font-family:${fontFamily};
    font-size:${s.title}px;font-weight:700;color:#fff;
    line-height:1.2;margin:0 0 ${s.titleMB}px 0;
    text-align:left;word-break:break-word;hyphens:none;">${title}</h1>
  <div style="
    font-family:${fontFamily};
    font-size:${s.body}px;font-weight:400;color:#fff;
    line-height:1.65;text-align:left;">${bodyHTML}</div>
</div>
</body></html>`;
}

// ── Render one post → one 10s MP4
async function renderPostVideo(page, post, useCJK, postIndex, totalPosts, outDir) {
  const html = buildPostHTML(post, useCJK);

  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.fonts.ready.then(() => true));
  await new Promise(r => setTimeout(r, 1500)); // fonts settle

  const framesDir = path.join(__dirname, `frames_${postIndex}`);
  fs.mkdirSync(framesDir, { recursive: true });

  // Slow upward pan: starts 30px below center, ends 30px above center
  // Frames 0-12: fade in (opacity 0→1)
  // Frames 12 to TOTAL-12: hold + pan
  // Frames TOTAL-12 to TOTAL: fade out (opacity 1→0)
  const FADE = Math.round(FPS * 0.5); // 0.5s fade = 12 frames at 24fps
  const PAN_RANGE = 40; // total px of upward movement over full duration

  console.log(`  📸 Capturing ${TOTAL_FRAMES} frames for post ${postIndex+1}/${totalPosts}...`);

  for (let f = 0; f < TOTAL_FRAMES; f++) {
    const progress = f / (TOTAL_FRAMES - 1); // 0→1

    // Opacity: fade in first FADE frames, fade out last FADE frames
    let opacity = 1;
    if (f < FADE)                    opacity = f / FADE;
    if (f >= TOTAL_FRAMES - FADE)    opacity = (TOTAL_FRAMES - 1 - f) / FADE;
    opacity = Math.max(0, Math.min(1, opacity));

    // Pan: start at +PAN_RANGE/2 px (down), end at -PAN_RANGE/2 px (up)
    const panY = (PAN_RANGE / 2) - progress * PAN_RANGE;

    await page.evaluate((pan, op) => {
      document.documentElement.style.setProperty('--pan', pan + 'px');
      document.body.style.opacity = String(op);
    }, panY, opacity);

    const fname = `frame${String(f).padStart(5, '0')}.png`;
    await page.screenshot({
      path: path.join(framesDir, fname),
      type: 'png',
      clip: { x: 0, y: 0, width: 1080, height: 1920 }
    });

    if ((f + 1) % 24 === 0) console.log(`    🎞  ${f+1}/${TOTAL_FRAMES} frames`);
  }

  // Encode frames → MP4
  const safe = (post.title || `post${postIndex}`)
    .substring(0, 40)
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase() || `post${postIndex}`;

  const outFile = path.join(outDir, `${String(postIndex + 1).padStart(3, '0')}-${safe}.mp4`);

  console.log(`  🎥 Encoding → ${path.basename(outFile)}`);
  const cmd = [
    'ffmpeg -y',
    `-framerate ${FPS}`,
    `-i "${framesDir}/frame%05d.png"`,
    '-c:v libx264',
    '-preset fast',
    '-crf 22',
    '-pix_fmt yuv420p',
    '-movflags +faststart',
    `-t ${DURATION}`,
    // Scale to even dimensions (required by libx264)
    '-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2"',
    `"${outFile}"`
  ].join(' ');

  execSync(cmd, { stdio: 'inherit' });

  // Cleanup frames immediately to save disk space
  fs.rmSync(framesDir, { recursive: true, force: true });

  console.log(`  ✅ Saved: ${path.basename(outFile)}`);
  return outFile;
}

// ── Main
(async () => {
  if (!ZODIAC_TEXT) throw new Error('ZODIAC_TEXT not set');

  const posts  = await formatWithWorkerAI(ZODIAC_TEXT);
  const useCJK = hasCJK(ZODIAC_TEXT);
  console.log(`\n🌐 Language: ${useCJK ? 'CJK (Noto Sans SC)' : 'Latin (Poppins)'}`);
  console.log(`🎬 Rendering ${posts.length} posts → each ${DURATION}s @ ${FPS}fps`);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  // Launch one browser, reuse page for all posts
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
      '--font-render-hinting=none', '--enable-font-antialiasing'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  const videoFiles = [];

  for (let i = 0; i < posts.length; i++) {
    console.log(`\n🎬 Post ${i+1}/${posts.length}: "${posts[i].title?.slice(0, 50)}"`);
    try {
      const outFile = await renderPostVideo(page, posts[i], useCJK, i, posts.length, outDir);
      videoFiles.push(outFile);
    } catch (e) {
      console.error(`  ❌ Post ${i+1} failed: ${e.message}`);
    }
  }

  await browser.close();

  console.log(`\n✅ Done! ${videoFiles.length}/${posts.length} videos saved to output/`);
  videoFiles.forEach(f => console.log(`   📹 ${path.basename(f)}`));

  if (!videoFiles.length) {
    throw new Error('No videos were produced');
  }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
