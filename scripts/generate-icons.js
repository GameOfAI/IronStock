#!/usr/bin/env node
/**
 * generate-icons.js
 *
 * IronStock ikon üretim scripti.
 * Kaynak ikonları işleyerek Tauri ve web için gerekli tüm formatları üretir.
 *
 * Kullanım:
 *   node scripts/generate-icons.js <kaynak-dizin>
 *
 * Örnek:
 *   node scripts/generate-icons.js ~/Desktop/ironstock-ss/icons
 *
 * Gereksinim:
 *   npm install --save-dev sharp   (web/package.json'da zaten mevcut)
 *
 * macOS .icns için:
 *   Bu script macOS'ta çalıştırılırsa `iconutil` (Xcode CLI Tools) kullanarak
 *   icon.icns dosyasını otomatik üretir. macOS dışında .icns üretilmez.
 *   macOS Dock ikonunun düzgün görünmesi için icon.icns şarttır.
 *   Alternatif: cd client && npx tauri icon ../path/to/icon-512.png
 *
 * Kaynak dizinde beklenen dosyalar:
 *   icon-512.png        — ana ikon (512x512)
 *   icon-128.png        — 128px versiyon
 *   favicon-32.png      — 32px favicon
 *   icon.svg            — vektör ikon
 *   icon-mono.svg       — mono vektör ikon
 *   logo.svg            — dark mod wordmark logo
 *   logo-light.svg      — light mod wordmark logo
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SRC = process.argv[2]
  ? path.resolve(process.argv[2])
  : (() => { console.error('Kullanım: node scripts/generate-icons.js <kaynak-dizin>'); process.exit(1); })();

const TAURI_ICONS = path.join(ROOT, 'client/src-tauri/icons');
const WEB_PUBLIC  = path.join(ROOT, 'web/public');
const WEB_ASSETS  = path.join(ROOT, 'web/src/assets');

[WEB_PUBLIC, WEB_ASSETS].forEach(d => fs.mkdirSync(d, { recursive: true }));

/** Multi-size ICO builder (PNG data embedded) */
function buildIco(entries) {
  // entries: [{size, buf}]
  let offset = 6 + entries.length * 16;
  const withOffset = entries.map(e => ({ ...e, offset: (offset += 0, offset - (offset = offset + e.buf.length, e.buf.length), offset - e.buf.length) }));
  // recalc properly
  let off = 6 + entries.length * 16;
  const final = entries.map(e => { const o = off; off += e.buf.length; return { ...e, offset: o }; });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(final.length, 4);

  const dirEntries = final.map(e => {
    const eb = Buffer.alloc(16);
    eb.writeUInt8(e.size === 256 ? 0 : e.size, 0);
    eb.writeUInt8(e.size === 256 ? 0 : e.size, 1);
    eb.writeUInt8(0, 2);
    eb.writeUInt8(0, 3);
    eb.writeUInt16LE(1, 4);
    eb.writeUInt16LE(32, 6);
    eb.writeUInt32LE(e.buf.length, 8);
    eb.writeUInt32LE(e.offset, 12);
    return eb;
  });

  return Buffer.concat([header, ...dirEntries, ...final.map(e => e.buf)]);
}

