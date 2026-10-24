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
  await expectError('42501', async () => as(db, adminId, `insert into public.user_roles(user_id, role_code) values ($1, 'PJO')`, [adminId]));
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
  await expectError('22023', async () => as(db, dcId, `select public.issue_number('SOP', '{"D":"HSE"}')`));
});
await test('staff tidak berwenang menerbitkan nomor', async () => {
  await expectError('42501', async () => as(db, staffId, `select public.issue_number('SRK', '{"D":"HSE"}')`));
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
  await expectError('42501', async () => as(db, dcId, `update public.numbering_schemes set pattern = 'KBJ-{D}-{N3}' where code = 'KBJ'`));
});
await test('klien tidak bisa menulis counter langsung', async () => {
  await expectError('42501', async () => as(db, dcId, `update public.numbering_counters set last_value = 0`));
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
  await expectError('22023', async () => as(db, ownerId, `select public.document_request('SOP', $1, 'Prosedur Pengelolaan Limbah B3')`, [HSE]));
});
await test('pengajuan SOP mendapat nomor registrasi, belum nomor resmi', async () => {
  const r = await as(db, ownerId, `select (d).id, (d).registration_no, (d).document_number, (d).current_version_id from public.document_request('SOP', $1, 'Prosedur Pengelolaan Limbah B3', $2) d`, [HSE, ENV]);
  sop = r.rows[0].id; sopVer = r.rows[0].current_version_id;
  if (!/^REG-DOC-\d{4}-\d{6}$/.test(r.rows[0].registration_no)) throw new Error(r.rows[0].registration_no);
  eq(r.rows[0].document_number, null);
});
await test('staff departemen lain tidak bisa mengajukan untuk HSE', async () => {
  await expectError('42501', async () => as(db, spvPlt, `select public.document_request('SOP', $1, 'Prosedur Lain Lagi', $2)`, [HSE, ENV]));
});
await test('tidak bisa diajukan tanpa berkas draf', async () => {
  await expectError('22023', async () => as(db, ownerId, `select public.document_submit($1)`, [sopVer]));
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
  await expectError('22023', async () => as(db, ownerId, `select public.document_attach_draft($1, $2)`, [sopVer, a.id]));
});
await test('pemohon tidak bisa memproses pengajuannya sendiri', async () => {
  const t = await openTask(sopVer);
  await expectError('42501', async () => as(db, ownerId, `select public.act_on_task($1, 'approve', null, $2)`, [t.id, sopSha]));
});
await test('supervisor departemen lain tidak berwenang', async () => {
  const t = await openTask(sopVer);
  await expectError('42501', async () => as(db, spvPlt, `select public.act_on_task($1, 'approve', null, $2)`, [t.id, sopSha]));
});
await test('approval atas isi berbeda (hash) ditolak', async () => {
  const t = await openTask(sopVer);
  await expectError('40001', async () => as(db, spvHse, `select public.act_on_task($1, 'approve', null, $2)`, [t.id, 'f'.repeat(64)]));
});
await test('mengembalikan tanpa alasan ditolak', async () => {
  const t = await openTask(sopVer);
  await expectError('22023', async () => as(db, spvHse, `select public.act_on_task($1, 'return', '')`, [t.id]));
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
  await expectError('22023', async () => as(db, dcId, `select public.document_release($1, '2026-10-24', $2)`, [sopVer, a.id]));
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
  await expectError('42501', async () => as(db, dhHse, `select public.document_release($1, '2026-10-24', $2)`, [sopVer, a.id]));
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
  await expectError('22023', async () => as(db, ownerId, `select public.document_register_record('SOP', $1, 'Prosedur Tanpa Approval', $2)`, [HSE, SFT]));
});
await test('dokumen terbatas tidak terlihat oleh pengguna lain', async () => {
  await as(db, ownerId, `select public.document_request('KBJ', $1, 'Kebijakan Remunerasi Rahasia', null, null, 'confidential')`, [HSE]);
  eq((await as(db, otherId, `select 1 from public.documents where title = 'Kebijakan Remunerasi Rahasia'`)).rowCount, 0);
  eq((await as(db, ownerId, `select 1 from public.documents where title = 'Kebijakan Remunerasi Rahasia'`)).rowCount, 1);
});
await test('pencabutan dokumen dengan alasan', async () => {
  await expectError('22023', async () => as(db, dcId, `select public.document_obsolete($1, '')`, [sop]));
  const r = await as(db, dcId, `select (d).status from public.document_obsolete($1, 'Digabung ke SOP Lingkungan') d`, [sop]);
  eq(r.rows[0].status, 'obsolete');
});

