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


console.log('workflow & document control');
const dept = async code => (await db.query(`select id from public.departments where code = $1`, [code])).rows[0].id;
const sect = async (d, code) => (await db.query(`select s.id from public.sections s join public.departments d on d.id = s.department_id where d.code = $1 and s.code = $2`, [d, code])).rows[0].id;
const HSE = await dept('HSE'), PLT = await dept('PLT'), ENV = await sect('HSE', 'ENV'), SFT = await sect('HSE', 'SFT');
const ownerId = await createUser('pemilik@bsb.co.id');
const spvHse = await createUser('spv.hse@bsb.co.id');
const spvPlt = await createUser('spv.plt@bsb.co.id');
const dhHse = await createUser('dh.hse@bsb.co.id');
const pjoId = await createUser('pjo@bsb.co.id');
const actingId = await createUser('pjs.dh@bsb.co.id');
const otherId = await createUser('lain@bsb.co.id');
await db.query(`update public.profiles set department_id = $1 where id = any($2)`, [HSE, [ownerId, spvHse, dhHse, otherId, actingId]]);
await db.query(`insert into public.user_roles(user_id, role_code, department_id) values
  ($1,'STAFF',$6), ($2,'SUPERVISOR',$6), ($3,'SUPERVISOR',$7), ($4,'DEPT_HEAD',$6), ($5,'PJO',null), ($8,'STAFF',$6)`,
  [ownerId, spvHse, spvPlt, dhHse, pjoId, HSE, PLT, actingId]);
let att = 0;
async function upload(userId) {
  att++;
  const sha = (att.toString(16)).padStart(64, 'a');
  const r = await db.query(`insert into public.attachments(storage_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
    values ($1, 'draf.pdf', 'application/pdf', 1000, $2, $3) returning id, sha256`, [`drafts/${userId}/${att}.pdf`, sha, userId]);
  return r.rows[0];
}
const openTask = async ver => (await db.query(`select t.id, t.step_key from public.workflow_tasks t join public.workflow_instances i on i.id = t.instance_id
  where i.subject_id = $1 and t.status = 'open'`, [ver])).rows[0];
