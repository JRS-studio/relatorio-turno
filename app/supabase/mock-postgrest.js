// Simulador local do PostgREST para testar o app sem Supabase. Requer PostgreSQL local com o schema.sql
// aplicado num banco "rt_teste" e a role "anon" criada. Uso: node supabase/mock-postgrest.js (porta 8787)
// e, no app, Ajustes > Servidor: URL http://localhost:8787, chave "chave-teste".
// Mock mínimo do PostgREST: POST /rest/v1/rpc/<fn> -> select public.<fn>(args) no Postgres local.
const http = require('http'), { execFileSync } = require('child_process');
const TIPOS = { codigo: 'text', nome: 'text', turno: 'jsonb', turnos: 'jsonb', occs: 'jsonb', pends: 'jsonb', desde: 'bigint' };
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const m = req.url.match(/^\/rest\/v1\/rpc\/(rt_[a-z_]+)$/);
  if (!m || req.method !== 'POST') { res.writeHead(404, cors); return res.end('{"message":"not found"}'); }
  if (req.headers.apikey !== 'chave-teste') { res.writeHead(401, cors); return res.end('{"message":"Invalid API key"}'); }
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    try {
      const args = body ? JSON.parse(body) : {};
      const tag = '$q' + Math.random().toString(36).slice(2, 8) + '$';
      const lit = (k, v) => { const t = TIPOS[k] || 'text'; return k + ' => ' + (t === 'bigint' ? Number(v) : tag + (t === 'jsonb' ? JSON.stringify(v) : String(v)) + tag + '::' + t); };
      const sql = 'select public.' + m[1] + '(' + Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => lit(k, v)).join(', ') + ')::text';
      const out = execFileSync('psql', ['-At', '-d', 'rt_teste', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(out.trim());
    } catch (e) {
      const msg = String(e.stderr || e.message).split('\n').find(l => /ERROR/.test(l)) || 'erro';
      res.writeHead(400, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(JSON.stringify({ code: 'P0001', message: msg.replace(/^ERROR:\s*/, '') }));
    }
  });
}).listen(8787, () => console.log('mock em 8787'));
