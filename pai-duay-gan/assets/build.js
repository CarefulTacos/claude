// Renders all brand assets from src/*.html into out/.
// Change LINE ID, website or owner phone in config.json, then: npm install && node build.js
const fs = require('fs'), path = require('path');
const QRCode = require('qrcode');
const { chromium } = require('playwright');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const SRC = path.join(__dirname, 'src'), OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const lineUrl = 'https://line.me/R/ti/p/' + encodeURIComponent(cfg.lineId);

function fill(file) {
  const html = fs.readFileSync(path.join(SRC, file), 'utf8')
    .replaceAll('{{LINE_ID}}', cfg.lineId).replaceAll('{{OWNER_PHONE}}', cfg.ownerPhone).replaceAll('{{WEBSITE}}', cfg.website);
  const tmp = path.join(SRC, '_build_' + file);
  fs.writeFileSync(tmp, html);
  return 'file://' + tmp;
}

(async () => {
  fs.writeFileSync(path.join(OUT, 'qr-line.svg'), await QRCode.toString(lineUrl, { type: 'svg', margin: 1, color: { dark: '#1A2A28', light: '#FFFFFF' } }));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 2600, height: 1800 } });

  await p.goto(fill('social.html')); await p.evaluate(() => document.fonts.ready);
  for (const id of ['p1', 'p2', 'p3', 'p4', 'p6', 'p7']) {
    await p.locator('#' + id).screenshot({ path: path.join(OUT, `ig-${id}.png`) });
  }
  await p.goto(fill('richmenu.html')); await p.evaluate(() => document.fonts.ready);
  await p.locator('#rm').screenshot({ path: path.join(OUT, 'line-richmenu-2500x1686.jpg'), type: 'jpeg', quality: 88 });

  for (const [file, out] of [['flyer.html', 'flyer-a5.pdf'], ['card.html', 'assistant-card.pdf']]) {
    await p.goto(fill(file)); await p.evaluate(() => document.fonts.ready);
    await p.pdf({ path: path.join(OUT, out), preferCSSPageSize: true, printBackground: true });
  }
  // flyer preview PNG
  await p.setViewportSize({ width: 560, height: 800 });
  await p.goto(fill('flyer.html')); await p.evaluate(() => document.fonts.ready);
  await p.locator('.page').screenshot({ path: path.join(OUT, 'flyer-a5-preview.png') });
  await b.close();
  for (const f of fs.readdirSync(SRC)) if (f.startsWith('_build_')) fs.unlinkSync(path.join(SRC, f));
  console.log('done:', fs.readdirSync(OUT).join(', '));
})();