console.log('SMKP, legal register & CAPA');
const hseMgr = await createUser('hse.mgr@bsb.co.id');
await db.query(`update public.profiles set department_id = $1 where id = $2`, [HSE, hseMgr]);
await db.query(`insert into public.user_roles(user_id, role_code, department_id) values ($1,'HSE_MANAGER',$2)`, [hseMgr, HSE]);
const clause = async code => (await db.query(`select id from public.compliance_clauses where framework_code = 'SMKP' and code = $1`, [code])).rows[0].id;
const C57 = await clause('5.7'), C22 = await clause('2.2'), C23 = await clause('2.3');
const due = n => db.query(`select (app.site_today() + $1::int)::text d`, [n]).then(r => r.rows[0].d);
const capaArgs = async (o = {}) => [o.title ?? 'Pasang rambu batas kecepatan di jalan hauling KM 12', 'Temuan inspeksi: rambu hilang',
  'inspection', o.clause ?? C57, o.risk ?? 'high', HSE, o.pic ?? ownerId, o.verifier ?? spvHse, o.due ?? await due(10)];
const CAPA_SQL = `select (a).* from public.capa_create($1,$2,$3,$4,$5,$6,$7,$8,$9::date) a`;
const capaStatus = async id => (await db.query(`select status from public.corrective_actions where id = $1`, [id])).rows[0].status;

