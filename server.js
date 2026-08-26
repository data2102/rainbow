/**
 * VPS / Render / 카페24 노드호스팅 등 일반 서버용 진입점.
 * Vercel에 배포할 경우 이 파일은 사용되지 않습니다 (api/*.js 가 각각 함수로 동작).
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import state from './api/state.js';
import admin from './api/admin.js';
import match from './api/match.js';
import request from './api/request.js';
import data from './api/data.js';
import tournament from './api/tournament.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));

const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: '서버 오류' });
  });
};

app.all('/api/state', wrap(state));
app.all('/api/admin', wrap(admin));
app.all('/api/match', wrap(match));
app.all('/api/request', wrap(request));
app.all('/api/data', wrap(data));
app.all('/api/tournament', wrap(tournament));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LADDER ZONE running on http://localhost:${port}`));
