// PWA / home-screen icons, generated at runtime so the repository stays
// text-only (no binary PNG files to store or push).
// Draws a Safari-like compass: blue disc, white ring, red/white needle.
import { deflateSync } from "node:zlib";

// ---- Minimal PNG encoder (RGBA, filter 0) ----
const crcTable = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	return table;
})();

function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++)
		c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type RGBA
	const raw = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0; // filter: none
		rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// ---- Compass drawing ----
function pointInTriangle(px, py, a, b, c) {
	const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
	const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d;
	const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d;
	const w = 1 - u - v;
	return u >= 0 && v >= 0 && w >= 0;
}

function drawCompass(size) {
	const rgba = Buffer.alloc(size * size * 4);
	const cx = size / 2;
	const cy = size / 2;
	const discR = size * 0.46;
	const ringOuter = discR;
	const ringInner = size * 0.415;
	const needleLen = size * 0.34;
	const needleHalfW = size * 0.085;
	// needle points NE (tip) and SW (tail), Safari-style
	const dirx = Math.SQRT1_2;
	const diry = -Math.SQRT1_2;
	const tip = [cx + dirx * needleLen, cy + diry * needleLen];
	const tail = [cx - dirx * needleLen, cy - diry * needleLen];
	const perp = [diry, -dirx];
	const baseR = [cx + perp[0] * needleHalfW, cy + perp[1] * needleHalfW];
	const baseL = [cx - perp[0] * needleHalfW, cy - perp[1] * needleHalfW];

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const i = (y * size + x) * 4;
			// background: vertical blue gradient (full bleed, maskable-safe)
			const t = y / size;
			let r = Math.round(0x1e + (0x0a - 0x1e) * t);
			let g = Math.round(0x6d + (0x84 - 0x6d) * t);
			let b = Math.round(0xd8 + (0xff - 0xd8) * t);

			const dist = Math.hypot(x - cx, y - cy);
			if (dist <= discR) {
				// compass face
				r = 0xf5;
				g = 0xf7;
				b = 0xfa;
				if (dist > ringInner && dist <= ringOuter) {
					// rim of the compass face
					r = 0xc7;
					g = 0xcc;
					b = 0xd4;
				}
				if (pointInTriangle(x, y, tip, baseR, baseL)) {
					r = 0xe8;
					g = 0x2b;
					b = 0x2b; // red needle (NE)
				} else if (pointInTriangle(x, y, tail, baseR, baseL)) {
					r = 0x9a;
					g = 0x9a;
					b = 0xa0; // gray tail (SW)
				}
				if (dist <= size * 0.028) {
					r = 0x33;
					g = 0x33;
					b = 0x36; // center pin
				}
			}
			rgba[i] = r;
			rgba[i + 1] = g;
			rgba[i + 2] = b;
			rgba[i + 3] = 255;
		}
	}
	return encodePNG(size, rgba);
}

const cache = new Map();

export function getIcon(size) {
	if (!cache.has(size)) cache.set(size, drawCompass(size));
	return cache.get(size);
}