await test('master SMKP berisi 7 elemen dan subelemennya, menjadi kerangka inti', async () => {
  const r = await as(db, staffId, `select level, count(*)::int c from public.compliance_clauses where framework_code = 'SMKP' group by level order by level`);
  eq(r.rows.find(x => x.level === 'element').c, 7);
  eq(r.rows.find(x => x.level === 'subelement').c, 41);
  eq((await db.query(`select is_core from public.compliance_frameworks where code = 'SMKP'`)).rows[0].is_core, true);
});
await test('elemen SMKP terpetakan ke ISO 45001 dan SMK3', async () => {
  const r = await db.query(`select count(*)::int c from public.clause_mappings m join public.compliance_clauses t on t.id = m.mapped_clause_id
    where t.framework_code in ('ISO45001','SMK3')`);
  if (r.rows[0].c < 14) throw new Error(`hanya ${r.rows[0].c} pemetaan`);
});
await test('staff tanpa capa.create tidak bisa membuat action plan', async () => {
  await expectError('42501', async () => as(db, ownerId, CAPA_SQL, await capaArgs()));
});
await test('action plan wajib menunjuk persyaratan yang valid', async () => {
  await expectError('22023', async () => as(db, spvHse, CAPA_SQL, await capaArgs({ clause: randomUUID(), verifier: dhHse })));
});
await test('verifikator harus independen dan berwenang', async () => {
  await expectError('22023', async () => as(db, dhHse, CAPA_SQL, await capaArgs({ pic: spvHse, verifier: spvHse })));
  await expectError('22023', async () => as(db, dhHse, CAPA_SQL, await capaArgs({ verifier: otherId })));
  await expectError('22023', async () => as(db, dhHse, CAPA_SQL, await capaArgs({ verifier: spvPlt })));
});
await test('target melebihi batas hari untuk risiko ekstrem ditolak', async () => {
  await expectError('22023', async () => as(db, dhHse, CAPA_SQL, await capaArgs({ risk: 'extreme', due: await due(30) })));
});
let act;
await test('action plan bernomor ACT dan PIC menerima notifikasi', async () => {
  act = (await as(db, dhHse, CAPA_SQL, await capaArgs())).rows[0];
  eq(act.action_no, `ACT-BSB-${new Date().getFullYear()}-000001`); eq(act.status, 'open');
  eq((await as(db, ownerId, `select 1 from public.notifications where kind = 'capa.assigned'`)).rowCount, 1);
});
await test('tabel action plan tidak bisa diubah langsung oleh klien', async () => {
  await expectError('42501', async () => as(db, dhHse, `update public.corrective_actions set status = 'closed' where id = $1`, [act.id]));
});
await test('hanya PIC yang melapor selesai, dan wajib dengan bukti', async () => {
  const ev = await upload(ownerId);
  await expectError('42501', async () => as(db, otherId, `select public.capa_submit($1, 'Rambu terpasang', $2)`, [act.id, [ev.id]]));
  await expectError('22023', async () => as(db, ownerId, `select public.capa_submit($1, 'Rambu terpasang', '{}')`, [act.id]));
  const foreign = await upload(otherId);
  await expectError('22023', async () => as(db, ownerId, `select public.capa_submit($1, 'Rambu terpasang', $2)`, [act.id, [foreign.id]]));
  await as(db, ownerId, `select public.capa_start($1)`, [act.id]);
  await as(db, ownerId, `select public.capa_submit($1, 'Rambu terpasang', $2)`, [act.id, [ev.id]]);
  eq(await capaStatus(act.id), 'submitted');
});
await test('pengembalian verifikator wajib beralasan dan kembali ke PIC', async () => {
  await expectError('42501', async () => as(db, dhHse, `select public.capa_verify($1, true)`, [act.id]));
  await expectError('22023', async () => as(db, spvHse, `select public.capa_verify($1, false, '')`, [act.id]));
  await as(db, spvHse, `select public.capa_verify($1, false, 'Foto belum menunjukkan lokasi KM 12')`, [act.id]);
  eq(await capaStatus(act.id), 'in_progress');
  const ev = await upload(ownerId);
  await as(db, ownerId, `select public.capa_submit($1, 'Foto lokasi ditambahkan', $2)`, [act.id, [ev.id]]);
});
await test('verifikasi menutup action plan dan otomatis menjadi bukti SMKP', async () => {
  const r = await as(db, spvHse, `select (a).* from public.capa_verify($1, true, 'Sesuai') a`, [act.id]);
  eq(r.rows[0].status, 'closed');
  if (!r.rows[0].effectiveness_due) throw new Error('jadwal cek efektivitas kosong untuk risiko tinggi');
  const e = await db.query(`select status from public.evidence_links where source_table = 'corrective_actions' and source_id = $1 and clause_id = $2`, [act.id, C57]);
  eq(e.rows[0]?.status, 'accepted');
  const h = await db.query(`select string_agg(event, ',' order by id) s from public.capa_events where action_id = $1`, [act.id]);
  eq(h.rows[0].s, 'created,started,submitted,returned,submitted,verified');
});
await test('tindakan tidak efektif membuat action plan lanjutan', async () => {
  await as(db, spvHse, `select public.capa_review_effectiveness($1, false, 'Rambu dicuri lagi, perlu rambu permanen')`, [act.id]);
  const r = await db.query(`select action_no, status, pic_id from public.corrective_actions where parent_id = $1`, [act.id]);
  eq(r.rowCount, 1); eq(r.rows[0].status, 'open'); eq(r.rows[0].pic_id, ownerId);
  await expectError('22023', async () => as(db, spvHse, `select public.capa_review_effectiveness($1, true, 'ulang')`, [act.id]));
});
await test('perpanjangan target oleh atasan, maksimal dua kali, bukan oleh PIC', async () => {
  const a = (await as(db, dhHse, CAPA_SQL, await capaArgs({ title: 'Perbaiki drainase', risk: 'medium', pic: spvHse, verifier: hseMgr }))).rows[0];
  await expectError('42501', async () => as(db, spvHse, `select public.capa_extend($1, $2::date, 'hujan')`, [a.id, await due(40)]));
  await expectError('22023', async () => as(db, dhHse, `select public.capa_extend($1, $2::date, '')`, [a.id, await due(40)]));
  await as(db, dhHse, `select public.capa_extend($1, $2::date, 'Menunggu material')`, [a.id, await due(40)]);
  await as(db, hseMgr, `select public.capa_extend($1, $2::date, 'Hujan')`, [a.id, await due(50)]);
  await expectError('22023', async () => as(db, dhHse, `select public.capa_extend($1, $2::date, 'Lagi')`, [a.id, await due(60)]));
  const r = await db.query(`select original_due_date < due_date x, extension_count from public.corrective_actions where id = $1`, [a.id]);
  eq(r.rows[0].x, true); eq(r.rows[0].extension_count, 2);
});
await test('status kepatuhan per persyaratan dihitung dari bukti dan action plan', async () => {
  const r = await as(db, staffId, `select evidence_accepted, capa_open from public.compliance_clause_status where id = $1`, [C57]);
  eq(r.rows[0].evidence_accepted, 1); eq(r.rows[0].capa_open, 2);
});
await test('bukti harus rekaman sah dan tidak dinilai pengirimnya sendiri', async () => {
  const draft = (await db.query(`select id from public.documents where status in ('draft','in_process','cancelled') limit 1`)).rows[0].id;
  await expectError('22023', async () => as(db, ownerId, `select public.evidence_link($1, 'documents', $2, 'Draf')`, [C22, draft]));
  const doc = (await db.query(`select id from public.documents where status = 'effective' limit 1`)).rows[0].id;
  const l = (await as(db, hseMgr, `select (e).* from public.evidence_link($1, 'documents', $2, 'Rekaman IBPR') e`, [C22, doc])).rows[0];
  eq(l.status, 'submitted');
  await expectError('42501', async () => as(db, hseMgr, `select public.evidence_review($1, true)`, [l.id]));
  await expectError('42501', async () => as(db, staffId, `select public.evidence_review($1, true)`, [l.id]));
  const ia = await createUser('auditor@bsb.co.id');
  await db.query(`insert into public.user_roles(user_id, role_code) values ($1, 'INTERNAL_AUDITOR')`, [ia]);
  eq((await as(db, ia, `select (e).status from public.evidence_review($1, true) e`, [l.id])).rows[0].status, 'accepted');
});
let obligation;
await test('legal register bernomor LGL dan menolak regulasi ganda', async () => {
  const r = await as(db, hseMgr, `select (l).* from public.legal_register('Pedoman pelaksanaan kaidah teknik pertambangan yang baik',
    'Kepmen ESDM 1827 K/30/MEM/2018', 'KEPMEN', $1, 'Menteri ESDM', '2018-05-08', 'https://jdih.esdm.go.id') l`, [HSE]);
  eq(r.rows[0].register_no, 'LGL-BSB-0001');
  await expectError('23505', async () => as(db, hseMgr, `select public.legal_register('x', 'kepmen esdm 1827 k/30/mem/2018', 'KEPMEN', $1)`, [HSE]));
  await expectError('42501', async () => as(db, dhHse, `select public.legal_register('y', 'PP 50/2012', 'PP', $1)`, [HSE]));
  obligation = (await as(db, hseMgr, `select (o).id from public.legal_add_obligation($1, 'Menerapkan SMKP Minerba', 'Lampiran IV', $2) o`,
    [r.rows[0].id, C23])).rows[0].id;
});
await test('evaluasi tidak patuh wajib beralasan; patuh menjadi bukti', async () => {
  await expectError('23514', async () => as(db, hseMgr, `select public.legal_evaluate($1, 'non_compliant')`, [obligation]));
  await as(db, hseMgr, `select public.legal_evaluate($1, 'compliant')`, [obligation]);
  const r = await db.query(`select compliance_status, next_evaluation_at > last_evaluated_at x from public.legal_obligations where id = $1`, [obligation]);
  eq(r.rows[0].compliance_status, 'compliant'); eq(r.rows[0].x, true);
  eq((await db.query(`select 1 from public.evidence_links where clause_id = $1 and source_table = 'legal_evaluations'`, [C23])).rowCount, 1);
});
await test('penilaian hanya bisa ditutup setelah semua persyaratan dinilai', async () => {
  const a = (await as(db, hseMgr, `select (a).id from public.assessment_start('SMKP', 'Self assessment SMKP 2026', 'self', '2026-01-01', '2026-12-31') a`)).rows[0].id;
  await expectError('23514', async () => as(db, hseMgr, `select public.assessment_record($1, $2, 'partial')`, [a, C57]));
  await as(db, hseMgr, `select public.assessment_record($1, $2, 'partial', 'Efektivitas belum terbukti')`, [a, C57]);
  await expectError('22023', async () => as(db, hseMgr, `select public.assessment_complete($1, 'ringkas')`, [a]));
  await as(db, hseMgr, `select public.assessment_record($1, c.id, 'fulfilled') from public.compliance_clauses c
    where c.framework_code = 'SMKP' and c.level = 'subelement' and c.applicability = 'applicable' and c.id <> $2`, [a, C57]);
  eq((await as(db, hseMgr, `select (a).status from public.assessment_complete($1, 'Baseline') a`, [a])).rows[0].status, 'completed');
});
await test('kode persyaratan yang sudah dirujuk tidak bisa diubah', async () => {
  await expectError('22023', async () => as(db, hseMgr, `update public.compliance_clauses set code = '5.9' where id = $1`, [C57]));
  await expectError('42501', async () => as(db, dhHse, `update public.compliance_clauses set title = 'x' where id = $1`, [C22]).then(r => { if (!r.rowCount) { const e = new Error('rls'); e.code = '42501'; throw e; } }));
});

