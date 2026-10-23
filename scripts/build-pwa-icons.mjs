// Builds the installable-app (PWA) icons in public/assets/icons/ from the office seal
// public/assets/bp-besakih.png: the seal stands at the top of a short stair between the two
// halves of a candi bentar (Balinese split gate), drawn in the portal's maroon and gold.
// Run after changing the seal or the drawing below, then rebuild the Cloudflare assets:
//   cd scripts/pwa-icons && pnpm install && cd ../.. && node scripts/build-pwa-icons.mjs
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(new URL('./pwa-icons/package.json', import.meta.url));
const {Resvg} = require('@resvg/resvg-js');
const sharp = require('sharp');

const root = new URL('../', import.meta.url);
const out = new URL('public/assets/icons/', root);
const color = {
  background: '#7b1e34', backgroundCenter: '#8e2a43', backgroundEdge: '#691729',
  gold: '#c49a36', goldDark: '#9b7624', goldLight: '#dcbc66', stone: '#ead9ad', shadow: '#2b0710',
};
const n = value => +value.toFixed(2);

// The seal PNG is 256 px with a baked-in drop shadow; only its disc (radius 111.6 px) is used.
const seal = `data:image/png;base64,${readFileSync(new URL('public/assets/bp-besakih.png', root)).toString('base64')}`;
const SEAL_SIZE = 256, SEAL_RADIUS = 111.6;

// Artwork in a 512-unit design space. The left gate half is drawn with its split (inner) face on
// x = X0 and mirrored for the right half. Tiers run bottom to top: h = height share of the gate,
// w = width share measured outward from the split face.
const GATE_HEIGHT = 372, GATE_WIDTH = 106, BASE_Y = 444, SEAL_R = 116, SEAL_GAP = 8;
const X0 = 256 - SEAL_R - SEAL_GAP, TIER_GAP = 2.6;
const tiers = [
  {h: .048, w: 1.00}, {h: .044, w: .92}, {h: .038, w: .84}, // plinth steps
  {h: .275, w: .76, body: true}, // body with a carved panel
  {h: .036, w: .88, ledge: true}, {h: .030, w: .79}, // cornice
  ...[.72, .60, .49, .39, .30, .22].map((w, i) => ({h: .078 - i * .006, w, head: true})), // stepped head
];
const PLINTH = (tiers[0].h + tiers[1].h + tiers[2].h) * GATE_HEIGHT;
const SEAL_CY = BASE_Y - PLINTH - SEAL_R - 6;

function gateHalf() {
  const parts = [];
  let y = BASE_Y;
  for (const tier of tiers) {
    const h = tier.h * GATE_HEIGHT, w = tier.w * GATE_WIDTH, top = y - h, gap = tier.body ? 0 : TIER_GAP;
    parts.push(`<rect x="${n(X0 - w)}" y="${n(top + gap)}" width="${n(w)}" height="${n(h - gap)}" fill="${color.gold}"/>`);
    if (tier.body) {
      const px = X0 - w + .14 * GATE_WIDTH, pw = .44 * GATE_WIDTH, py = top + .14 * h, ph = .72 * h;
      const mx = px + pw / 2, my = py + ph / 2, d = pw * .28;
      parts.push(`<rect x="${n(px)}" y="${n(py)}" width="${n(pw)}" height="${n(ph)}" fill="${color.goldDark}"/>`);
      parts.push(`<path d="M${n(mx)} ${n(my - d * 1.5)}L${n(mx + d)} ${n(my)}L${n(mx)} ${n(my + d * 1.5)}L${n(mx - d)} ${n(my)}Z" fill="${color.gold}"/>`);
    } else {
      parts.push(`<rect x="${n(X0 - w)}" y="${n(top + gap)}" width="${n(w)}" height="${n(Math.min(2.4, (h - gap) * .3))}" fill="${color.goldLight}"/>`);
    }
    if (tier.head || tier.ledge) { // simbar: the upturned ornament on each outer corner
      const sx = X0 - w, st = top + gap, sw = (tier.ledge ? .18 : .15) * GATE_WIDTH, sh = (tier.ledge ? .06 : .05) * GATE_HEIGHT;
      parts.push(`<path d="M${n(sx + sw)} ${n(st)}L${n(sx)} ${n(st)}Q${n(sx - .015 * GATE_WIDTH)} ${n(st - sh * .55)} ${n(sx - .075 * GATE_WIDTH)} ${n(st - sh)}Q${n(sx + sw * .3)} ${n(st - sh * .6)} ${n(sx + sw)} ${n(st)}Z" fill="${color.gold}"/>`);
    }
    y = top;
  }
  const fw = .2 * GATE_WIDTH, fh = .1 * GATE_HEIGHT; // the split crown ends in a point on the split face
  parts.push(`<path d="M${n(X0 - fw)} ${n(y)}C${n(X0 - fw * 1.25)} ${n(y - fh * .45)} ${n(X0 - fw * .35)} ${n(y - fh * .55)} ${n(X0)} ${n(y - fh)}L${n(X0)} ${n(y)}Z" fill="${color.gold}"/>`);
  parts.push(`<rect x="${n(X0 - .07 * GATE_WIDTH)}" y="${n(y - fh * .45)}" width="${n(.07 * GATE_WIDTH)}" height="${n(BASE_Y - y + fh * .45)}" fill="${color.goldDark}" opacity=".55"/>`);
  return parts.join('');
}

