import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const publicDir = join(root, 'public');
const source = join(publicDir, 'logo-generated.png');
const logo = join(publicDir, 'logo.png');

mkdirSync(publicDir, { recursive: true });

execFileSync('sips', ['-s', 'format', 'png', source, '--out', logo], { stdio: 'inherit' });

const sizes = [
  ['icon-512.png', 512],
  ['icon-192.png', 192],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
  ['favicon-16.png', 16],
];

for (const [name, size] of sizes) {
  execFileSync('sips', ['-z', String(size), String(size), logo, '--out', join(publicDir, name)], {
    stdio: 'inherit',
  });
}

writeFileSync(
  join(publicDir, 'site.webmanifest'),
  JSON.stringify(
    {
      name: '한글 문서 자동 채우기',
      short_name: '문서 자동채우기',
      description: 'HWP/HWPX 양식을 표 데이터로 일괄 채우는 웹 자동화 도구',
      start_url: '/',
      display: 'standalone',
      background_color: '#f8fafc',
      theme_color: '#0f172a',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    null,
    2,
  ),
);

const logoData = readFileSync(logo).toString('base64');
const ogHtml = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 1200px;
        height: 630px;
        background:
          radial-gradient(circle at 82% 18%, rgba(20, 184, 166, 0.20), transparent 30%),
          radial-gradient(circle at 12% 88%, rgba(245, 158, 11, 0.18), transparent 34%),
          linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
        font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
        color: #0f172a;
      }
      .frame {
        position: absolute;
        inset: 52px;
        display: grid;
        grid-template-columns: 1fr 330px;
        gap: 54px;
        align-items: center;
      }
      .eyebrow {
        margin: 0 0 28px;
        color: #0f766e;
        font-size: 34px;
        font-weight: 800;
      }
      h1 {
        margin: 0;
        font-size: 88px;
        line-height: 1.08;
        letter-spacing: 0;
        font-weight: 900;
      }
      .copy {
        margin-top: 30px;
        width: 680px;
        color: #334155;
        font-size: 34px;
        line-height: 1.35;
        font-weight: 650;
      }
      .logo-wrap {
        width: 330px;
        height: 330px;
        border-radius: 74px;
        background: #ffffff;
        display: grid;
        place-items: center;
        box-shadow: 0 34px 90px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.08);
        overflow: hidden;
      }
      .logo-wrap img {
        width: 330px;
        height: 330px;
        object-fit: cover;
        display: block;
      }
      .badge {
        position: absolute;
        left: 0;
        bottom: 0;
        padding: 16px 24px;
        border-radius: 999px;
        background: #0f172a;
        color: white;
        font-size: 26px;
        font-weight: 800;
      }
    </style>
  </head>
  <body>
    <main class="frame">
      <section>
        <p class="eyebrow">HWP Automation</p>
        <h1>한글 문서<br />자동 채우기</h1>
        <p class="copy">표 데이터를 넣으면 양식을 복제하고 치환 키를 자동으로 채웁니다.</p>
        <div class="badge">$이름 · $소속 · $날짜</div>
      </section>
      <div class="logo-wrap">
        <img src="data:image/png;base64,${logoData}" alt="" />
      </div>
    </main>
  </body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(ogHtml, { waitUntil: 'networkidle' });
await page.screenshot({ path: join(publicDir, 'og-image.png') });
await browser.close();

rmSync(join(publicDir, 'logo-source.png'), { force: true });