console.log('SHE');
const area = (await db.query(`select id from public.work_areas where code = 'HAUL'`)).rows[0].id;
const today = await due(0);
const RISK_SQL = `select (r).* from public.risk_save($1, $2, 'Hauling batubara', 'Jalan licin saat hujan', 'Unit tergelincir', $3, $4, $5, $6, 'SOP hauling', $7) r`;
let risk;
await test('risk register bernomor RSK per departemen, skor dan tingkat 5x5 dihitung', async () => {
  await expectError('42501', async () => as(db, ownerId, RISK_SQL, [null, HSE, 4, 5, 2, 4, 'Grading dan water truck']));
  await expectError('22023', async () => as(db, spvHse, RISK_SQL, [null, HSE, 4, 5, 3, 4, null]));
  risk = (await as(db, spvHse, RISK_SQL, [null, HSE, 4, 5, 2, 4, 'Grading dan water truck'])).rows[0];
  eq(risk.risk_no, 'RSK-BSB-HSE-0001'); eq(risk.initial_score, 20); eq(risk.residual_score, 8);
  const v = (await as(db, spvHse, `select initial_level, residual_level from public.risk_register_view where id = $1`, [risk.id])).rows[0];
  eq(v.initial_level, 'extreme'); eq(v.residual_level, 'medium');
});
await test('risiko residual tidak boleh lebih besar dari risiko awal', async () => {
  await expectError('23514', async () => as(db, spvHse, RISK_SQL, [null, HSE, 1, 2, 3, 3, null]));
});
await test('penyusun tidak bisa menyetujui risikonya sendiri; persetujuan tercatat dan jadi bukti SMKP 2.2', async () => {
  await expectError('42501', async () => as(db, spvHse, `select public.risk_approve($1)`, [risk.id]));
  await expectError('42501', async () => as(db, dhHse, `select public.risk_approve($1)`, [risk.id]));
  const r = (await as(db, hseMgr, `select (r).* from public.risk_approve($1) r`, [risk.id])).rows[0];
  eq(r.status, 'approved'); if (!r.review_due) throw new Error('review_due kosong');
  const e = await as(db, hseMgr, `select (e).status from public.evidence_link($1, 'risk_register', $2, 'IBPR hauling') e`, [C22, risk.id]);
  eq(e.rows[0].status, 'submitted');
});
await test('mengubah risiko yang disetujui membuka revisi baru', async () => {
  const r = (await as(db, spvHse, RISK_SQL, [risk.id, HSE, 4, 5, 2, 3, 'Grading, water truck, batas kecepatan'])).rows[0];
  eq(r.status, 'draft'); eq(r.revision, 1); eq(r.risk_no, risk.risk_no);
});
await test('risiko residual ekstrem tidak bisa disetujui', async () => {
  const r = (await as(db, spvHse, RISK_SQL, [null, HSE, 5, 5, 4, 5, 'Belum ada'])).rows[0];
  await expectError('22023', async () => as(db, hseMgr, `select public.risk_approve($1)`, [r.id]));
});

