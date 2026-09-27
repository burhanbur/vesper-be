export type FileRecord = {
  id: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  extension: string;
  size: bigint;
  checksum: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FileDto = {
  id: string;
  original_name: string;
  mime_type: string;
  extension: string;
  size: number;
  checksum: string;
  created_at: string;
  updated_at: string;
};

export function toFileDto(file: FileRecord): FileDto {
  return {
    id: file.id,
    original_name: file.originalName,
    mime_type: file.mimeType,
    extension: file.extension,
    size: Number(file.size),
    checksum: file.checksum,
    created_at: file.createdAt.toISOString(),
    updated_at: file.updatedAt.toISOString(),
  };
}
