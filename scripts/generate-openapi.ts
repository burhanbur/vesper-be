import { mkdir, writeFile } from 'node:fs/promises';
import { openApiDocument } from '../src/docs/openapi.js';

await mkdir('generated', { recursive: true });
await writeFile('generated/openapi.json', `${JSON.stringify(openApiDocument, null, 2)}\n`, 'utf8');
process.stdout.write('Generated generated/openapi.json\n');