let hz;
const HZ_SQL = `select (h).* from public.hazard_report($1::date, $2, 'KTA', 'Rambu batas kecepatan KM 12 roboh', $3, $4::date, $5, null, 'Pasang ulang', $6, $7) h`;
await test('hazard report bernomor HZD dan pengawas departemen PIC diberi tahu', async () => {
  await expectError('42501', async () => as(db, otherId, HZ_SQL, [today, HSE, PLT, await due(3), area, 'high', []]));
  await expectError('22023', async () => as(db, ownerId, HZ_SQL, [await due(1), HSE, PLT, await due(3), area, 'high', []]));
  hz = (await as(db, ownerId, HZ_SQL, [today, HSE, PLT, await due(3), area, 'high', []])).rows[0];
  eq(hz.hazard_no, `HZD-BSB-${new Date().getFullYear()}-00001`); eq(hz.status, 'open');
  eq((await as(db, spvPlt, `select 1 from public.notifications where kind = 'she.hazard'`)).rowCount, 1);
});
await test('hazard ditutup oleh pengawas PIC; risiko tinggi wajib bukti foto', async () => {
  await expectError('42501', async () => as(db, spvHse, `select public.hazard_close($1, 'Sudah dipasang')`, [hz.id]));
  await expectError('22023', async () => as(db, spvPlt, `select public.hazard_close($1, 'Sudah dipasang')`, [hz.id]));
  const foreign = await upload(ownerId);
  await expectError('22023', async () => as(db, spvPlt, `select public.hazard_close($1, 'Sudah dipasang', $2)`, [hz.id, [foreign.id]]));
  const ev = await upload(spvPlt);
  eq((await as(db, spvPlt, `select (h).status from public.hazard_close($1, 'Sudah dipasang', $2) h`, [hz.id, [ev.id]])).rows[0].status, 'closed');
  eq((await db.query(`select owner_table from public.attachments where id = $1`, [ev.id])).rows[0].owner_table, 'hazard_reports');
});
await test('hazard report tidak bisa diubah langsung oleh klien', async () => {
  await expectError('42501', async () => as(db, spvPlt, `update public.hazard_reports set status = 'open' where id = $1`, [hz.id]));
});

