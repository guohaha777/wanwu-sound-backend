/** Keep binary IPC bounded; a whole 90s WAV otherwise becomes many JSON copies. */
export const RESULT_CHUNK_BYTES = 512 * 1024;
export const MAX_RESULT_BYTES = 90 * 48000 * 4 + 44;

export class ResultReceiver {
  private bytes: Uint8Array<ArrayBuffer> | null = null;
  private received = 0;
  accept(total: number, offset: number, chunk: Uint8Array): 'accepted' | 'invalid' | 'conflict' {
    if (
      !Number.isSafeInteger(total) ||
      total < 44 ||
      total > MAX_RESULT_BYTES ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !chunk.length ||
      chunk.length > RESULT_CHUNK_BYTES ||
      offset + chunk.length > total
    )
      return 'invalid';
    if (offset !== this.received || (this.bytes !== null && this.bytes.length !== total))
      return 'conflict';
    this.bytes ??= new Uint8Array(total);
    this.bytes.set(chunk, offset);
    this.received += chunk.length;
    return 'accepted';
  }
  get result(): Uint8Array<ArrayBuffer> | null {
    return this.bytes && this.received === this.bytes.length ? this.bytes : null;
  }
}