function stairs() {
  const steps = 3, stepHeight = PLINTH / steps, parts = [];
  for (let i = 0; i < steps; i++) {
    const inset = (steps - 1 - i) * 10;
    parts.push(`<rect x="${n(X0 + inset)}" y="${n(BASE_Y - PLINTH + i * stepHeight + TIER_GAP)}" width="${n(2 * (256 - X0 - inset))}" height="${n(stepHeight - TIER_GAP)}" fill="${color.stone}"/>`);
  }
  return parts.join('');
}

function artwork() {
  const gate = gateHalf(), scale = SEAL_R / SEAL_RADIUS;
  return `<g>${gate}</g><g transform="translate(512 0) scale(-1 1)">${gate}</g>${stairs()}`
    + `<circle cx="256" cy="${n(SEAL_CY + 5)}" r="${SEAL_R}" fill="${color.shadow}" opacity=".35" filter="url(#soft)"/>`
    + `<image href="${seal}" x="${n(256 - SEAL_SIZE / 2 * scale)}" y="${n(SEAL_CY - SEAL_SIZE / 2 * scale)}" width="${n(SEAL_SIZE * scale)}" height="${n(SEAL_SIZE * scale)}" clip-path="url(#seal)"/>`;
}

// any: rounded tile for desktops; maskable: full bleed with the art inside the 80 % safe circle
// (Android crops it); apple: full bleed for iOS, which rounds the corners itself.
const variants = {
  any: {scale: .86, tile: true, sizes: [192, 512], file: size => `icon-${size}.png`},
  maskable: {scale: .715, sizes: [192, 512], file: size => `maskable-${size}.png`},
  apple: {scale: .8, sizes: [180], file: () => 'apple-touch-icon.png'},
};
function svg({scale, tile}) {
  const tx = 256 - 256 * scale, ty = 256 - SEAL_CY * scale, scaleSeal = SEAL_R / SEAL_RADIUS;
  const defs = `<defs><radialGradient id="bg" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="${color.backgroundCenter}"/><stop offset="1" stop-color="${color.backgroundEdge}"/></radialGradient>`
    + `<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>`
    + `<clipPath id="seal"><circle cx="256" cy="${n(SEAL_CY)}" r="${n(SEAL_RADIUS * scaleSeal)}"/></clipPath></defs>`;
  const background = tile ? '<rect x="8" y="8" width="496" height="496" rx="108" fill="url(#bg)"/>' : '<rect width="512" height="512" fill="url(#bg)"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}${background}<g transform="translate(${n(tx)} ${n(ty)}) scale(${scale})">${artwork()}</g></svg>`;
}

mkdirSync(out, {recursive: true});
for (const variant of Object.values(variants)) {
  const source = svg(variant);
  for (const size of variant.sizes) {
    // Render at 4x and downscale so the seal's fine lettering stays smooth at small sizes.
    const large = new Resvg(source, {fitTo: {mode: 'width', value: size * 4}}).render().asPng();
    let image = sharp(large).resize(size, size, {kernel: 'lanczos3'});
    if (!variant.tile) image = image.flatten({background: color.background}).removeAlpha();
    writeFileSync(new URL(variant.file(size), out), await image.png({compressionLevel: 9, adaptiveFiltering: true}).toBuffer());
    console.log(`public/assets/icons/${variant.file(size)}`);
  }
}