await test('observasi tidak aman wajib uraian; tanpa coaching tetap open', async () => {
  const O = `select (o).* from public.observation_record($1::date, $2, 'Pengisian fuel', $3, $4, 'Budi', 1, $5, $6) o`;
  await expectError('23514', async () => as(db, spvHse, O, [today, HSE, 'unsafe', area, null, null]));
  const o = (await as(db, spvHse, O, [today, HSE, 'unsafe', area, 'Tidak memakai sarung tangan', null])).rows[0];
  eq(o.status, 'open'); eq(o.obs_no, `OBS-BSB-${new Date().getFullYear()}-00001`);
  eq((await as(db, spvHse, `select (o).status from public.observation_close($1, 'Coaching APD') o`, [o.id])).rows[0].status, 'closed');
  eq((await as(db, spvHse, O, [today, HSE, 'safe', area, null, null])).rows[0].status, 'closed');
});

let insp;
await test('inspeksi mencatat temuan dan memakai nomor INS harian', async () => {
  const findings = [{ description: 'APAR kadaluarsa', risk_level: 'medium', pic_department_id: PLT, due_date: await due(7) },
                    { description: 'Kabel terkelupas', risk_level: 'high', pic_department_id: PLT, due_date: await due(2) }];
  await expectError('22023', async () => as(db, spvHse, `select public.inspection_record($1::date, $2, 'workshop', 'Workshop', $3::jsonb)`,
    [today, HSE, JSON.stringify([{ ...findings[0], due_date: await due(-1) }])]));
  insp = (await as(db, spvHse, `select (i).* from public.inspection_record($1::date, $2, 'workshop', 'Workshop Plant', $3::jsonb, $4) i`,
    [today, HSE, JSON.stringify(findings), area])).rows[0];
  if (!/^INS-BSB-\d{8}-\d{4}$/.test(insp.inspection_no)) throw new Error(insp.inspection_no);
  const f = (await as(db, spvHse, `select seq, status from public.she_finding_register where inspection_id = $1 order by seq`, [insp.id])).rows;
  eq(f.length, 2); eq(f[1].status, 'open');
});
await test('temuan inspeksi ditutup pengawas PIC dengan bukti untuk risiko tinggi', async () => {
  const f = (await db.query(`select id from public.inspection_findings where inspection_id = $1 and seq = 2`, [insp.id])).rows[0];
  await expectError('42501', async () => as(db, spvHse, `select public.finding_close($1, 'Diganti')`, [f.id]));
  await expectError('22023', async () => as(db, spvPlt, `select public.finding_close($1, 'Diganti')`, [f.id]));
  const ev = await upload(spvPlt);
  eq((await as(db, spvPlt, `select (x).status from public.finding_close($1, 'Kabel diganti', $2) x`, [f.id, [ev.id]])).rows[0].status, 'closed');
});

