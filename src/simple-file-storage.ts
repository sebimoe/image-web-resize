
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Stream } from "node:stream";

export type StorageWriteable = 
  | string
  | NodeJS.ArrayBufferView
  | Iterable<string | NodeJS.ArrayBufferView>
  | AsyncIterable<string | NodeJS.ArrayBufferView>
  | Stream;

export interface StorageBlob {
  read() : Promise<Buffer>;
  readUtf8() : Promise<string>;
  write(data: string | Buffer) : Promise<void>;
  [Symbol.toStringTag]() : string;
}

export class SimpleFileStorageBlob implements StorageBlob {
  constructor(
    public readonly path: string,
  ) {}

  [Symbol.toStringTag](): string {
    return `SimpleFileStorageBlob<${this.path}>`
  }

  async read() {
    return await readFile(this.path, null);
  }

  async readUtf8() {
    return await readFile(this.path, 'utf8');
  }

  async write(data: StorageWriteable) {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true });
    await writeFile(this.path, data, null);
  }
}
