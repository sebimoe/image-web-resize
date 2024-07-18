import type { StorageBlob } from './simple-file-storage';

export type FactoryFunction = (key: string) => Promise<string | null> | string | null;

export interface StringKeyValueStore {
  get(key: string): Promise<string | null | undefined>,
  set(key: string, value: string | null | undefined): Promise<void>,
  getOrCreate(key: string, factory: FactoryFunction): Promise<string | null>,
}

function defer<T>() {
  const defer: Promise<T> & { 
    resolve: (value: T) => void,
    reject: (reason?: any) => void,
  } = new Promise<T>((resolve, reject) => {
    defer.resolve = resolve;
    defer.reject = reject;
  }) as any;
  return defer;
}

// Runtime/dummy store

export class RuntimeStringKeyValueStore implements StringKeyValueStore {
  data: Record<string, Promise<string | null | undefined>> = {};

  async get(key: string): Promise<string | null | undefined> {
    return await this.data[key];
  }

  async set(key: string, value: string | null | undefined): Promise<void> {
    if(value === undefined) {
      delete this.data[key];
    }else{
      this.data[key] = Promise.resolve(value);
    }
  }

  async getOrCreate(key: string, factory: FactoryFunction): Promise<string | null> {
    const value = await this.data[key];
    if(value === undefined) {
      const promise = this.data[key] = defer();
      try {
        const value = await factory(key);
        promise.resolve(value);
        return value;
      }catch(e) {
        delete this.data[key];
        promise.resolve(undefined);
        throw e;
      }
    }
    return value;
  }
}


// Storage-based

export type ErrorHandler = (e: Error) => void;
export type UpdateHandler = (key: string, value: string | null | undefined, saveToStorage: () => Promise<void>) => Promise<void>;

export interface StorageStringKeyValueCacheOptions {
  onUpdate?: UpdateHandler,
  onLoadError?: ErrorHandler, 
  onSaveError?: ErrorHandler,
}

export class StorageStringKeyValueStore implements StringKeyValueStore {
  private data: Promise<Map<string, Promise<string | null | undefined>>> | undefined;
  private onUpdate: UpdateHandler;
  private boundSave: () => Promise<void>;
  
  constructor(
    private storageBlob: StorageBlob,
    private options: StorageStringKeyValueCacheOptions = {},
  ) {
    this.onUpdate = options.onUpdate ?? ((_, __, save) => save());
    this.boundSave = this.save.bind(this);
  }

  async getData(forceReload: boolean = false) {
    if(forceReload || !this.data) {
      this.data = (async () => {
        try {
          const json = await this.storageBlob.readUtf8();
          const data = JSON.parse(json);
          if(!data || typeof data !== "object") throw new Error(`'${this.storageBlob}' does not contain a JSON-formatted object.`);
          if(Object.values(data).some(x => typeof x !== 'string')) throw new Error(`Stored data contains non-string values.`);
          return new Map(Object.entries(data).map(([k, v]) => [k, Promise.resolve(v)] as const));
        }catch(e) {
          try {
            if(this.options.onLoadError) this.options.onLoadError(e as Error);
            else console.error(`SimpleFileKeyValueCache - load error: ${(e as Error)?.message ?? e}`);
          }catch(e2) {
            console.error(`SimpleFileKeyValueCache - load error: ${(e as Error)?.message ?? e}; also, an error has occured while trying to call onLoadError:`, e2);
          }
          return new Map();
        }
      })(); 
    }
    return await this.data;
  }

  async save() {
    try {
      if(!this.data) throw new Error("Called save() before any data has been loaded or set.");
      const data = await this.data;
      const entries = await Promise.all([...data.entries()].map(async ([k, v]) => [k, await v] as const));
      const json = JSON.stringify(Object.fromEntries(entries.filter(([_, v]) => v !== undefined)));
      await this.storageBlob.write(json);
    }catch(e) {
      if(this.options.onSaveError) this.options.onSaveError(e as Error);
      else console.error(`SimpleFileKeyValueCache - save error: ${(e as Error)?.message ?? e}`);
    }
  }

  async get(key: string): Promise<string | null | undefined> {
    const data = await this.getData();
    const entry = data.get(key);
    if(entry) return await entry;
    else return undefined;
  }

  async set(key: string, value: string | null | undefined): Promise<void> {
    const data = await this.getData();
    if(value === undefined) {
      if(!data.delete(key)) return;
    }else{
      const existing = await data.get(key);
      if(existing === value) return;
      data.set(key, Promise.resolve(value));
    }
    await this.onUpdate(key, value, this.boundSave);
  }

  async getOrCreate(key: string, factory: FactoryFunction): Promise<string | null> {
    const data = await this.getData();
    const existing = await data.get(key);
    if(existing !== undefined) return existing;

    const promise = defer<string | null | undefined>();
    data.set(key, promise);

    try {
      const value = await factory(key);
      promise.resolve(value);
      await this.onUpdate(key, value, this.boundSave);
      return value;
    }catch(e) {
      data.delete(key);
      promise.resolve(undefined);
      throw e;
    }
  }

  boundGetOrCreate() {
    return this.getOrCreate.bind(this);
  }
}
