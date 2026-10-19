/* 生成邀请码的 SQL。本脚本**不连 D1**（沙箱里 wrangler 起不来，真机上也没必要多一个凭据），
   只把 SQL 打出来，由你复制到 wrangler d1 execute 执行。用法见 goldminer-hut/README.md。

     node tools/mint-invite.mjs [个数] [有效天数]
*/

// 去掉 0/o/1/l/i：邀请码是要手打或口述的。
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const LENGTH = 12;

function inviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

const count = Math.max(1, Number(process.argv[2] || 1));
const days = process.argv[3] === undefined ? 30 : Number(process.argv[3]);
const now = new Date();
const expiresAt = Number.isFinite(days) && days > 0
  ? new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
  : null;

const codes = Array.from({ length: count }, inviteCode);
const sql = 'INSERT INTO invites (code, created_by, created_at, expires_at) VALUES '
  + codes.map((c) => `('${c}', NULL, '${now.toISOString()}', ${expiresAt ? `'${expiresAt}'` : 'NULL'})`).join(', ')
  + ';';

console.log(`邀请码 ${count} 个，${expiresAt ? `${expiresAt} 过期` : '永不过期'}：`);
for (const c of codes) console.log('  ' + c);
console.log('\n在能跑 wrangler 的终端里执行（线上）：');
console.log(`  npx wrangler d1 execute goldminer --remote --command "${sql}"`);
console.log('\n本地开发用（--local）：把上面命令的 --remote 换成 --local。');
