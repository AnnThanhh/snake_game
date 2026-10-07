import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const postgres = randomBytes(24).toString('hex');
const redis = randomBytes(24).toString('hex');
const secret = randomBytes(32).toString('hex');
const config = `# Generated local credentials. Do not commit this file.
POSTGRES_PASSWORD=${postgres}
REDIS_PASSWORD=${redis}
POSTGRES_PORT=54329
REDIS_PORT=16379
DATABASE_URL=postgresql://serpent:${postgres}@127.0.0.1:54329/serpent
REDIS_URL=redis://:${redis}@127.0.0.1:16379
BACKEND_PORT=3001
BACKEND_URL=http://127.0.0.1:3001
GAME_SERVER_SECRET=${secret}
ARENA_CAPACITY=10
`;
try {
  await writeFile(new URL('../.env', import.meta.url), config, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with unique local PostgreSQL, Redis and service credentials.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .env preserved.');
}
