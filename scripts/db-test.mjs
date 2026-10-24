// Uji migrasi database pada PostgreSQL biasa: membuat database baru, memasang stub auth Supabase,
// menjalankan semua migrasi, lalu menguji aturan bisnis inti (penomoran, RBAC, audit trail).
// Pemakaian: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:test
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const ADMIN_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'bsb_ims_test';
const root = new URL('..', import.meta.url).pathname;

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`drop database if exists ${DB} with (force)`);
await admin.query(`create database ${DB}`);
await admin.end();

const url = new URL(ADMIN_URL); url.pathname = '/' + DB;
const dbUrl = url.toString();
const db = new pg.Client({ connectionString: dbUrl });
await db.connect();

await db.query(readFileSync(join(root, 'supabase/tests/supabase-stub.sql'), 'utf8'));
const migDir = join(root, 'supabase/migrations');
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.query(readFileSync(join(migDir, f), 'utf8')); }
  catch (e) { console.error(`Migrasi gagal: ${f}\n${e.message}`); process.exit(1); }
}
console.log('migrasi OK');

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} diharapkan ${JSON.stringify(b)}, didapat ${JSON.stringify(a)}`); };
async function expectError(code, fn) {
  try { await fn(); } catch (e) { if (e.code === code) return; throw new Error(`error ${code} diharapkan, didapat ${e.code}: ${e.message}`); }
  throw new Error(`error ${code} diharapkan, tetapi berhasil`);
}

// Jalankan query sebagai pengguna tertentu (meniru JWT Supabase)
async function as(client, userId, sql, params = []) {
  await client.query('begin');
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await client.query('set local role authenticated');
    const r = await client.query(sql, params);
    await client.query('commit');
    return r;
  } catch (e) { await client.query('rollback'); throw e; }
}

async function createUser(email) {
  const id = randomUUID();
  await db.query(`insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, email, { full_name: email.split('@')[0] }]);
  return id;
}

await db.query(`insert into public.allowed_domains(domain) values ('bsb.co.id')`);
await db.query(`insert into public.allowed_emails(email, initial_role) values ('admin@bsb.co.id', 'SYS_ADMIN'), ('dc@bsb.co.id', 'DOC_CONTROLLER')`);
const adminId = await createUser('admin@bsb.co.id');
const dcId = await createUser('dc@bsb.co.id');
const staffId = await createUser('staff@bsb.co.id');
const outsiderId = await createUser('orang@gmail.com');
await db.query(`insert into public.user_roles(user_id, role_code) values ($1, 'STAFF')`, [staffId]);

console.log('pengguna & akses');
await test('domain diizinkan langsung aktif, akun luar pending', async () => {
  const r = await db.query(`select email, status from public.profiles order by email`);
  const m = Object.fromEntries(r.rows.map(x => [x.email, x.status]));
  eq(m['staff@bsb.co.id'], 'active'); eq(m['orang@gmail.com'], 'pending');
});
await test('allowlist memberi peran awal', async () => {
  const r = await as(db, adminId, `select permission_code from public.my_permissions() where permission_code = 'user.manage'`);
  eq(r.rowCount, 1);
});
await test('akun pending tidak bisa membaca master data', async () => {
  const r = await as(db, outsiderId, `select * from public.departments`);
  eq(r.rowCount, 0);
});
await test('akun pending tetap bisa membaca profilnya sendiri', async () => {
  const r = await as(db, outsiderId, `select status from public.profiles`);
  eq(r.rowCount, 1); eq(r.rows[0].status, 'pending');
});
await test('pengguna aktif membaca 6 departemen dan 10 seksi', async () => {
  eq((await as(db, staffId, `select 1 from public.departments`)).rowCount, 6);
  eq((await as(db, staffId, `select 1 from public.sections`)).rowCount, 10);
});
await test('staff tidak bisa mengubah master data', async () => {
  const r = await as(db, staffId, `update public.departments set name = 'X' where code = 'HSE'`);
  eq(r.rowCount, 0);
});
await test('admin tidak bisa memberi peran untuk dirinya sendiri', async () => {
  await expectError('42501', () => as(db, adminId, `insert into public.user_roles(user_id, role_code) values ($1, 'PJO')`, [adminId]));
});
await test('admin mengaktifkan akun pending dengan peran', async () => {
  await as(db, adminId, `select public.activate_user($1, 'VIEWER', null, 'uji')`, [outsiderId]);
  const r = await db.query(`select status from public.profiles where id = $1`, [outsiderId]);
  eq(r.rows[0].status, 'active');
});

