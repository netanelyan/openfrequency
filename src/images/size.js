// What a stored photograph is, read from its own bytes: its size, and whether it has see-through parts.
//
// A cover photograph smaller than FULL_BLEED_MIN on its shorter side is not stretched over the whole slide: it is
// drawn in a frame over a blurred copy of itself (src/render/html.js). And a PNG with transparency (a fighter cut
// out of the photograph's background) is flattened onto a solid ground (flatten, in safety.js) before the screen
// looks at it and before it is stored, so no slide shows through a see-through photograph.

export const FULL_BLEED_MIN = 1000;

/** { type: 'png'|'jpeg', width, height, alpha } from a PNG's or a JPEG's header, or null. Pure. */
export function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) {
    // IHDR: width, height, bit depth, colour type (4 grey + alpha, 6 RGB + alpha); a tRNS chunk makes any type see-through.
    const colourType = buf[25];
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: colourType === 4 || colourType === 6 || buf.includes(Buffer.from('tRNS')) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // The frame header (SOF0 to SOF15, but not DHT, JPG or DAC) holds the size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), alpha: false };
      i += 2 + len;
    }
  }
  return null;
}

/** Whether a cover photograph fills the slide, or is framed over its own blurred copy. */
export const fillsCover = (buf) => {
  const s = imageSize(buf);
  return !s || Math.min(s.width, s.height) >= FULL_BLEED_MIN;
};
