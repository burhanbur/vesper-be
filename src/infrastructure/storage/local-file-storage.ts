import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileStorage, StoredObject } from './file-storage.js';

function assertSafeKey(key: string): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.[a-zA-Z0-9]+$/.test(key) || key.includes('..')) {
        throw new Error('Unsafe storage key');
    }
}

export class LocalFileStorage implements FileStorage {
    private readonly rootPath: string;

    constructor(rootPath: string) {
        this.rootPath = path.resolve(rootPath);
    }

    private resolveKey(key: string): string {
        assertSafeKey(key);
        const resolvedPath = path.resolve(this.rootPath, key);
        if (!resolvedPath.startsWith(`${this.rootPath}${path.sep}`)) {
            throw new Error('Storage key escapes the configured root');
        }
        return resolvedPath;
    }

    async put(key: string, body: Buffer): Promise<void> {
        const destination = this.resolveKey(key);
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
        await writeFile(destination, body, { flag: 'wx', mode: 0o640 });
    }

    async get(key: string): Promise<StoredObject> {
        const source = this.resolveKey(key);
        const metadata = await stat(source);
        return { body: createReadStream(source), size: metadata.size };
    }

    async delete(key: string): Promise<void> {
        await rm(this.resolveKey(key), { force: true });
    }
}
