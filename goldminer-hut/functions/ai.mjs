/* 云端 AI 代理：Key 只存在于 Worker Secret（AI_API_KEY），浏览器拿不到、也不存。
   鉴权与会话层共用 getUserFromRequest，未登录一律 401。
   客户端不能指定上游 base / model —— 否则等于把 Key 借给任意地址。 */

import { getUserFromRequest } from './session.mjs';

const DEFAULT_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_IMAGE_MODEL = 'agnes-image-2.5-flash';
const DEFAULT_VIDEO_MODEL = 'agnes-video-2.5-flash';
const MAX_BODY_BYTES = 128 * 1024;
const MAX_IMAGE_BODY_BYTES = 512 * 1024;
const MAX_IMAGE_REF_BYTES = 400 * 1024;
const MAX_MESSAGES = 40;
const MAX_CHARS = 60000;
const MAX_IMAGE_PROMPT = 2000;
const CHAT_TIMEOUT_MS = 60000;
const MODELS_TIMEOUT_MS = 15000;
const IMAGE_TIMEOUT_MS = 90000;
const VIDEO_TIMEOUT_MS = 30000;
const VIDEO_POLL_TIMEOUT_MS = 20000;
const TTS_MODEL = '@cf/myshell-ai/melotts';
const MAX_TTS_CHARS = 1200;
const TTS_TIMEOUT_MS = 60000;
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
const videoModel = (env) => String(env.AI_VIDEO_MODEL || DEFAULT_VIDEO_MODEL);

function videoPollBase(env) {
  const explicit = String(env.AI_VIDEO_POLL_BASE || '').replace(/\/+$/, '');
  if (explicit) return explicit;
  try { return new URL(baseUrl(env)).origin; } catch { return ''; }
}

function findVideoUrl(data, origin) {
  const seen = new Set();
  const stack = [data];
  const candidates = [];
  while (stack.length) {
    const x = stack.pop();
    if (!x || typeof x !== 'object' || seen.has(x)) continue;
    seen.add(x);
    for (const [key, value] of Object.entries(x)) {
      if (typeof value === 'string' && value) {
        const isHttp = /^https?:\/\//i.test(value);
        const isPath = value.startsWith('/');
        if (isHttp || isPath) {
          const videoKey = /video/i.test(key);
          const videoExt = /\.(mp4|webm|mov)(\?|$)/i.test(value);
          const urlKey = /url|output|result/i.test(key);
          if (videoKey || videoExt) {
            candidates.unshift(isPath ? origin + value : value);
          } else if (urlKey) {
            candidates.push(isPath ? origin + value : value);
          }
        }
      } else if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
  return candidates[0] || '';
}

async function handleVideo(env, request, url) {
  if (request.method === 'POST') {
    const raw = await request.text().catch(() => '');
    if (!raw || raw.length > 64 * 1024) {
      return json({ error: 'invalid_request', message: '请求体为空或过大' }, 400);
    }
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'invalid_request', message: '请求不是合法 JSON' }, 400); }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) return json({ error: 'invalid_request', message: '缺少 prompt' }, 400);
    if (prompt.length > 2000) return json({ error: 'invalid_request', message: 'prompt 过长' }, 400);

    const model = videoModel(env);
    let payload;
    if (/video-v2\.0/i.test(model)) {
      const width = Math.round(clampNumber(body.width, 256, 2048, 720));
      const height = Math.round(clampNumber(body.height, 256, 2048, 1280));
      const numFrames = Math.round(clampNumber(body.num_frames, 49, 241, 121));
      const frameRate = Math.round(clampNumber(body.frame_rate, 12, 30, 24));
      payload = { model, prompt, width, height, num_frames: numFrames, frame_rate: frameRate };
    } else {
      /* 2.5 系列：mode/seconds/size/aspect_ratio；width/height/num_frames 是禁止字段。 */
      const seconds = String(Math.round(clampNumber(body.seconds, 4, 12, 5)));
      const size = String(body.size || '720P').toUpperCase();
      const allowedSizes = /flash/i.test(model) ? ['720P'] : ['720P', '1080P', '1K', '2K'];
      const aspect = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'].includes(body.aspect_ratio) ? body.aspect_ratio : '9:16';
      payload = {
        model,
        prompt,
        mode: 'text',
        seconds,
        size: allowedSizes.includes(size) ? size : '720P',
        aspect_ratio: aspect,
        n: 1,
      };
    }

    try {
      const res = await upstream(env, '/videos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }, VIDEO_TIMEOUT_MS);
      if (!res.ok) {
        const detail = shortDetail(await res.text().catch(() => ''));
        if (res.status === 429) {
          const retryAfter = Math.round(clampNumber(res.headers.get('retry-after'), 30, 300, 60));
          return json({
            error: 'rate_limited',
            message: '视频接口限流，请 ' + retryAfter + ' 秒后再试' + (detail ? '：' + detail : ''),
            retry_after: retryAfter,
          }, 429);
        }
        return json({ error: 'upstream_error', message: '视频接口返回 ' + res.status + (detail ? '：' + detail : '') }, 502);
      }
      const data = await res.json().catch(() => null);
      const id = data && (data.video_id || data.id || (data.data && (data.data.video_id || data.data.id)));
      if (!id) return json({ error: 'empty_response', message: '视频接口没有返回 video_id' }, 502);
      return json({ ok: true, videoId: String(id), status: 'queued', model: videoModel(env) });
    } catch (e) {
      return failure(e);
    }
  }

  const videoId = url.searchParams.get('video_id') || '';
  if (!videoId) return json({ error: 'invalid_request', message: '缺少 video_id' }, 400);
  const pollBase = videoPollBase(env);
  if (!pollBase) return json({ error: 'video_poll_not_configured', message: '视频查询地址未配置' }, 503);
  try {
    const res = await fetch(pollBase + '/agnesapi?video_id=' + encodeURIComponent(videoId)
      + '&model_name=' + encodeURIComponent(videoModel(env)), {
      headers: { authorization: 'Bearer ' + env.AI_API_KEY },
      signal: timeoutSignal(VIDEO_POLL_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = shortDetail(await res.text().catch(() => ''));
      return json({ error: 'upstream_error', message: '视频查询返回 ' + res.status + (detail ? '：' + detail : '') }, 502);
    }
    const data = await res.json().catch(() => null);
    if (!data) return json({ error: 'empty_response', message: '视频查询没有返回内容' }, 502);
    const nested = data.data && typeof data.data === 'object' ? data.data : {};
    const status = String(data.status || nested.status || 'processing').toLowerCase();
    const progress = Math.round(clampNumber(data.progress !== undefined ? data.progress : nested.progress, 0, 100, 0));
    const message = shortDetail(data.message || data.error || nested.message || nested.error || '');
    return json({
      ok: true,
      videoId,
      status,
      progress,
      url: findVideoUrl(data, pollBase),
      message,
    });
  } catch (e) {
    return failure(e);
  }
}

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
    return json({
      ok: true,
      model: modelName(env),
      imageModel: imageModel(env),
      videoModel: videoModel(env),
      ttsModel: TTS_MODEL,
      models: ids,
    });
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
  const ref = typeof body.ref === 'string' ? body.ref : '';
  if (ref) {
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(ref)) {
      return json({ error: 'invalid_request', message: '参考图格式不对' }, 400);
    }
    if (ref.length > MAX_IMAGE_REF_BYTES) {
      return json({ error: 'invalid_request', message: '参考图过大' }, 400);
    }
  }

  const extra = { response_format: 'b64_json' };
  if (ref) extra.image = [ref];

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
        extra_body: extra,
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
    return json({ ok: true, image: { src, model: imageModel(env), ratio, size, ref: !!ref } });
  } catch (e) {
    return failure(e);
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    }, ms);
    promise.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

