export type StoredObject = {
    body: NodeJS.ReadableStream;
    size: number;
};

export interface FileStorage {
    put(key: string, body: Buffer): Promise<void>;
    get(key: string): Promise<StoredObject>;
    delete(key: string): Promise<void>;
}