const items = (over = {}) => JSON.stringify(Object.assign({ brake: 'ok', lights: 'ok', horn: 'ok', seatbelt: 'ok', extinguisher: 'ok',
  wheel_chock: 'ok', tyre: 'ok', glass_wiper: 'ok', cone: 'ok', radio: 'ok', leak: 'ok', reverse_alarm: 'ok' }, over));
const P2H_SQL = `select (p).* from public.p2h_submit($1::date, 1, $2, $3, 'DT', $4::jsonb, 'fit', 12500, $5) p`;
await test('P2H wajib checklist lengkap', async () => {
  await expectError('22023', async () => as(db, ownerId, P2H_SQL, [today, HSE, 'DT-01', JSON.stringify({ brake: 'ok' }), null]));
});
await test('item kritis tidak OK memaksa unit tidak layak dan memberi tahu Plant', async () => {
  await expectError('22023', async () => as(db, ownerId, P2H_SQL, [today, HSE, 'DT-02', items({ brake: 'not_ok' }), null]));
  const p = (await as(db, ownerId, P2H_SQL, [today, HSE, 'dt-02', items({ brake: 'not_ok' }), 'Rem blong'])).rows[0];
  eq(p.conclusion, 'unfit'); eq(p.unit_no, 'DT-02');
  eq((await as(db, spvPlt, `select 1 from public.notifications where kind = 'she.p2h_unfit'`)).rowCount, 1);
  const q = (await as(db, ownerId, P2H_SQL, [today, HSE, 'DT-03', items({ cone: 'not_ok' }), 'Cone hilang'])).rows[0];
  eq(q.conclusion, 'fit_with_notes');
});
await test('satu unit hanya satu P2H per shift', async () => {
  await expectError('23505', async () => as(db, ownerId, P2H_SQL, [today, HSE, 'DT-03', items(), null]));
});

await test('fit to work: kurang tidur tidak bisa dinyatakan fit; data kesehatan tidak terbuka untuk umum', async () => {
  const F = `select (f).* from public.ftw_submit($1::date, 1, $2, $3, false, $4, 'Pusing') f`;
  await expectError('22023', async () => as(db, ownerId, F, [today, HSE, 4, 'fit']));
  const f = (await as(db, ownerId, F, [today, HSE, 4, 'fit_with_notes'])).rows[0];
  eq((await as(db, actingId, `select 1 from public.fit_to_work where id = $1`, [f.id])).rowCount, 0);
  eq((await as(db, spvHse, `select 1 from public.fit_to_work where id = $1`, [f.id])).rowCount, 1);
  await expectError('42501', async () => as(db, ownerId, `select public.ftw_check($1, 'fit', 'ok')`, [f.id]));
  await as(db, spvHse, `select public.ftw_check($1, 'unfit', 'Istirahat, diganti operator cadangan')`, [f.id]);
});

