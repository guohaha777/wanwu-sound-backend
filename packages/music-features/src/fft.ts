// Magnitude spectrum of one real frame (radix-2, in place). Size must be a power of two.
export function magnitudes(frame: Float32Array, size: number): Float32Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < size; i++) re[i] = frame[i] ?? 0;
  for (let i = 1, j = 0; i < size; i++) {
    // Bit-reversed order.
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < size; start += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = start + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  const out = new Float32Array(size / 2 + 1);
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(re[i]!, im[i]!);
  return out;
}
