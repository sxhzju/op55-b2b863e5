// Frame-by-frame renderer: headless Chrome draws each frame (pure function of the frame
// number), PNGs stream into FFmpeg, then the original voice-over is muxed in from 0s.
//
//   node render.mjs                         -> op55-hd.mp4 (full film)
//   node render.mjs --frames 90-120 --step 3 --out build/frames   -> PNG stills for review
//
// Env: CHROME_PATH (defaults to the macOS Google Chrome location), FFMPEG (defaults to "ffmpeg").
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const AUDIO = join(ROOT, 'original.mp3');
const OUT = resolve(ROOT, args.output || 'op55-hd.mp4');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--disable-lcd-text', '--hide-scrollbars'],
  defaultViewport: { width: 1080, height: 1440, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => { console.error('[page error]', e); process.exit(1); });
await page.goto(pathToFileURL(join(ROOT, 'src/index.html')).href, { waitUntil: 'load' });
await page.evaluate(() => window.ready);
const info = await page.evaluate(() => window.FILM_INFO);

let [f0, f1] = [0, info.TOTAL_FRAMES - 1];
if (args.frames) { const [a, b] = String(args.frames).split('-').map(Number); f0 = a; f1 = Number.isFinite(b) ? b : a; }
const step = Number(args.step || 1);
const canvas = await page.$('#c');

async function grab(f) {
  await page.evaluate((n) => window.renderFrame(n), f);
  return canvas.screenshot({ type: 'png', omitBackground: false });
}

if (args.out) {
  const dir = resolve(ROOT, args.out); mkdirSync(dir, { recursive: true });
  for (let f = f0; f <= f1; f += step) {
    writeFileSync(join(dir, `f${String(f).padStart(4, '0')}.png`), await grab(f));
  }
  console.log(`wrote stills ${f0}-${f1} step ${step} -> ${dir}`);
  await browser.close();
  process.exit(0);
}

if (!existsSync(AUDIO)) { console.error('original.mp3 not found next to render.mjs'); process.exit(1); }
const ff = spawn(FFMPEG, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(info.FPS), '-c:v', 'png', '-i', '-',
  '-i', AUDIO,
  '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
  '-r', String(info.FPS), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'aac', '-b:a', '192k', '-af', 'apad',           // audio starts at 0s, untouched; padded with silence for the hold
  '-t', String(info.TOTAL_FRAMES / info.FPS),
  '-movflags', '+faststart', OUT,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const t0 = Date.now();
for (let f = f0; f <= f1; f++) {
  const buf = await grab(f);
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % 30 === 0) process.stdout.write(`\rframe ${f}/${f1}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log(`\ndone -> ${OUT}`);
