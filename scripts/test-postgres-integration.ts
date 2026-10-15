import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const project = `vesper-it-${randomUUID()}`;
const compose = [
  'compose',
  '--env-file',
  '/dev/null',
  '-f',
  'compose.integration.yml',
  '-p',
  project,
];
function docker(args: string[]): string {
  // Preserve setup diagnostics without printing environment/database credentials.
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

try {
  docker(['info', '--format', '{{.ServerVersion}}']);
  docker([...compose, 'up', '-d', '--wait', 'postgres-integration']);
  const id = docker([...compose, 'ps', '-q', 'postgres-integration']);
  const inspection: unknown = JSON.parse(docker(['inspect', id]));
  if (!Array.isArray(inspection) || inspection.length !== 1) throw new Error('Invalid container');
  const container: unknown = inspection[0];
  if (!container || typeof container !== 'object') throw new Error('Invalid container');
  const config: unknown = Reflect.get(container, 'Config');
  const host: unknown = Reflect.get(container, 'HostConfig');
  if (!config || typeof config !== 'object' || !host || typeof host !== 'object')
    throw new Error('Invalid config');
  const labels: unknown = Reflect.get(config, 'Labels');
  const tmpfs: unknown = Reflect.get(host, 'Tmpfs');
  if (
    !labels ||
    typeof labels !== 'object' ||
    !tmpfs ||
    typeof tmpfs !== 'object' ||
    Reflect.get(labels, 'com.docker.compose.project') !== project ||
    Reflect.get(labels, 'vesper.integration') !== 'ephemeral-postgres' ||
    !Object.hasOwn(tmpfs, '/var/lib/postgresql/data')
  )
    throw new Error('Container isolation check failed');
  const binding = docker([...compose, 'port', 'postgres-integration', '5432']);
  if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Unsafe port binding');
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    VESPER_POSTGRES_INTEGRATION: 'ephemeral-postgres-only',
    VESPER_INTEGRATION_DATABASE_URL: `postgresql://vesper_integration:integration-only-not-a-secret@${binding}/vesper_integration_test`,
  };
  // The database is created only by this fresh, randomly named tmpfs container.
  execFileSync(
    'node_modules/.bin/prisma',
    ['migrate', 'deploy', '--config', 'prisma.integration.config.ts'],
    { env, stdio: 'inherit' },
  );
  execFileSync(
    'node_modules/.bin/vitest',
    ['run', '--no-cache', '--config', 'vitest.integration.config.ts'],
    { env, stdio: 'inherit' },
  );
} catch {
  process.stderr.write(
    'PostgreSQL integration setup/tests failed. Requires a reachable Docker daemon and Compose v2; inspect test output above. No cleanup was executed.\n',
  );
  process.exitCode = 1;
} finally {
  process.stdout.write(
    `Integration project: ${project}. No stop/down/reset/drop/truncate/volume cleanup is performed automatically.\n`,
  );
}
