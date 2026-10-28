import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function findRepoRoot(startDirectory?: string): string {
  let directory = path.resolve(startDirectory ?? path.dirname(fileURLToPath(import.meta.url)));
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(directory, 'database', 'migrations'))) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error('Could not locate the repository root (database/migrations not found)');
}
