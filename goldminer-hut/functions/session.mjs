/* 账号、会话与邀请码 —— 只碰账号表（见 schema.mjs 的 accountDdl()），
   不参与 13 张业务表的同步层。

   db 是 D1 绑定（不是 13 表那套 Builder）：这里直接写 SQL，值全部走占位符绑定。
   密码用 PBKDF2-SHA256，迭代数**逐用户**存进 pw_iter —— 调整 PBKDF2_ITERATIONS
   常量不会把既有用户挡在门外（校验时用该用户存的值）。见 spec §5.2。 */

const PBKDF2_ITERATIONS = 100000;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const USERNAME_MAX = 64;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

export const SESSION_COOKIE = 'gm_session';
export { PBKDF2_ITERATIONS, SESSION_TTL_SECONDS };

export class AuthError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

const nowIso = () => new Date().toISOString();
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
const b64url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const sha256Hex = async (text) =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));

async function derive(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' }, key, 256);
  return toHex(new Uint8Array(bits));
}

// 定长比较：不因提前返回而泄漏前缀信息。
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cleanUsername(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || name.length > USERNAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new AuthError('invalid_username', 400);
  }
  return name;
}

function cleanPassword(raw) {
  if (typeof raw !== 'string' || raw.length < PASSWORD_MIN || raw.length > PASSWORD_MAX) {
    throw new AuthError('invalid_password', 400);
  }
  return raw;
}

/* 注册：先校验用户名、再原子认领邀请码、最后建号。
   任何失败路径都不写 users —— 校验全部发生在第一条写语句之前。 */
export async function registerUser(db, { username, password, invite }) {
  const name = cleanUsername(username);
  const pw = cleanPassword(password);
  if (typeof invite !== 'string' || !invite.trim()) throw new AuthError('invite_required', 403);

  const taken = await db.prepare('SELECT id FROM users WHERE username = ?').bind(name).first();
  if (taken) throw new AuthError('username_taken', 409);

  const userId = crypto.randomUUID();
  const at = nowIso();
  // 条件更新是原子的：两个人同时用同一个码，只有一个能拿到 changes = 1。
  const claimed = await db.prepare(
    'UPDATE invites SET used_by = ?, used_at = ? '
    + 'WHERE code = ? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > ?)',
  ).bind(userId, at, invite.trim(), at).run();
  if (!claimed.meta || claimed.meta.changes !== 1) throw new AuthError('invite_invalid', 403);

  try {
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    await db.prepare(
      'INSERT INTO users (id, username, email, pw_hash, pw_salt, pw_iter, nickname, created_at, last_login_at) '
      + 'VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL)',
    ).bind(userId, name, await derive(pw, salt, PBKDF2_ITERATIONS), salt, PBKDF2_ITERATIONS, name, at).run();
  } catch (e) {
    // 认领邀请码是一次性写入：建号失败必须把码还回去，否则这张码就永久作废了。
    // WHERE 带上 used_by 是为了不误伤并发下别人刚认领的那一份。
    try {
      await db.prepare('UPDATE invites SET used_by = NULL, used_at = NULL WHERE code = ? AND used_by = ?')
        .bind(invite.trim(), userId).run();
    } catch (ignored) { /* 回滚失败也不能掩盖原始错误 */ }
    if (String((e && e.message) || '').includes('UNIQUE')) { throw new AuthError('username_taken', 409); }
    throw e;
  }

  return { userId };
}

export async function login(db, { username, password, ua }) {
  const name = typeof username === 'string' ? username.trim() : '';
  const row = name
    ? await db.prepare('SELECT id, pw_hash, pw_salt, pw_iter FROM users WHERE username = ?').bind(name).first()
    : null;

  // 用户不存在也走一次派生：不让响应时间区分「用户不存在」与「密码错」。
  const salt = row ? String(row.pw_salt) : toHex(new Uint8Array(16));
  const iterations = row ? Number(row.pw_iter) || PBKDF2_ITERATIONS : PBKDF2_ITERATIONS;
  const derived = await derive(typeof password === 'string' ? password : '', salt, iterations);
  if (!row || !equal(derived, String(row.pw_hash))) {
    throw new AuthError('invalid_credentials', 401);
  }

  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const at = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), row.id, at, expiresAt, typeof ua === 'string' ? ua.slice(0, 256) : null).run();
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(at, row.id).run();

  return { token, userId: row.id, expiresAt };
}

export async function logout(db, token) {
  if (typeof token !== 'string' || !token) return;
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

/* 先 cookie 再 Bearer：站点用 cookie，file:// 模式用 Bearer（第三方 cookie 会被浏览器拦）。 */
export function tokenFromRequest(request) {
  const auth = request.headers.get('authorization') || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === SESSION_COOKIE) return part.slice(index + 1).trim();
  }
  return null;
}

export async function getUserFromRequest(db, request) {
  const token = tokenFromRequest(request);
  if (!token) return null;
  const row = await db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token)).first();
  if (!row) return null;
  if (String(row.expires_at) <= nowIso()) return null;
  return { user_id: String(row.user_id) };
}

/* secure 默认开：只有本地 http 调试（wrangler dev）才传 false，否则浏览器不会存这个 cookie。 */
export function sessionCookie(token, maxAgeSeconds, { secure = true } = {}) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}