const verStatus = async ver => (await db.query(`select status from public.document_versions where id = $1`, [ver])).rows[0].status;
async function runApproval(ver, sha, actors) {
  for (const a of actors) {
    const t = await openTask(ver);
    await as(db, a, `select public.act_on_task($1, 'approve', null, $2)`, [t.id, sha]);
  }
}
let sop, sopVer, sopSha;
await test('pengajuan SOP tanpa seksi ditolak', async () => {
  await expectError('22023', () => as(db, ownerId, `select public.document_request('SOP', $1, 'Prosedur Pengelolaan Limbah B3')`, [HSE]));
});
await test('pengajuan SOP mendapat nomor registrasi, belum nomor resmi', async () => {
  const r = await as(db, ownerId, `select (d).id, (d).registration_no, (d).document_number, (d).current_version_id from public.document_request('SOP', $1, 'Prosedur Pengelolaan Limbah B3', $2) d`, [HSE, ENV]);
  sop = r.rows[0].id; sopVer = r.rows[0].current_version_id;
  if (!/^REG-DOC-\d{4}-\d{6}$/.test(r.rows[0].registration_no)) throw new Error(r.rows[0].registration_no);
  eq(r.rows[0].document_number, null);
});
await test('staff departemen lain tidak bisa mengajukan untuk HSE', async () => {
  await expectError('42501', () => as(db, spvPlt, `select public.document_request('SOP', $1, 'Prosedur Lain Lagi', $2)`, [HSE, ENV]));
});
await test('tidak bisa diajukan tanpa berkas draf', async () => {
  await expectError('22023', () => as(db, ownerId, `select public.document_submit($1)`, [sopVer]));
});
await test('draf diajukan → tugas review untuk Supervisor HSE', async () => {
  const a = await upload(ownerId); sopSha = a.sha256;
  await as(db, ownerId, `select public.document_attach_draft($1, $2)`, [sopVer, a.id]);
  await as(db, ownerId, `select public.document_submit($1)`, [sopVer]);
  eq(await verStatus(sopVer), 'in_review');
  const inbox = await as(db, spvHse, `select * from public.my_tasks()`);
  eq(inbox.rowCount, 1);
  eq((await as(db, spvPlt, `select * from public.my_tasks()`)).rowCount, 0, 'supervisor PLT');
});
await test('draf terkunci setelah diajukan', async () => {
  const a = await upload(ownerId);
  await expectError('22023', () => as(db, ownerId, `select public.document_attach_draft($1, $2)`, [sopVer, a.id]));
});
await test('pemohon tidak bisa memproses pengajuannya sendiri', async () => {
  const t = await openTask(sopVer);
  await expectError('42501', () => as(db, ownerId, `select public.act_on_task($1, 'approve', null, $2)`, [t.id, sopSha]));
});
await test('supervisor departemen lain tidak berwenang', async () => {
  const t = await openTask(sopVer);
  await expectError('42501', () => as(db, spvPlt, `select public.act_on_task($1, 'approve', null, $2)`, [t.id, sopSha]));
});
await test('approval atas isi berbeda (hash) ditolak', async () => {
  const t = await openTask(sopVer);
  await expectError('40001', () => as(db, spvHse, `select public.act_on_task($1, 'approve', null, $2)`, [t.id, 'f'.repeat(64)]));
});
await test('mengembalikan tanpa alasan ditolak', async () => {
  const t = await openTask(sopVer);
  await expectError('22023', () => as(db, spvHse, `select public.act_on_task($1, 'return', '')`, [t.id]));
});
await test('dikembalikan → revisi draf → diajukan ulang', async () => {
  const t = await openTask(sopVer);
  await as(db, spvHse, `select public.act_on_task($1, 'return', 'Lengkapi definisi limbah B3')`, [t.id]);
  eq(await verStatus(sopVer), 'revision_required');
  const a = await upload(ownerId); sopSha = a.sha256;
  await as(db, ownerId, `select public.document_attach_draft($1, $2)`, [sopVer, a.id]);
  await as(db, ownerId, `select public.document_submit($1)`, [sopVer]);
  eq(await verStatus(sopVer), 'in_review');
});
await test('belum disetujui → tidak bisa diterbitkan', async () => {
  const a = await upload(dcId);
  await expectError('22023', () => as(db, dcId, `select public.document_release($1, '2026-10-24', $2)`, [sopVer, a.id]));
});
await test('review → verifikasi DC → approval Dept Head', async () => {
  await runApproval(sopVer, sopSha, [spvHse]);
  eq(await verStatus(sopVer), 'in_review');
  await runApproval(sopVer, sopSha, [dcId]);
  eq(await verStatus(sopVer), 'pending_approval');
  await runApproval(sopVer, sopSha, [dhHse]);
  eq(await verStatus(sopVer), 'approved');
});
await test('selain Document Controller tidak bisa menerbitkan', async () => {
  const a = await upload(dhHse);
  await expectError('42501', () => as(db, dhHse, `select public.document_release($1, '2026-10-24', $2)`, [sopVer, a.id]));
});
let sopNumber;
await test('rilis: nomor resmi SOP terbit, jadwal tinjauan 3 tahun', async () => {
  const pre = await as(db, dcId, `select public.document_reserve_number($1) n`, [sopVer]);
  const pre2 = await as(db, dcId, `select public.document_reserve_number($1) n`, [sopVer]);
  eq(pre.rows[0].n, 'SOP-BSB-HSE-ENV-001'); eq(pre2.rows[0].n, pre.rows[0].n);
  const a = await upload(dcId);
  const r = await as(db, dcId, `select (d).document_number, (d).status, (d).next_review_at::text nr from public.document_release($1, '2026-10-24', $2) d`, [sopVer, a.id]);
  sopNumber = r.rows[0].document_number;
  eq(sopNumber, 'SOP-BSB-HSE-ENV-001'); eq(r.rows[0].status, 'effective'); eq(r.rows[0].nr, '2029-10-24');
});
await test('formulir menginduk ke SOP mendapat nomor F.01/<SOP>', async () => {
  const r = await as(db, ownerId, `select (d).current_version_id v from public.document_request('F', $1, 'Formulir Manifest Limbah B3', null, $2) d`, [HSE, sop]);
  const v = r.rows[0].v, a = await upload(ownerId);
  await as(db, ownerId, `select public.document_attach_draft($1, $2)`, [v, a.id]);
  await as(db, ownerId, `select public.document_submit($1)`, [v]);
  await runApproval(v, a.sha256, [spvHse, dcId, dhHse]);
  const f = await upload(dcId);
  const out = await as(db, dcId, `select (d).document_number n from public.document_release($1, '2026-10-24', $2) d`, [v, f.id]);
  eq(out.rows[0].n, 'F.01/SOP-BSB-HSE-ENV-001');
});
await test('distribusi ke departemen HSE + tanda terima', async () => {
  const n = await as(db, dcId, `select public.document_distribute($1, '{}', array[$2]::uuid[]) n`, [sopVer, HSE]);
  eq(n.rows[0].n, 5);
  await as(db, otherId, `select public.document_acknowledge($1)`, [sopVer]);
  const r = await db.query(`select acknowledged_at from public.document_distributions where version_id = $1 and user_id = $2`, [sopVer, otherId]);
  if (!r.rows[0].acknowledged_at) throw new Error('belum terkonfirmasi');
});
let rev1;
await test('revisi: versi lama tetap berlaku selama revisi diproses', async () => {
  const r = await as(db, ownerId, `select (v).id from public.document_start_revision($1, 'Penyesuaian PP 22/2021') v`, [sop]);
  rev1 = r.rows[0].id;
  const d = await db.query(`select status, effective_version_id from public.documents where id = $1`, [sop]);
  eq(d.rows[0].status, 'under_revision'); eq(d.rows[0].effective_version_id, sopVer);
});
await test('delegasi: Dept Head mendelegasikan approval ke Pjs selama cuti', async () => {
  await as(db, dhHse, `select public.create_delegation($1, 'document.approve', $2, now() + interval '14 days', 'Memo cuti DH HSE')`, [actingId, HSE]);
  const a = await upload(ownerId);
  await as(db, ownerId, `select public.document_attach_draft($1, $2)`, [rev1, a.id]);
  await as(db, ownerId, `select public.document_submit($1)`, [rev1]);
  await runApproval(rev1, a.sha256, [spvHse, dcId]);
  const inbox = await as(db, actingId, `select on_behalf_of from public.my_tasks()`);
  eq(inbox.rows[0].on_behalf_of, dhHse);
  await runApproval(rev1, a.sha256, [actingId]);
  eq(await verStatus(rev1), 'approved');
  const e = await db.query(`select on_behalf_of from public.approval_events where actor_id = $1`, [actingId]);
  eq(e.rows[0].on_behalf_of, dhHse);
});
await test('rilis revisi: Rev.00 superseded, nomor tetap, penerima lama ikut menerima Rev.01', async () => {
  const f = await upload(dcId);
  const r = await as(db, dcId, `select (d).document_number n from public.document_release($1, '2026-11-01', $2) d`, [rev1, f.id]);
  eq(r.rows[0].n, sopNumber);
  eq(await verStatus(sopVer), 'superseded');
  eq((await db.query(`select count(*)::int c from public.document_distributions where version_id = $1`, [rev1])).rows[0].c, 5);
});
await test('verifikasi QR (anon) menunjukkan Rev.00 sudah tidak berlaku', async () => {
  await db.query('begin'); await db.query('set local role anon');
  const r = await db.query(`select * from public.verify_document($1)`, [sopVer]);
  await db.query('commit');
  eq(r.rows[0].version_status, 'superseded'); eq(r.rows[0].latest_revision, 1);
});
await test('anon tidak bisa membaca register dokumen', async () => {
  await db.query('begin'); await db.query('set local role anon');
  try { await db.query(`select * from public.documents`); throw new Error('bisa membaca'); }
  catch (e) { if (e.code !== '42501') throw e; }
  finally { await db.query('rollback'); }
});
await test('rekaman (REK) langsung terdaftar dengan nomor tahunan', async () => {
  const r = await as(db, ownerId, `select (d).document_number n, (d).status from public.document_register_record('REK', $1, 'Laporan Inspeksi Lingkungan Oktober 2026', $2, '2026-10-24') d`, [HSE, SFT]);
  eq(r.rows[0].n, 'REK-BSB-HSE-SFT-2026-0001'); eq(r.rows[0].status, 'effective');
});
await test('SOP wajib lewat approval, tidak bisa diregistrasi langsung', async () => {
  await expectError('22023', () => as(db, ownerId, `select public.document_register_record('SOP', $1, 'Prosedur Tanpa Approval', $2)`, [HSE, SFT]));
});
await test('dokumen terbatas tidak terlihat oleh pengguna lain', async () => {
  await as(db, ownerId, `select public.document_request('KBJ', $1, 'Kebijakan Remunerasi Rahasia', null, null, 'confidential')`, [HSE]);
  eq((await as(db, otherId, `select 1 from public.documents where title = 'Kebijakan Remunerasi Rahasia'`)).rowCount, 0);
  eq((await as(db, ownerId, `select 1 from public.documents where title = 'Kebijakan Remunerasi Rahasia'`)).rowCount, 1);
});
await test('pencabutan dokumen dengan alasan', async () => {
  await expectError('22023', () => as(db, dcId, `select public.document_obsolete($1, '')`, [sop]));
  const r = await as(db, dcId, `select (d).status from public.document_obsolete($1, 'Digabung ke SOP Lingkungan') d`, [sop]);
  eq(r.rows[0].status, 'obsolete');
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
