/** DB 테이블 생성: node scripts/setup.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, getPool } from '../api/_lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

await q(sql);
console.log('✅ 테이블 생성 완료');
await getPool().end();
