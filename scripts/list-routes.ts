import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { declarations, mounts } from './route-catalog.js';

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const pathFilter = option('--path') ?? '';
const methodFilter = option('--method')?.toUpperCase();
const source = await readFile('src/app.ts', 'utf8');
const routes = declarations(source, 'app');
routes.push(...declarations(await readFile('src/docs/swagger.ts', 'utf8'), 'app'));
for (const mount of mounts(source)) {
  const routerSource = await readFile(resolve('src', mount.module.replace(/\.js$/, '.ts')), 'utf8');
  for (const route of declarations(routerSource, 'router')) {
    routes.push({
      method: route.method,
      path: `${mount.prefix}/${route.path}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/',
    });
  }
}
const filtered = routes
  .filter(
    (route) => route.path.includes(pathFilter) && (!methodFilter || route.method === methodFilter),
  )
  .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
process.stdout.write(
  'Declared source routes (conditional modules included; implicit HEAD/OPTIONS omitted)\n',
);
process.stdout.write(`${'METHOD'.padEnd(9)}PATH\n`);
for (const route of filtered) process.stdout.write(`${route.method.padEnd(9)}${route.path}\n`);
process.stdout.write(`\n${filtered.length} routes\n`);
