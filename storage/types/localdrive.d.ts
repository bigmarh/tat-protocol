// localdrive.d.ts
declare module 'localdrive' {
    import { Readable, Writable } from 'stream';
  
    interface EntryValue {
      executable?: boolean;
      linkname?: string;
      blob?: boolean;
      metadata?: any;
    }
  
    interface Entry {
      key: string;
      value: EntryValue;
    }
  
    class Localdrive {
      constructor(rootPath: string);
  
      put(path: string, data: Buffer | string): Promise<void>;
      get(path: string): Promise<Buffer | null>;
      entry(path: string): Promise<Entry | null>;
      del(path: string): Promise<void>;
      symlink(linkPath: string, targetPath: string): Promise<void>;
      list(path?: string): AsyncIterable<Entry>;
      createReadStream(path: string): Readable;
      createWriteStream(path: string): Writable;
    }
  
    export default Localdrive;
  }
  