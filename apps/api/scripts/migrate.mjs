// Runs pending database migrations (used by the container migration job). Resolves the migration tool wherever npm
// installed it, so the command does not depend on the node_modules layout.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const entry = require.resolve('node-pg-migrate');                 // .../node-pg-migrate/dist/index.js (or similar)
let directory = dirname(entry);
while (!directory.endsWith('node-pg-migrate') && dirname(directory) !== directory) directory = dirname(directory);
const result = spawnSync(process.execPath, [join(directory, 'bin', 'node-pg-migrate.js'), 'up', '-m', 'migrations', '-d', 'DATABASE_URL', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