function decodeAudio(result) {
  if (!result) return null;
  if (result instanceof Response) return result.arrayBuffer().then((b) => new Uint8Array(b));
  if (result instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(result));
  if (result instanceof Uint8Array) return Promise.resolve(result);
  const audio = typeof result === 'object' && result.audio !== undefined ? result.audio : result;
  if (audio instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(audio));
  if (audio instanceof Uint8Array) return Promise.resolve(audio);
  if (typeof audio === 'string' && audio) {
    const b64 = audio.indexOf(',') >= 0 ? audio.slice(audio.indexOf(',') + 1) : audio;
    try {
      return Promise.resolve(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    } catch {
      return null;
    }
  }
  return null;
}

async function handleTTS(env, request) {
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > 32 * 1024) {
    return json({ error: 'invalid_request', message: '请求体为空或过大' }, 400);
  }
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'invalid_request', message: '请求不是合法 JSON' }, 400); }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'invalid_request', message: '缺少 text' }, 400);
  if (text.length > MAX_TTS_CHARS) {
    return json({ error: 'invalid_request', message: '文本过长，最多 ' + MAX_TTS_CHARS + ' 字' }, 400);
  }
  if (!env.AI || typeof env.AI.run !== 'function') {
    return json({ error: 'tts_not_configured', message: '云端语音未配置（缺少 Workers AI 绑定）' }, 503);
  }
  try {
    const result = await withTimeout(
      env.AI.run(TTS_MODEL, { prompt: text, lang: 'zh' }),
      TTS_TIMEOUT_MS,
    );
    const bytes = await decodeAudio(result);
    if (!bytes || !bytes.length) {
      return json({ error: 'empty_response', message: '语音模型没有返回音频' }, 502);
    }
    const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const mime = isWav ? 'audio/wav' : 'audio/mpeg';
    return new Response(bytes, {
      headers: {
        'content-type': mime,
        'content-length': String(bytes.length),
        'cache-control': 'no-store',
        'x-tts-model': TTS_MODEL,
      },
    });
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
      video: enabled,
      videoModel: enabled ? videoModel(env) : '',
      tts: !!(env.AI && typeof env.AI.run === 'function'),
      ttsModel: (env.AI && typeof env.AI.run === 'function') ? TTS_MODEL : '',
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
  if ((request.method === 'GET' || request.method === 'POST') && path === '/api/ai/video') return handleVideo(env, request, url);
  if (request.method === 'POST' && path === '/api/ai/tts') return handleTTS(env, request);
  return json({ error: 'not_found' }, 404);
}