console.log('penomoran');
await test('pratinjau SOP mengikuti pola Document Control v4', async () => {
  const r = await as(db, dcId, `select public.preview_number('SOP', '{"D":"HSE","S":"SFT"}') n`);
  eq(r.rows[0].n, 'SOP-BSB-HSE-SFT-001');
});
await test('parameter wajib yang kosong ditolak', async () => {
  await expectError('22023', () => as(db, dcId, `select public.issue_number('SOP', '{"D":"HSE"}')`));
});
await test('staff tidak berwenang menerbitkan nomor', async () => {
  await expectError('42501', () => as(db, staffId, `select public.issue_number('SRK', '{"D":"HSE"}')`));
});
await test('IK & formulir berurut per dokumen induk', async () => {
  const a = await as(db, dcId, `select (public.issue_number('F', '{"P":"SOP-BSB-HSE-SFT-018"}')).number n`);
  const b = await as(db, dcId, `select (public.issue_number('F', '{"P":"SOP-BSB-HSE-SFT-018"}')).number n`);
  const c = await as(db, dcId, `select (public.issue_number('F', '{"P":"SOP-BSB-PLT-MTC-003"}')).number n`);
  eq(a.rows[0].n, 'F.01/SOP-BSB-HSE-SFT-018'); eq(b.rows[0].n, 'F.02/SOP-BSB-HSE-SFT-018'); eq(c.rows[0].n, 'F.01/SOP-BSB-PLT-MTC-003');
});
await test('nomor tahunan reset per tahun', async () => {
  const a = await as(db, dcId, `select (public.issue_number('SRK', '{"D":"HSE","date":"2026-12-31"}')).number n`);
  const b = await as(db, dcId, `select (public.issue_number('SRK', '{"D":"HSE","date":"2027-01-01"}')).number n`);
  eq(a.rows[0].n, 'SRK-BSB-HSE-2026-0001'); eq(b.rows[0].n, 'SRK-BSB-HSE-2027-0001');
});
await test('idempotency key mengembalikan nomor yang sama', async () => {
  const a = await as(db, dcId, `select (public.issue_number('SRM', '{}', 'klik-1')).number n`);
  const b = await as(db, dcId, `select (public.issue_number('SRM', '{}', 'klik-1')).number n`);
  eq(a.rows[0].n, b.rows[0].n);
  eq((await db.query(`select count(*)::int c from public.registrations where scheme_code = 'SRM'`)).rows[0].c, 1);
});
await test('nomor lama hasil migrasi melanjutkan urutan', async () => {
  await as(db, dcId, `select public.import_legacy_number('SOP', 'SOP-BSB-HSE-SFT-018', '{"D":"HSE","S":"SFT"}', 18)`);
  const r = await as(db, dcId, `select (public.issue_number('SOP', '{"D":"HSE","S":"SFT"}')).number n`);
  eq(r.rows[0].n, 'SOP-BSB-HSE-SFT-019');
});
await test('nomor yang dibatalkan tidak dipakai ulang', async () => {
  const a = await as(db, dcId, `select (public.issue_number('KBJ', '{"D":"HSE"}')).id`);
  await as(db, dcId, `select public.void_number($1, 'salah judul')`, [a.rows[0].id]);
  const b = await as(db, dcId, `select (public.issue_number('KBJ', '{"D":"HSE"}')).number n`);
  eq(b.rows[0].n, 'KBJ-BSB-HSE-002');
});
await test('pola yang sudah dipakai tidak bisa diubah', async () => {
  await expectError('42501', () => as(db, dcId, `update public.numbering_schemes set pattern = 'KBJ-{D}-{N3}' where code = 'KBJ'`));
});
await test('klien tidak bisa menulis counter langsung', async () => {
  await expectError('42501', () => as(db, dcId, `update public.numbering_counters set last_value = 0`));
});
await test('200 permintaan serentak dari 20 koneksi: tanpa duplikat & tanpa lompatan', async () => {
  const pool = new pg.Pool({ connectionString: dbUrl, max: 20 });
  const jobs = Array.from({ length: 200 }, async () => {
    const c = await pool.connect();
    try { return (await as(c, dcId, `select (public.issue_number('REK', '{"D":"PLT","S":"MTC","date":"2026-10-24"}')).seq s`)).rows[0].s; }
    finally { c.release(); }
  });
  const seqs = (await Promise.all(jobs)).sort((a, b) => a - b);
  await pool.end();
  eq(new Set(seqs).size, 200, 'jumlah unik');
  eq(seqs[0], 1); eq(seqs[199], 200);
});
await test('100 klik ulang serentak dengan key sama hanya membuat 1 nomor', async () => {
  const pool = new pg.Pool({ connectionString: dbUrl, max: 20 });
  const jobs = Array.from({ length: 100 }, async () => {
    const c = await pool.connect();
    try {
      for (let i = 0; i < 5; i++) {
        try { return (await as(c, dcId, `select (public.issue_number('IZN', '{"D":"MGT"}', 'kembar')).number n`)).rows[0].n; }
        catch (e) { if (e.code !== '40001' && e.code !== '23505') throw e; }
      }
      throw new Error('retry habis');
    } finally { c.release(); }
  });
  const nums = await Promise.all(jobs);
  await pool.end();
  eq(new Set(nums).size, 1);
  eq((await db.query(`select count(*)::int c from public.registrations where scheme_code = 'IZN'`)).rows[0].c, 1);
});

console.log('audit trail');
await test('setiap penerbitan nomor tercatat', async () => {
  const r = await db.query(`select count(*)::int c from public.audit_logs where action = 'numbering.issue'`);
  if (r.rows[0].c < 200) throw new Error(`hanya ${r.rows[0].c} event`);
});
await test('perubahan master tercatat dengan pelaku', async () => {
  await as(db, adminId, `update public.departments set name = 'Plant & Maintenance' where code = 'PLT'`);
  const r = await db.query(`select actor_id from public.audit_logs where table_name = 'departments' and action = 'UPDATE' order by id desc limit 1`);
  eq(r.rows[0].actor_id, adminId);
});
await test('audit log tidak bisa diubah bahkan oleh pemilik database', async () => {
  await expectError('42501', () => db.query(`update public.audit_logs set action = 'x'`));
  await expectError('42501', () => db.query(`delete from public.audit_logs`));
});
await test('pengguna tanpa audit.read tidak melihat audit log', async () => {
  eq((await as(db, staffId, `select 1 from public.audit_logs`)).rowCount, 0);
});

await db.end();
console.log(`\n${passed} lulus, ${failed} gagal`);
process.exit(failed ? 1 : 0);
