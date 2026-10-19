/* A0 spike：量一次 PBKDF2 在 Workers 上的挂钟预算，判断会不会撞免费版 CPU 上限。
   跑法见 docs/superpowers/plans/2026-10-15-goldminer-cloud-accounts.md 的 Task 1。
   这不是产品代码：结论写进 spec §5.2 之后即可删除。 */
export default {
  async fetch(request) {
    const iters = Number(new URL(request.url).searchParams.get('iters') || 100000);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('spike-password'), 'PBKDF2', false, ['deriveBits']);
    const t0 = performance.now();
    await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, key, 256);
    return Response.json({ iters, ms: Math.round((performance.now() - t0) * 100) / 100 });
  },
};
