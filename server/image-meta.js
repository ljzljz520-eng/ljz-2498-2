/**
 * 零依赖 PNG 元数据解析：读取尺寸与平均亮度。
 * 仅支持常见 8-bit PNG（灰度/RGB/调色板/RGBA，含全部 filter 的反预测）。
 * GIF/JPEG/WebP 不在解析范围时返回 null，调用方要求用户显式声明（或按保守策略处理）。
 */
import zlib from 'node:zlib';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function readPngMeta(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.toString('ascii', 1, 4) !== 'PNG') return null;

  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let palette = null;
  let trns = null;

  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    const data = buf.subarray(dataStart, dataStart + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off = dataStart + len + 4; // data + CRC
  }

  if (bitDepth !== 8) return { width, height, avgLuminance: null };

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) return { width, height, avgLuminance: null };

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels; // 8-bit: bytes per pixel
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[pos++];
      const left = x >= bpp ? pixels[rowStart + x - bpp] : 0;
      const up = y > 0 ? pixels[rowStart - stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[rowStart - stride + x - bpp] : 0;
      let recon;
      switch (filter) {
        case 0: recon = cur; break;
        case 1: recon = (cur + left) & 0xff; break;
        case 2: recon = (cur + up) & 0xff; break;
        case 3: recon = (cur + ((left + up) >> 1)) & 0xff; break;
        case 4: recon = (cur + paeth(left, up, upLeft)) & 0xff; break;
        default: return { width, height, avgLuminance: null };
      }
      pixels[rowStart + x] = recon;
    }
  }

  // 采样统计（大图每 8 像素取一个，速度足够）
  let sum = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(width / 100));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * bpp;
      let r, g, b, a = 255;
      if (colorType === 0) { r = g = b = pixels[i]; }
      else if (colorType === 2) { r = pixels[i]; g = pixels[i + 1]; b = pixels[i + 2]; }
      else if (colorType === 3) {
        const idx = pixels[i];
        r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
        if (trns && idx < trns.length) a = trns[idx];
      } else if (colorType === 4) { r = g = b = pixels[i]; a = pixels[i + 1]; }
      else if (colorType === 6) { r = pixels[i]; g = pixels[i + 1]; b = pixels[i + 2]; a = pixels[i + 3]; }
      if (a < 32) continue; // 跳过透明像素
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count += 1;
    }
  }
  const avgLuminance = count > 0 ? sum / count / 255 : null;
  return { width, height, avgLuminance };
}

/** 解析 #rrggbb / rgb() 背景色为亮度 0~1 */
export function colorLuminance(cssColor) {
  if (!cssColor) return null;
  let m = String(cssColor).trim().match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  m = String(cssColor).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
  return null;
}
