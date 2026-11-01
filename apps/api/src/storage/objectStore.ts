import type { UploadIntent, Playback } from '@wanwu-v2/contracts/cloud';
export type ObjectHead = { bytes: number; etag: string; versionId?: string };
export interface ObjectStore {
  key(kind: 'tmp' | 'originals' | 'playback' | 'renders'): string;
  upload(
    key: string,
    mimeType: string,
    checksum: string,
    bytes: number,
  ): Promise<Omit<UploadIntent, 'uploadId'>>;
  head(key: string): Promise<ObjectHead>;
  freeze(temporary: string, final: string, head: ObjectHead): Promise<{ versionId?: string }>;
  download(
    key: string,
    file: string,
    maxBytes: number,
    versionId?: string,
    signal?: AbortSignal,
  ): Promise<void>;
  put(key: string, file: string, mimeType: string): Promise<void>;
  playback(key: string, seconds: number): Promise<Playback>;
  remove(key: string): Promise<void>;
}
