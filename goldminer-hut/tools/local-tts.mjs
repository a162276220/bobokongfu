/* 本机免费 TTS：用 Windows System.Speech（默认中文 Microsoft Huihui）合成 WAV。
   只监听 127.0.0.1，不联网、不需要 Key。启动：node tools/local-tts.mjs */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.LOCAL_TTS_PORT || 8790);
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'local-tts.ps1');
const MAX_CHARS = 1200;
let queue = Promise.resolve();

function cors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function synth(text) {
  const dir = await mkdtemp(join(tmpdir(), 'bubu-tts-'));
  const textFile = join(dir, 'text.txt');
  const outFile = join(dir, 'out.wav');
  try {
    await writeFile(textFile, text, 'utf8');
    await new Promise((resolve, reject) => {
      const p = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
        '-TextFile', textFile, '-OutFile', outFile,
      ], { windowsHide: true });
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d; });
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || ('powershell exit ' + code)));
      });
    });
    return await readFile(outFile);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { ok: true, service: 'local-tts', voice: 'zh-CN' });
    return;
  }
  if (req.method !== 'POST' || !req.url.startsWith('/tts')) {
    json(res, 404, { error: 'not_found' });
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 64 * 1024) req.destroy();
  });
  req.on('end', () => {
    let text = '';
    try { text = String(JSON.parse(body).text || '').trim(); } catch { text = ''; }
    if (!text) { json(res, 400, { error: 'missing_text' }); return; }
    if (text.length > MAX_CHARS) { json(res, 400, { error: 'text_too_long', max: MAX_CHARS }); return; }
    queue = queue
      .then(() => synth(text))
      .then((buf) => {
        cors(res);
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': String(buf.length),
          'cache-control': 'no-store',
        });
        res.end(buf);
      })
      .catch((e) => json(res, 500, { error: 'tts_failed', message: String((e && e.message) || e) }));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('本机语音已启动：http://127.0.0.1:' + PORT);
  console.log('使用 Windows 中文语音（Microsoft Huihui Desktop），合成 WAV；按 Ctrl+C 停止。');
});
