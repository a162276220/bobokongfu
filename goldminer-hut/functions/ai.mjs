/* 云端 AI 代理：Key 只存在于 Worker Secret（AI_API_KEY），浏览器拿不到、也不存。
   鉴权与会话层共用 getUserFromRequest，未登录一律 401。
   客户端不能指定上游 base / model —— 否则等于把 Key 借给任意地址。 */

import { getUserFromRequest } from './session.mjs';

const DEFAULT_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_IMAGE_MODEL = 'agnes-image-2.5-flash';
const MAX_BODY_BYTES = 128 * 1024;
const MAX_IMAGE_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 40;
const MAX_CHARS = 60000;
const MAX_IMAGE_PROMPT = 2000;
const CHAT_TIMEOUT_MS = 60000;
const MODELS_TIMEOUT_MS = 15000;
const IMAGE_TIMEOUT_MS = 90000;
const IMAGE_RATIOS = new Set(['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9']);
const IMAGE_SIZES = new Set(['1K', '2K', '3K', '4K']);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const baseUrl = (env) => String(env.AI_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
const modelName = (env) => String(env.AI_MODEL || DEFAULT_MODEL);
const imageModel = (env) => String(env.AI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL);

const shortDetail = (text) => String(text || '')
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim()
  .slice(0, 160);

function sanitizeMessages(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = [];
  let chars = 0;
  for (const m of raw.slice(0, MAX_MESSAGES)) {
    if (!m || typeof m !== 'object') return null;
    const role = m.role === 'system' || m.role === 'assistant' ? m.role : (m.role === 'user' ? 'user' : null);
    if (!role || typeof m.content !== 'string') return null;
    chars += m.content.length;
    if (chars > MAX_CHARS) return null;
    out.push({ role, content: m.content });
  }
  return out;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

function upstream(env, path, init, ms) {
  return fetch(baseUrl(env) + path, {
    ...init,
    headers: { ...(init && init.headers), authorization: 'Bearer ' + env.AI_API_KEY },
    signal: timeoutSignal(ms),
  });
}

function failure(e) {
  const name = String((e && e.name) || '');
  if (name === 'TimeoutError' || name === 'AbortError') {
    return json({ error: 'timeout', message: '模型调用超时' }, 504);
  }
  console.error('ai_upstream_failed', (e && e.message) || 'unknown');
  return json({ error: 'network', message: '连不上模型接口' }, 502);
}

async function handleModels(env) {
  try {
    const res = await upstream(env, '/models', { method: 'GET' }, MODELS_TIMEOUT_MS);
    if (!res.ok) {
      const detail = shortDetail(await res.text().catch(() => ''));
      return json({ ok: false, error: 'upstream_error', message: '模型接口返回 ' + res.status + (detail ? '：' + detail : '') }, 502);
    }
    const data = await res.json().catch(() => null);
    const ids = data && Array.isArray(data.data)
      ? data.data.map((x) => x && x.id).filter((id) => typeof id === 'string').slice(0, 50)
      : [];
    return json({ ok: true, model: modelName(env), models: ids });
  } catch (e) {
    return failure(e);
  }
}

async function handleChat(env, request) {
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > MAX_BODY_BYTES) {
    return json({ error: 'invalid_request', message: '请求体为空或过大' }, 400);
  }
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'invalid_request', message: '请求不是合法 JSON' }, 400); }

  const messages = sanitizeMessages(body && body.messages);
  if (!messages) return json({ error: 'invalid_request', message: 'messages 格式不对或过长' }, 400);

  const payload = {
    model: modelName(env),
    messages,
    temperature: clampNumber(body.temperature, 0, 2, 0.8),
  };
  if (body.max_tokens !== undefined) payload.max_tokens = Math.round(clampNumber(body.max_tokens, 64, 8192, 2048));
  if (body.response_format && body.response_format.type === 'json_object') {
    payload.response_format = { type: 'json_object' };
  }

  try {
    const res = await upstream(env, '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, CHAT_TIMEOUT_MS);
    if (!res.ok) {
      const detail = shortDetail(await res.text().catch(() => ''));
      return json({ error: 'upstream_error', message: '模型接口返回 ' + res.status + (detail ? '：' + detail : '') }, 502);
    }
    const data = await res.json().catch(() => null);
    const text = data && data.choices && data.choices[0]
      && data.choices[0].message && data.choices[0].message.content;
    if (!text || !String(text).trim()) {
      return json({ error: 'empty_response', message: '模型没有返回正文' }, 502);
    }
    return json({
      choices: [{ message: { role: 'assistant', content: String(text) } }],
      model: payload.model,
      usage: (data && data.usage) || undefined,
    });
  } catch (e) {
    return failure(e);
  }
}

async function handleImage(env, request) {
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > MAX_IMAGE_BODY_BYTES) {
    return json({ error: 'invalid_request', message: '请求体为空或过大' }, 400);
  }
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'invalid_request', message: '请求不是合法 JSON' }, 400); }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return json({ error: 'invalid_request', message: '缺少 prompt' }, 400);
  if (prompt.length > MAX_IMAGE_PROMPT) {
    return json({ error: 'invalid_request', message: 'prompt 过长' }, 400);
  }
  const ratio = IMAGE_RATIOS.has(body.ratio) ? body.ratio : '1:1';
  const size = IMAGE_SIZES.has(body.size) ? body.size : '1K';

  try {
    const res = await upstream(env, '/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: imageModel(env),
        prompt,
        size,
        ratio,
        return_base64: true,
      }),
    }, IMAGE_TIMEOUT_MS);
    if (!res.ok) {
      const detail = shortDetail(await res.text().catch(() => ''));
      return json({ error: 'upstream_error', message: '图片接口返回 ' + res.status + (detail ? '：' + detail : '') }, 502);
    }
    const data = await res.json().catch(() => null);
    const item = (data && data.data && data.data[0])
      || (data && data.images && data.images[0])
      || data;
    const b64 = item && (item.b64_json || item.base64 || item.image_base64);
    const url = item && (item.url || item.image_url);
    let src = '';
    if (typeof b64 === 'string' && b64) {
      if (b64.indexOf('data:') === 0) {
        src = b64;
      } else {
        const mime = b64.startsWith('/9j/') ? 'image/jpeg'
          : (b64.startsWith('UklGR') ? 'image/webp' : 'image/png');
        src = 'data:' + mime + ';base64,' + b64;
      }
    } else if (typeof url === 'string' && url) {
      src = url;
    }
    if (!src) return json({ error: 'empty_response', message: '图片接口没有返回图片' }, 502);
    return json({ ok: true, image: { src, model: imageModel(env), ratio, size } });
  } catch (e) {
    return failure(e);
  }
}

export async function handleAI({ request, env, url }) {
  const user = await getUserFromRequest(env.DB, request);
  if (!user) return json({ error: 'login_required', message: '请先登录' }, 401);

  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/ai/status') {
    const enabled = !!env.AI_API_KEY;
    return json({
      enabled,
      model: enabled ? modelName(env) : '',
      image: enabled,
      imageModel: enabled ? imageModel(env) : '',
    });
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (!env.AI_API_KEY) {
    return json({ error: 'ai_not_configured', message: '云端还没配置 AI Key' }, 503);
  }
  if (request.method === 'GET' && path === '/api/ai/models') return handleModels(env);
  if (request.method === 'POST' && path === '/api/ai/chat') return handleChat(env, request);
  if (request.method === 'POST' && path === '/api/ai/image') return handleImage(env, request);
  return json({ error: 'not_found' }, 404);
}