async function run() {
  const src512 = path.join(SRC, 'icon-512.png');
  const src128 = path.join(SRC, 'icon-128.png');
  const src32  = path.join(SRC, 'favicon-32.png');

  // ── Tauri ─────────────────────────────────────────────────────────────────
  await sharp(src32).resize(32,32).png().toFile(path.join(TAURI_ICONS,'32x32.png'));
  console.log('✅ client/src-tauri/icons/32x32.png');

  await sharp(src128).resize(128,128).png().toFile(path.join(TAURI_ICONS,'128x128.png'));
  console.log('✅ client/src-tauri/icons/128x128.png');

  await sharp(src512).resize(256,256).png().toFile(path.join(TAURI_ICONS,'128x128@2x.png'));
  console.log('✅ client/src-tauri/icons/128x128@2x.png');

  await sharp(src512).resize(512,512).png().toFile(path.join(TAURI_ICONS,'icon.png'));
  console.log('✅ client/src-tauri/icons/icon.png');

  const icoEntries = await Promise.all(
    [16,32,48,256].map(async s => ({ size:s, buf: await sharp(src512).resize(s,s).png().toBuffer() }))
  );
  fs.writeFileSync(path.join(TAURI_ICONS,'icon.ico'), buildIco(icoEntries));
  console.log('✅ client/src-tauri/icons/icon.ico (16+32+48+256)');

  // ── macOS .icns (sadece macOS'ta üretilir, iconutil gerekir) ──────────────
  if (process.platform === 'darwin') {
    const iconsetDir = path.join(TAURI_ICONS, 'icon.iconset');
    fs.mkdirSync(iconsetDir, { recursive: true });
    const icnsSizes = [
      { name: 'icon_16x16.png',      size: 16  },
      { name: 'icon_16x16@2x.png',   size: 32  },
      { name: 'icon_32x32.png',      size: 32  },
      { name: 'icon_32x32@2x.png',   size: 64  },
      { name: 'icon_128x128.png',    size: 128 },
      { name: 'icon_128x128@2x.png', size: 256 },
      { name: 'icon_256x256.png',    size: 256 },
      { name: 'icon_256x256@2x.png', size: 512 },
      { name: 'icon_512x512.png',    size: 512 },
      { name: 'icon_512x512@2x.png', size: 1024 },
    ];
    await Promise.all(icnsSizes.map(({ name, size }) =>
      sharp(src512).resize(size, size).png().toFile(path.join(iconsetDir, name))
    ));
    execSync(`iconutil -c icns "${iconsetDir}" --output "${path.join(TAURI_ICONS, 'icon.icns')}"`);
    fs.rmSync(iconsetDir, { recursive: true });
    console.log('✅ client/src-tauri/icons/icon.icns (macOS Dock + App Bundle)');
  } else {
    console.log('⚠️  icon.icns atlandı (sadece macOS\'ta üretilir — iconutil gerekli)');
    console.log('   Mac\'te çalıştır: node scripts/generate-icons.js <kaynak-dizin>');
    console.log('   Veya:            cd client && npx tauri icon path/to/icon-512.png');
  }

  // ── Web public ─────────────────────────────────────────────────────────────
  await sharp(src32).resize(32,32).png().toFile(path.join(WEB_PUBLIC,'favicon-32.png'));
  console.log('✅ web/public/favicon-32.png');

  await sharp(src512).resize(180,180).png().toFile(path.join(WEB_PUBLIC,'apple-touch-icon.png'));
  console.log('✅ web/public/apple-touch-icon.png');

  const ogBg = await sharp({ create:{ width:1200, height:630, channels:4, background:{r:15,g:23,b:42,alpha:1} }})
    .composite([{ input: await sharp(src512).resize(300,300).png().toBuffer(), gravity:'centre' }])
    .png().toBuffer();
  fs.writeFileSync(path.join(WEB_PUBLIC,'og-image.png'), ogBg);
  console.log('✅ web/public/og-image.png (1200x630 OG image)');

  const faviconEntries = await Promise.all(
    [16,32,48].map(async s => ({ size:s, buf: await sharp(src512).resize(s,s).png().toBuffer() }))
  );
  fs.writeFileSync(path.join(WEB_PUBLIC,'favicon.ico'), buildIco(faviconEntries));
  console.log('✅ web/public/favicon.ico (16+32+48)');

  // ── Web assets (SVG) ───────────────────────────────────────────────────────
  for (const f of ['logo.svg','logo-light.svg','icon.svg','icon-mono.svg']) {
    const src = path.join(SRC, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(WEB_ASSETS, f));
      console.log(`✅ web/src/assets/${f}`);
    }
  }
  fs.copyFileSync(path.join(SRC,'icon.svg'), path.join(WEB_PUBLIC,'icon.svg'));
  console.log('✅ web/public/icon.svg');

  console.log('\n🎉 Tüm ikonlar başarıyla oluşturuldu.');
}

run().catch(e => { console.error(e); process.exit(1); });