let inc;
const INC_SQL = `select (i).* from public.incident_report($1::timestamptz, $2, $3, 'DT menyenggol LV di simpang KM 5', $4, null, 'DT-07', null, 'Area diamankan', $5) i`;
await test('insiden lewat 24 jam wajib alasan keterlambatan', async () => {
  await expectError('22023', async () => as(db, ownerId, INC_SQL, [new Date(Date.now() - 30 * 3600e3).toISOString(), HSE, 'property_damage', area, null]));
  const r = (await as(db, ownerId, INC_SQL, [new Date(Date.now() - 30 * 3600e3).toISOString(), HSE, 'nearmiss', area, 'Radio mati'])).rows[0];
  eq(r.late_report, true);
});
await test('insiden bernomor INC dan HSE manager diberi tahu', async () => {
  inc = (await as(db, ownerId, INC_SQL, [new Date(Date.now() - 2 * 3600e3).toISOString(), HSE, 'property_damage', area, null])).rows[0];
  if (!/^INC-BSB-\d{4}-\d{6}$/.test(inc.incident_no)) throw new Error(inc.incident_no);
  eq((await as(db, hseMgr, `select 1 from public.notifications where kind = 'she.incident'`)).rowCount, 2);
});
await test('investigasi oleh investigator yang ditunjuk; penutupan oleh orang lain dan wajib action plan', async () => {
  await expectError('42501', async () => as(db, spvHse, `select public.incident_assign($1, $2)`, [inc.id, spvHse]));
  await as(db, hseMgr, `select public.incident_assign($1, $2)`, [inc.id, spvHse]);
  await expectError('42501', async () => as(db, hseMgr, `select public.incident_investigate($1, 'x', 'y')`, [inc.id]));
  await expectError('22023', async () => as(db, hseMgr, `select public.incident_close($1, 'Selesai')`, [inc.id]));
  await as(db, spvHse, `select public.incident_investigate($1, 'Blind spot simpang tanpa cermin', 'Pasang convex mirror', 'property_damage')`, [inc.id]);
  await expectError('22023', async () => as(db, hseMgr, `select public.incident_close($1, 'Selesai')`, [inc.id]));
  await as(db, dhHse, `select public.capa_create('Pasang convex mirror simpang KM 5', 'Hasil investigasi', 'incident', $1, 'medium', $2, $3, $4, $5::date,
    'corrective', 'engineering', 'incidents', $6, $7)`, [await clause('5.4'), HSE, ownerId, spvHse, await due(20), inc.id, inc.incident_no]);
  eq((await as(db, hseMgr, `select (i).status from public.incident_close($1, 'Action plan berjalan') i`, [inc.id])).rows[0].status, 'closed');
  eq((await as(db, hseMgr, `select capa_count from public.incident_register where id = $1`, [inc.id])).rows[0].capa_count, 1);
});
await test('LTI hanya bisa ditutup setelah pelaporan ke KaIT dicatat', async () => {
  const x = (await as(db, ownerId, INC_SQL, [new Date(Date.now() - 3600e3).toISOString(), HSE, 'lti', area, null])).rows[0];
  await as(db, hseMgr, `select public.incident_assign($1, $2)`, [x.id, spvHse]);
  await as(db, spvHse, `select public.incident_investigate($1, 'Prosedur tidak diikuti', 'Retraining')`, [x.id]);
  await as(db, dhHse, `select public.capa_create('Retraining operator', 'Hasil investigasi', 'incident', $1, 'high', $2, $3, $4, $5::date,
    'corrective', 'administrative', 'incidents', $6)`, [await clause('5.4'), HSE, ownerId, spvHse, await due(10), x.id]);
  await expectError('22023', async () => as(db, hseMgr, `select public.incident_close($1, 'Selesai')`, [x.id]));
  await as(db, hseMgr, `select public.incident_close($1, 'Selesai', now())`, [x.id]);
});

await test('SAP menghitung act mingguan (Selasa–Senin) terhadap target, nol saat cuti', async () => {
  eq((await db.query(`select app.sap_week('2026-10-13')::text a, app.sap_week('2026-10-19')::text b, app.sap_week('2026-10-20')::text c`)).rows[0].b, '2026-10-13');
  eq((await db.query(`select app.sap_week('2026-10-20')::text c`)).rows[0].c, '2026-10-20');
  await expectError('42501', async () => as(db, spvHse, `select public.sap_set_target($1, '2026-01-06', 3, 2, 2)`, [spvHse]));
  await as(db, hseMgr, `select public.sap_set_target($1, '2026-01-06', 3, 2, 2)`, [spvHse]);
  const w = (await as(db, hseMgr, `select * from public.sap_weekly where user_id = $1 and week_start = app.sap_week(app.site_today())`, [spvHse])).rows[0];
  eq(w.obs_target, 3); eq(w.obs_act, 2); eq(w.insp_act, 1);
  await as(db, hseMgr, `select public.sap_set_leave($1, app.sap_week(app.site_today()), true)`, [spvHse]);
  eq((await as(db, hseMgr, `select obs_target from public.sap_weekly where user_id = $1 and week_start = app.sap_week(app.site_today())`, [spvHse])).rows[0].obs_target, 0);
});

await test('anon hanya bisa memanggil verifikasi dokumen', async () => {
  const r = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`);
  eq(r.rows.map(x => x.proname).join(','), 'verify_document');
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
