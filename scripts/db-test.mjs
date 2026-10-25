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

console.log('Plant');
const dhPlt = await createUser('dh.plt@bsb.co.id');
await db.query(`insert into public.user_roles(user_id, role_code, department_id) values ($1,'DEPT_HEAD',$2)`, [dhPlt, PLT]);
let unit;
await test('register unit hanya oleh pengelola Plant; unit rental wajib vendor', async () => {
  await expectError('42501', async () => as(db, spvPlt, `select public.unit_save('DT-21', 'DT', $1)`, [PLT]));
  await expectError('23514', async () => as(db, dhPlt, `select public.unit_save('DT-21', 'DT', $1, 'rental')`, [PLT]));
  unit = (await as(db, dhPlt, `select (u).* from public.unit_save('dt-21', 'DT', $1, 'owned', null, 'Hino', 'FM260', null, 2022, 12000) u`, [PLT])).rows[0];
  eq(unit.unit_no, 'DT-21'); eq(unit.status, 'ready');
});
let autoWo;
await test('HM P2H tidak boleh mundur dari HM unit', async () => {
  await expectError('22023', async () => as(db, ownerId, `select public.p2h_submit($1::date, 2, $2, 'DT-21', 'DT', $3::jsonb, 'fit', 11000)`, [today, HSE, items()]));
});
await test('P2H tidak layak membuka WO breakdown otomatis dan unit jadi breakdown', async () => {
  await as(db, ownerId, `select public.p2h_submit($1::date, 2, $2, 'DT-21', 'DT', $3::jsonb, 'fit', 12010, 'Rem bocor')`, [today, HSE, items({ brake: 'not_ok' })]);
  autoWo = (await db.query(`select * from public.work_order_register where unit_no = 'DT-21' and source_table = 'p2h_checks'`)).rows[0];
  eq(autoWo.wo_type, 'breakdown'); eq(autoWo.priority, 'urgent');
  if (!/^WO-BSB-\d{4}-\d{6}$/.test(autoWo.wo_no)) throw new Error(autoWo.wo_no);
  const u = (await db.query(`select status, current_hm::int hm from public.units where id = $1`, [unit.id])).rows[0];
  eq(u.status, 'breakdown'); eq(u.hm, 12010);
  eq((await as(db, spvPlt, `select 1 from public.notifications where kind = 'plant.wo'`)).rowCount, 1);
});
await test('unit breakdown tidak bisa dinyatakan layak di P2H atau diset siap manual', async () => {
  await expectError('22023', async () => as(db, ownerId, `select public.p2h_submit($1::date, 1, $2, 'DT-21', 'DT', $3::jsonb, 'fit', 12010)`, [today, HSE, items()]));
  await expectError('22023', async () => as(db, dhPlt, `select public.unit_set_status($1, 'ready')`, [unit.id]));
});
await test('WO dikerjakan mekanik Plant, selesai wajib uraian, unit kembali siap', async () => {
  await expectError('42501', async () => as(db, spvHse, `select public.wo_start($1)`, [autoWo.id]));
  await expectError('22023', async () => as(db, spvPlt, `select public.wo_complete($1, 'Ganti seal')`, [autoWo.id]));
  await as(db, spvPlt, `select public.wo_start($1)`, [autoWo.id]);
  await as(db, spvPlt, `select public.wo_wait_part($1, 'Seal master rem')`, [autoWo.id]);
  await as(db, spvPlt, `select public.wo_start($1)`, [autoWo.id]);
  await expectError('22023', async () => as(db, spvPlt, `select public.wo_complete($1, '')`, [autoWo.id]));
  await expectError('22023', async () => as(db, spvPlt, `select public.wo_complete($1, 'Ganti seal', 100)`, [autoWo.id]));
  eq((await as(db, spvPlt, `select (w).status from public.wo_complete($1, 'Ganti seal master rem', 12015) w`, [autoWo.id])).rows[0].status, 'done');
  eq((await db.query(`select status from public.units where id = $1`, [unit.id])).rows[0].status, 'ready');
  const a = (await as(db, spvPlt, `select pa_30d::float pa, breakdown_hours_30d::float h from public.unit_availability where unit_id = $1`, [unit.id])).rows[0];
  if (!(a.pa <= 100 && a.pa > 99)) throw new Error(JSON.stringify(a));
});
await test('WO PM wajib rencana PM; penyelesaian mencatat HM servis terakhir', async () => {
  const plan = (await as(db, dhPlt, `select (p).* from public.pm_plan_save($1, 'Servis 250 jam', 250, 11780) p`, [unit.id])).rows[0];
  eq((await as(db, dhPlt, `select count(*)::int c from public.pm_due where unit_id = $1`, [unit.id])).rows[0].c, 1);
  await expectError('42501', async () => as(db, spvPlt, `select public.wo_create($1, 'pm', 'Servis', 'medium', null, $2)`, [unit.id, plan.id]));
  await expectError('23514', async () => as(db, dhPlt, `select public.wo_create($1, 'pm', 'Servis')`, [unit.id]));
  const wo = (await as(db, dhPlt, `select (w).* from public.wo_create($1, 'pm', 'Servis 250 jam', 'medium', null, $2) w`, [unit.id, plan.id])).rows[0];
  eq((await db.query(`select status from public.units where id = $1`, [unit.id])).rows[0].status, 'ready');
  await as(db, spvPlt, `select public.wo_start($1)`, [wo.id]);
  await as(db, spvPlt, `select public.wo_complete($1, 'Ganti oli dan filter', 12050)`, [wo.id]);
  eq((await db.query(`select last_service_hm::int h from public.pm_plans where id = $1`, [plan.id])).rows[0].h, 12050);
  eq((await as(db, dhPlt, `select count(*)::int c from public.pm_due where unit_id = $1`, [unit.id])).rows[0].c, 0);
});
await test('laporan kerusakan oleh pekerja membuat unit breakdown; pembatalan oleh pengelola', async () => {
  const wo = (await as(db, ownerId, `select (w).* from public.wo_create($1, 'breakdown', 'Ban kempis', 'high', 12060) w`, [unit.id])).rows[0];
  eq((await db.query(`select status from public.units where id = $1`, [unit.id])).rows[0].status, 'breakdown');
  await expectError('42501', async () => as(db, spvPlt, `select public.wo_cancel($1, 'dobel')`, [wo.id]));
  await as(db, dhPlt, `select public.wo_cancel($1, 'Laporan ganda')`, [wo.id]);
  eq((await db.query(`select status from public.units where id = $1`, [unit.id])).rows[0].status, 'ready');
});

console.log('Produksi');
const PRD = await dept('PRD');
const spvPrd = await createUser('spv.prd@bsb.co.id');
const dhPrd = await createUser('dh.prd@bsb.co.id');
await db.query(`insert into public.user_roles(user_id, role_code, department_id) values ($1,'SUPERVISOR',$3), ($2,'DEPT_HEAD',$3)`, [spvPrd, dhPrd, PRD]);
let route, rep;
await test('rute dan target produksi hanya oleh pengelola produksi', async () => {
  await expectError('42501', async () => as(db, spvPrd, `select public.route_save('PIT1-JT', 'Pit 1 ke Jetty', 'Pit 1', 'Jetty', 18.5)`));
  route = (await as(db, dhPrd, `select (r).* from public.route_save('pit1-jt', 'Pit 1 ke Jetty', 'Pit 1', 'Jetty', 18.5) r`)).rows[0];
  eq(route.code, 'PIT1-JT');
  await as(db, pjoId, `select public.production_set_target($1::date, 300000)`, [today]);
});
await test('laporan shift bernomor PRD, satu per tanggal & shift, tidak boleh tanggal depan', async () => {
  await expectError('42501', async () => as(db, spvHse, `select public.production_report_open($1::date, 1)`, [today]));
  await expectError('22023', async () => as(db, spvPrd, `select public.production_report_open($1::date, 1)`, [await due(1)]));
  rep = (await as(db, spvPrd, `select (r).* from public.production_report_open($1::date, 1) r`, [today])).rows[0];
  if (!/^PRD-BSB-\d{8}-S1-\d{2}$/.test(rep.report_no)) throw new Error(rep.report_no);
  eq((await as(db, spvPrd, `select (r).id from public.production_report_open($1::date, 1) r`, [today])).rows[0].id, rep.id);
});
const TRIP_SQL = `select (t).* from public.haul_trip_save($1, $2, $3, 'Budi', $4, $5, 12100, $6) t`;
await test('ritase ditolak bila unit belum P2H layak pada shift itu; HM unit ikut diperbarui', async () => {
  await expectError('22023', async () => as(db, spvPrd, TRIP_SQL, [rep.id, unit.id, route.id, 5, 150, 12110]));
  await as(db, ownerId, `select public.p2h_submit($1::date, 1, $2, 'DT-21', 'DT', $3::jsonb, 'fit', 12100)`, [today, HSE, items()]);
  await expectError('23514', async () => as(db, spvPrd, TRIP_SQL, [rep.id, unit.id, route.id, 0, 30, 12110]));
  await as(db, spvPrd, TRIP_SQL, [rep.id, unit.id, route.id, 5, 150, 12110]);
  eq((await as(db, spvPrd, TRIP_SQL, [rep.id, unit.id, route.id, 6, 180, 12111])).rows[0].trips, 6);
  eq((await db.query(`select current_hm::int h from public.units where id = $1`, [unit.id])).rows[0].h, 12111);
});
await test('hambatan lain-lain wajib keterangan; jam hambatan dibatasi', async () => {
  await expectError('22023', async () => as(db, spvPrd, `select public.production_delay_add($1, 'other', 1)`, [rep.id]));
  await expectError('23514', async () => as(db, spvPrd, `select public.production_delay_add($1, 'rain', 13)`, [rep.id]));
  await as(db, spvPrd, `select public.production_delay_add($1, 'rain', 1.5)`, [rep.id]);
  const s = (await as(db, spvPrd, `select trips, tonnage::int t, ton_km::float tkm, delay_hours::float d from public.production_summary where id = $1`, [rep.id])).rows[0];
  eq(s.trips, 6); eq(s.t, 180); eq(s.tkm, 3330); eq(s.d, 1.5);
});
await test('laporan kosong tidak bisa dikirim; setelah dikirim terkunci', async () => {
  const empty = (await as(db, spvPrd, `select (r).id from public.production_report_open($1::date, 2) r`, [today])).rows[0].id;
  await expectError('22023', async () => as(db, spvPrd, `select public.production_submit($1)`, [empty]));
  await as(db, spvPrd, `select public.production_submit($1)`, [rep.id]);
  await expectError('22023', async () => as(db, spvPrd, `select public.production_delay_add($1, 'queue', 1)`, [rep.id]));
  await expectError('42501', async () => as(db, spvPrd, `select public.production_review($1, true)`, [rep.id]));
  eq((await as(db, dhPrd, `select 1 from public.notifications where kind = 'prod.submitted'`)).rowCount, 1);
});
await test('pengembalian wajib alasan; pengirim tidak boleh menyetujui laporannya sendiri', async () => {
  await expectError('22023', async () => as(db, dhPrd, `select public.production_review($1, false, '')`, [rep.id]));
  eq((await as(db, dhPrd, `select (r).status from public.production_review($1, false, 'Tonase DT-21 cek timbangan') r`, [rep.id])).rows[0].status, 'draft');
  eq((await as(db, spvPrd, `select 1 from public.notifications where kind = 'prod.returned'`)).rowCount, 1);
  await as(db, dhPrd, `select public.production_submit($1)`, [rep.id]);
  await expectError('42501', async () => as(db, dhPrd, `select public.production_review($1, true)`, [rep.id]));
  eq((await as(db, pjoId, `select (r).status from public.production_review($1, true) r`, [rep.id])).rows[0].status, 'approved');
  const m = (await as(db, spvPrd, `select tonnage_approved::int a, tonnage_target::int t from public.production_month where month = date_trunc('month', $1::date)`, [today])).rows[0];
  eq(m.a, 180); eq(m.t, 300000);
});

console.log('Logistik');
const LOG = await dept('LOG');
const logStaff = await createUser('gudang@bsb.co.id');
const logHead = await createUser('dh.log@bsb.co.id');
const pltStaff = await createUser('mekanik@bsb.co.id');
await db.query(`insert into public.user_roles(user_id, role_code, department_id) values ($1,'STAFF',$4), ($2,'DEPT_HEAD',$4), ($3,'STAFF',$5)`,
  [logStaff, logHead, pltStaff, LOG, PLT]);
let sp, solar, sup, woLog, mrBig, mrSmall;
const stock = async id => Number((await db.query(`select stock_qty from public.materials where id = $1`, [id])).rows[0].stock_qty);
await test('master barang & supplier hanya oleh pengelola Logistik', async () => {
  await expectError('42501', async () => as(db, spvPlt, `select public.material_save('SP-FLT-01', 'Filter oli', 'spare_part', 'pcs')`));
  sp = (await as(db, logHead, `select (m).* from public.material_save('sp-flt-01', 'Filter oli HD785', 'spare_part', 'pcs', 5) m`)).rows[0];
  solar = (await as(db, logHead, `select (m).* from public.material_save('SOLAR', 'Solar B40', 'fuel', 'L', 1000) m`)).rows[0];
  sup = (await as(db, logHead, `select (s).* from public.supplier_save('sup-01', 'CV Mitra Teknik', 'Suku cadang') s`)).rows[0];
  eq(sp.code, 'SP-FLT-01'); eq(sup.code, 'SUP-01');
});
await test('penerimaan barang bernomor GR, wajib no. surat jalan, harga rata-rata bergerak', async () => {
  await expectError('42501', async () => as(db, spvPlt, `select public.goods_receive($1, $2, 10, 500000, 'SJ-1')`, [sp.id, sup.id]));
  await expectError('22023', async () => as(db, logStaff, `select public.goods_receive($1, $2, 10, 500000, '')`, [sp.id, sup.id]));
  const g = (await as(db, logStaff, `select (g).* from public.goods_receive($1, $2, 10, 500000, 'SJ-001') g`, [sp.id, sup.id])).rows[0];
  if (!/^GR-BSB-\d{4}-\d{6}$/.test(g.movement_no)) throw new Error(g.movement_no);
  await as(db, logStaff, `select public.goods_receive($1, $2, 10, 700000, 'SJ-002')`, [sp.id, sup.id]);
  const m = (await db.query(`select stock_qty::int q, avg_cost::int c from public.materials where id = $1`, [sp.id])).rows[0];
  eq(m.q, 20); eq(m.c, 600000);
});
await test('MR suku cadang wajib terkait WO terbuka; nomor MR; nilai dihitung dari harga rata-rata', async () => {
  woLog = (await as(db, dhPlt, `select (w).* from public.wo_create($1, 'repair', 'Ganti filter oli') w`, [unit.id])).rows[0];
  const lines = q => JSON.stringify([{ material: sp.id, qty: q }]);
  await expectError('22023', async () => as(db, pltStaff, `select public.mr_create($1, 'Servis', $2::jsonb)`, [PLT, lines(2)]));
  await expectError('42501', async () => as(db, pltStaff, `select public.mr_create($1, 'Servis', $2::jsonb, null, $3)`, [HSE, lines(2), woLog.id]));
  mrBig = (await as(db, pltStaff, `select (r).* from public.mr_create($1, 'Overhaul filter', $2::jsonb, null, $3) r`, [PLT, lines(20), woLog.id])).rows[0];
  if (!/^MR-BSB-\d{4}-\d{6}$/.test(mrBig.mr_no)) throw new Error(mrBig.mr_no);
  eq(Number(mrBig.total_value), 12000000);
  mrSmall = (await as(db, pltStaff, `select (r).* from public.mr_create($1, 'Servis', $2::jsonb, null, $3) r`, [PLT, lines(2), woLog.id])).rows[0];
});
await test('MR disetujui orang lain; di atas batas nilai wajib Dept Head; penolakan wajib alasan', async () => {
  await expectError('22023', async () => as(db, logStaff, `select public.goods_issue($1, '[]'::jsonb)`, [mrSmall.id]));
  await expectError('42501', async () => as(db, spvPlt, `select public.mr_review($1, true)`, [mrBig.id]));
  await expectError('22023', async () => as(db, spvPlt, `select public.mr_review($1, false, '')`, [mrBig.id]));
  eq((await as(db, dhPlt, `select (r).status from public.mr_review($1, true) r`, [mrBig.id])).rows[0].status, 'approved');
  eq((await as(db, spvPlt, `select (r).status from public.mr_review($1, true) r`, [mrSmall.id])).rows[0].status, 'approved');
  const own = (await as(db, spvPlt, `select (r).id from public.mr_create($1, 'Pribadi', $2::jsonb, null, $3) r`, [PLT, JSON.stringify([{ material: sp.id, qty: 1 }]), woLog.id])).rows[0].id;
  await expectError('42501', async () => as(db, spvPlt, `select public.mr_review($1, true)`, [own]));
  eq((await as(db, dhPlt, `select (r).status from public.mr_review($1, false, 'Pakai stok bengkel') r`, [own])).rows[0].status, 'rejected');
});
await test('pengeluaran barang (GI) tidak melebihi sisa MR maupun stok; tercatat ke WO & unit', async () => {
  const line = async mr => (await db.query(`select id from public.material_request_lines where mr_id = $1`, [mr])).rows[0].id;
  const L = await line(mrBig.id), S = await line(mrSmall.id);
  await expectError('42501', async () => as(db, spvPlt, `select public.goods_issue($1, $2::jsonb)`, [mrBig.id, JSON.stringify([{ line: L, qty: 1 }])]));
  await expectError('22023', async () => as(db, logStaff, `select public.goods_issue($1, $2::jsonb)`, [mrBig.id, JSON.stringify([{ line: L, qty: 21 }])]));
  eq((await as(db, logStaff, `select (r).status from public.goods_issue($1, $2::jsonb) r`, [mrBig.id, JSON.stringify([{ line: L, qty: 15 }])])).rows[0].status, 'partial');
  eq((await as(db, logStaff, `select (r).status from public.goods_issue($1, $2::jsonb) r`, [mrSmall.id, JSON.stringify([{ line: S, qty: 2 }])])).rows[0].status, 'issued');
  eq(await stock(sp.id), 3);
  await expectError('22023', async () => as(db, logStaff, `select public.goods_issue($1, $2::jsonb)`, [mrBig.id, JSON.stringify([{ line: L, qty: 5 }])]));
  const mv = (await db.query(`select movement_no, wo_no, unit_no from public.stock_ledger where mr_id = $1`, [mrBig.id])).rows[0];
  if (!/^GI-BSB-\d{4}-\d{6}$/.test(mv.movement_no)) throw new Error(mv.movement_no);
  eq(mv.wo_no, woLog.wo_no); eq(mv.unit_no, 'DT-21');
  eq((await as(db, logHead, `select low_stock from public.material_stock where id = $1`, [sp.id])).rows[0].low_stock, true);
  await expectError('22023', async () => as(db, pltStaff, `select public.mr_cancel($1, 'batal')`, [mrBig.id]));
});
await test('BBM langsung ke unit wajib HM yang tidak mundur; hanya BBM/pelumas', async () => {
  await as(db, logStaff, `select public.goods_receive($1, $2, 5000, 14000, 'DO-PERTAMINA-01')`, [solar.id, sup.id]);
  const hm = Number((await db.query(`select current_hm from public.units where id = $1`, [unit.id])).rows[0].current_hm);
  await expectError('22023', async () => as(db, logStaff, `select public.fuel_issue($1, $2, 300, $3)`, [unit.id, solar.id, hm - 1]));
  await expectError('22023', async () => as(db, logStaff, `select public.fuel_issue($1, $2, 1, $3)`, [unit.id, sp.id, hm + 1]));
  await as(db, logStaff, `select public.fuel_issue($1, $2, 300, $3)`, [unit.id, solar.id, hm + 10]);
  eq(await stock(solar.id), 4700);
  eq(Number((await db.query(`select current_hm from public.units where id = $1`, [unit.id])).rows[0].current_hm), hm + 10);
});
await test('stok opname: selisih wajib keterangan dan tercatat sebagai penyesuaian', async () => {
  await expectError('22023', async () => as(db, logStaff, `select public.stock_opname($1, 4650)`, [solar.id]));
  await as(db, logStaff, `select public.stock_opname($1, 4650, 'Penguapan & kalibrasi flowmeter')`, [solar.id]);
  eq(await stock(solar.id), 4650);
  eq(Number((await db.query(`select qty from public.stock_movements where material_id = $1 and movement_type = 'adjust'`, [solar.id])).rows[0].qty), -50);
});
await test('evaluasi supplier: nilai rendah wajib catatan; grade dari rata-rata', async () => {
  await expectError('22023', async () => as(db, logHead, `select public.supplier_evaluate($1, $2::date, 4, 2, 4, 4, 4)`, [sup.id, today]));
  await expectError('42501', async () => as(db, logStaff, `select public.supplier_evaluate($1, $2::date, 4, 4, 4, 4, 4)`, [sup.id, today]));
  await as(db, logHead, `select public.supplier_evaluate($1, $2::date, 4, 2, 4, 4, 4, 'Pengiriman terlambat 3 hari')`, [sup.id, today]);
  const s = (await as(db, logStaff, `select score::float sc, grade from public.supplier_score where id = $1`, [sup.id])).rows[0];
  eq(s.sc, 3.6); eq(s.grade, 'B');
});

console.log('Pengadaan (alur Syshab)');
let mrLine, prShort, poSmall, sup2;
const lineOf = async mr => (await db.query(`select id from public.material_request_lines where mr_id = $1`, [mr])).rows[0].id;
const stage = async line => (await as(db, pltStaff, `select stage from public.mr_tracking where mr_line_id = $1`, [line])).rows[0].stage;
await test('approval MR per baris: pending wajib catatan, jumlah bisa dikurangi, GI dibatasi jumlah disetujui', async () => {
  const mr = (await as(db, pltStaff, `select (r).* from public.mr_create($1, 'Servis berkala', $2::jsonb, null, $3) r`,
    [PLT, JSON.stringify([{ material: sp.id, qty: 4 }]), woLog.id])).rows[0];
  mrLine = await lineOf(mr.id);
  await expectError('22023', async () => as(db, dhPlt, `select public.mr_decide($1, 'pending', '')`, [mr.id]));
  eq((await as(db, dhPlt, `select (r).status from public.mr_decide($1, 'pending', 'Konfirmasi nomor part') r`, [mr.id])).rows[0].status, 'pending');
  eq(await stage(mrLine), 'awaiting_approval');
  await expectError('42501', async () => as(db, pltStaff, `select public.mr_decide($1, 'approve')`, [mr.id]));
  await expectError('22023', async () => as(db, dhPlt, `select public.mr_decide($1, 'approve', null, $2::jsonb)`, [mr.id, JSON.stringify([{ line: mrLine, qty: 0 }])]));
  eq((await as(db, dhPlt, `select (r).status from public.mr_decide($1, 'approve', 'Cukup 2', $2::jsonb) r`, [mr.id, JSON.stringify([{ line: mrLine, qty: 2 }])])).rows[0].status, 'approved');
  eq(await stage(mrLine), 'ready');
  await expectError('22023', async () => as(db, logStaff, `select public.goods_issue($1, $2::jsonb)`, [mr.id, JSON.stringify([{ line: mrLine, qty: 3 }])]));
  eq((await as(db, logStaff, `select (r).status from public.goods_issue($1, $2::jsonb) r`, [mr.id, JSON.stringify([{ line: mrLine, qty: 2 }])])).rows[0].status, 'issued');
});
await test('PR otomatis dari kekurangan stok MR; tidak dobel; disetujui orang lain', async () => {
  // mrBig: disetujui 20, keluar 15, stok 1 → kurang 4
  await expectError('42501', async () => as(db, pltStaff, `select public.pr_from_mr($1)`, [mrBig.id]));
  prShort = (await as(db, logStaff, `select (p).* from public.pr_from_mr($1) p`, [mrBig.id])).rows[0];
  if (!/^PR-BSB-\d{4}-\d{5}$/.test(prShort.pr_no)) throw new Error(prShort.pr_no);
  eq(Number((await db.query(`select qty from public.purchase_requisition_lines where pr_id = $1`, [prShort.id])).rows[0].qty), 4);
  await expectError('22023', async () => as(db, logStaff, `select public.pr_from_mr($1)`, [mrBig.id]));
  eq(await stage(await lineOf(mrBig.id)), 'in_pr');
  await expectError('42501', async () => as(db, logStaff, `select public.pr_decide($1, true)`, [prShort.id]));
  await expectError('22023', async () => as(db, logHead, `select public.pr_decide($1, false, '')`, [prShort.id]));
  eq((await as(db, logHead, `select (p).status from public.pr_decide($1, true) p`, [prShort.id])).rows[0].status, 'approved');
});
await test('penawaran supplier: pertama otomatis terpilih, bisa diganti; satu tombol PO per supplier', async () => {
  sup2 = (await as(db, logHead, `select (s).* from public.supplier_save('sup-02', 'PT Sumber Part', 'Suku cadang') s`)).rows[0];
  const pl = (await db.query(`select id from public.purchase_requisition_lines where pr_id = $1`, [prShort.id])).rows[0].id;
  await expectError('22023', async () => as(db, logStaff, `select public.po_from_pr($1)`, [prShort.id]));
  const q1 = (await as(db, logStaff, `select (q).* from public.quote_save($1, $2, 650000, 7) q`, [pl, sup.id])).rows[0];
  const q2 = (await as(db, logStaff, `select (q).* from public.quote_save($1, $2, 600000, 3) q`, [pl, sup2.id])).rows[0];
  eq(q1.selected, true); eq(q2.selected, false);
  await as(db, logStaff, `select public.quote_select($1)`, [q2.id]);
  eq(Number((await as(db, logStaff, `select public.po_from_pr($1) n`, [prShort.id])).rows[0].n), 1);
  poSmall = (await db.query(`select * from public.purchase_orders where pr_id = $1`, [prShort.id])).rows[0];
  if (!/^PO-BSB-\d{4}-\d{5}$/.test(poSmall.po_no)) throw new Error(poSmall.po_no);
  eq(poSmall.status, 'issued'); eq(Number(poSmall.total_value), 2400000); eq(poSmall.supplier_id, sup2.id);
  eq((await db.query(`select status from public.purchase_requisitions where id = $1`, [prShort.id])).rows[0].status, 'ordered');
  await expectError('22023', async () => as(db, logStaff, `select public.quote_select($1)`, [q1.id]));
  eq(await stage(await lineOf(mrBig.id)), 'on_order');
});
await test('PO di atas batas menunggu approval Dept Head (bukan pembuat) sebelum barang bisa diterima', async () => {
  const pr = (await as(db, logStaff, `select (p).* from public.pr_create('Isi ulang solar', $1::jsonb) p`, [JSON.stringify([{ material: solar.id, qty: 1000 }])])).rows[0];
  await as(db, logHead, `select public.pr_decide($1, true)`, [pr.id]);
  const pl = (await db.query(`select id from public.purchase_requisition_lines where pr_id = $1`, [pr.id])).rows[0].id;
  await as(db, logStaff, `select public.quote_save($1, $2, 14000) q`, [pl, sup.id]);
  await as(db, logStaff, `select public.po_from_pr($1)`, [pr.id]);
  const po = (await db.query(`select * from public.purchase_orders where pr_id = $1`, [pr.id])).rows[0];
  eq(po.status, 'awaiting_approval');
  const pol = (await db.query(`select id from public.purchase_order_lines where po_id = $1`, [po.id])).rows[0].id;
  await expectError('22023', async () => as(db, logStaff, `select public.goods_receive_po($1, $2::jsonb, 'SJ-9')`, [po.id, JSON.stringify([{ line: pol, qty: 1000 }])]));
  await expectError('42501', async () => as(db, logStaff, `select public.po_approve($1, true)`, [po.id]));
  eq((await as(db, logHead, `select (o).status from public.po_approve($1, true) o`, [po.id])).rows[0].status, 'issued');
});
await test('penerimaan dari PO: harga PO, wajib surat jalan, PR tertutup, peminta MR diberi tahu', async () => {
  const pol = (await db.query(`select id from public.purchase_order_lines where po_id = $1`, [poSmall.id])).rows[0].id;
  const L = JSON.stringify([{ line: pol, qty: 4 }]);
  await expectError('22023', async () => as(db, logStaff, `select public.goods_receive_po($1, $2::jsonb, 'SJ-10')`, [poSmall.id, JSON.stringify([{ line: pol, qty: 5 }])]));
  await expectError('22023', async () => as(db, logStaff, `select public.goods_receive_po($1, $2::jsonb, '')`, [poSmall.id, L]));
  const before = await stock(sp.id);
  eq((await as(db, logStaff, `select (o).status from public.goods_receive_po($1, $2::jsonb, 'SJ-10') o`, [poSmall.id, L])).rows[0].status, 'received');
  eq(await stock(sp.id), before + 4);
  eq((await db.query(`select status from public.purchase_requisitions where id = $1`, [prShort.id])).rows[0].status, 'closed');
  eq(Number((await db.query(`select count(*) n from public.notifications where user_id = $1 and title like 'Barang PO%'`, [pltStaff])).rows[0].n), 1);
  eq(await stage(await lineOf(mrBig.id)), 'ready');
  eq((await as(db, logStaff, `select (r).status from public.goods_issue($1, $2::jsonb) r`, [mrBig.id, JSON.stringify([{ line: await lineOf(mrBig.id), qty: 5 }])])).rows[0].status, 'issued');
});

console.log('HRGA');
const HRGA = await dept('HRGA');
const hrStaff = await createUser('hrd@bsb.co.id');
const hrHead = await createUser('dh.hrga@bsb.co.id');
const opUser = await createUser('operator.dt@bsb.co.id');
await db.query(`insert into public.user_roles(user_id, role_code, department_id) values ($1,'STAFF',$4), ($2,'DEPT_HEAD',$4), ($3,'STAFF',$5)`,
  [hrStaff, hrHead, opUser, HRGA, PRD]);
const comp = async code => (await db.query(`select id from public.competencies where code = $1`, [code])).rows[0].id;
const pos = async code => (await db.query(`select id from public.positions where code = $1`, [code])).rows[0].id;
const OPRDT = await pos('OPR-DT'), MEK = await pos('MEK');
const INDUKSI = await comp('INDUKSI'), MCU = await comp('MCU'), SIMDT = await comp('SIMPER-DT'), DDT = await comp('DDT');
const EMP_SQL = `select (e).* from public.employee_save($1, $2, $3, $4, $5, $6, null, $7) e`;
let emp, emp2, empHse;
await test('data karyawan hanya oleh HRGA; jabatan sesuai departemen; akun ditautkan lewat email', async () => {
  await expectError('42501', async () => as(db, spvPrd, EMP_SQL, ['BSB-001', 'Andi', PRD, OPRDT, 'permanent', null, null]));
  await expectError('22023', async () => as(db, hrStaff, EMP_SQL, ['BSB-001', 'Andi', PRD, MEK, 'permanent', null, null]));
  await expectError('22023', async () => as(db, hrStaff, EMP_SQL, ['BSB-001', 'Andi', PRD, OPRDT, 'permanent', null, 'tidakada@bsb.co.id']));
  await expectError('23514', async () => as(db, hrStaff, EMP_SQL, ['BSB-009', 'Subkon', PRD, OPRDT, 'subcon', null, null]));
  emp = (await as(db, hrStaff, EMP_SQL, ['bsb-001', 'Andi Saputra', PRD, OPRDT, 'permanent', null, 'operator.dt@bsb.co.id'])).rows[0];
  eq(emp.nrp, 'BSB-001'); eq(emp.profile_id, opUser);
  emp2 = (await as(db, hrStaff, EMP_SQL, ['SUB-001', 'Budi', PRD, OPRDT, 'subcon', 'PT Mitra Hauling', null])).rows[0];
  empHse = (await as(db, hrStaff, EMP_SQL, ['BSB-002', 'Citra', HSE, null, 'permanent', null, null])).rows[0];
});
const ADD_SQL = `select (c).* from public.employee_competency_add($1, $2, $3::date, $4::date, $5) c`;
await test('SIMPER wajib induksi & MCU berlaku; masa berlaku dihitung dari master', async () => {
  await expectError('22023', async () => as(db, hrStaff, ADD_SQL, [emp.id, SIMDT, today, null, 'SIM-1']));
  await as(db, hrStaff, ADD_SQL, [emp.id, INDUKSI, today, null, null]);
  await as(db, hrStaff, ADD_SQL, [emp.id, MCU, today, null, 'MCU-1']);
  const s = (await as(db, hrStaff, ADD_SQL, [emp.id, SIMDT, today, null, 'SIM-1'])).rows[0];
  eq((await db.query(`select valid_until = ($1::date + interval '12 months' - interval '1 day')::date ok from public.employee_competencies where id = $2`, [today, s.id])).rows[0].ok, true);
  await expectError('22023', async () => as(db, hrStaff, ADD_SQL, [emp.id, MCU, await due(1), null, null]));
});
await test('matriks kompetensi: kepatuhan per karyawan, register SIMPER, status segera habis / kedaluwarsa', async () => {
  const r = (await as(db, spvPrd, `select required, compliant, compliance_pct::int p from public.employee_register where id = $1`, [emp.id])).rows[0];
  eq(r.required, 4); eq(r.compliant, 3); eq(r.p, 75);
  eq((await as(db, spvPrd, `select unit_type from public.authorization_register where employee_id = $1`, [emp.id])).rows[0].unit_type, 'DT');
  const soon = (await as(db, hrStaff, ADD_SQL, [emp2.id, MCU, await due(-300), await due(10), null])).rows[0];
  const old = (await as(db, hrStaff, ADD_SQL, [emp2.id, INDUKSI, await due(-700), await due(-335), null])).rows[0];
  const v = async id => (await db.query(`select validity from public.employee_competency_view where id = $1`, [id])).rows[0].validity;
  eq(await v(soon.id), 'expiring'); eq(await v(old.id), 'expired');
  eq((await db.query(`select status from public.competency_matrix where employee_id = $1 and competency_code = 'INDUKSI'`, [emp2.id])).rows[0].status, 'expired');
  await expectError('22023', async () => as(db, hrStaff, ADD_SQL, [emp2.id, SIMDT, today, null, null]));
});
await test('pelatihan selesai: semua peserta wajib dinilai, yang lulus otomatis mendapat kompetensi', async () => {
  const future = (await as(db, hrStaff, `select (t).id from public.training_save('Defensive driving', $1::date, 8, 'Trainer HSE', $2) t`, [await due(3), DDT])).rows[0].id;
  await expectError('22023', async () => as(db, hrStaff, `select public.training_complete($1, '[]')`, [future]));
  const t = (await as(db, hrStaff, `select (t).id from public.training_save('Defensive driving', $1::date, 8, 'Trainer HSE', $2, 'Ruang training', $3::uuid[]) t`,
    [today, DDT, [emp.id, emp2.id]])).rows[0].id;
  await expectError('22023', async () => as(db, hrStaff, `select public.training_complete($1, $2::jsonb)`, [t, JSON.stringify([{ employee: emp.id, passed: true, score: 85 }])]));
  await as(db, hrStaff, `select public.training_complete($1, $2::jsonb)`, [t, JSON.stringify([{ employee: emp.id, passed: true, score: 85 }, { employee: emp2.id, passed: false, score: 50 }])]);
  eq((await db.query(`select compliance_pct::int p from public.employee_register where id = $1`, [emp.id])).rows[0].p, 100);
  eq((await db.query(`select count(*)::int c from public.employee_competencies where employee_id = $1 and competency_id = $2`, [emp2.id, DDT])).rows[0].c, 0);
  await expectError('22023', async () => as(db, hrStaff, `select public.training_complete($1, '[]')`, [t]));
});
await test('pencabutan SIMPER oleh atasan wajib alasan dan menurunkan kepatuhan', async () => {
  const id = (await db.query(`select id from public.employee_competencies where employee_id = $1 and competency_id = $2`, [emp.id, SIMDT])).rows[0].id;
  await expectError('42501', async () => as(db, spvHse, `select public.employee_competency_revoke($1, 'Ngebut')`, [id]));
  await expectError('22023', async () => as(db, spvPrd, `select public.employee_competency_revoke($1, '')`, [id]));
  await as(db, spvPrd, `select public.employee_competency_revoke($1, 'Melanggar batas kecepatan berulang')`, [id]);
  eq((await db.query(`select count(*)::int c from public.authorization_register where employee_id = $1`, [emp.id])).rows[0].c, 0);
  eq((await db.query(`select compliance_pct::int p from public.employee_register where id = $1`, [emp.id])).rows[0].p, 75);
});
await test('roster disusun atasan departemen karyawan; rentang dibatasi', async () => {
  eq((await as(db, spvPrd, `select public.roster_set($1::uuid[], $2::date, $2::date + 6, 'D')`, [[emp.id, emp2.id], today])).rows[0].roster_set, 14);
  await as(db, spvPrd, `select public.roster_set($1::uuid[], $2::date, $2::date, 'OFF')`, [[emp.id], today]);
  eq((await db.query(`select code from public.roster_entries where employee_id = $1 and work_date = $2`, [emp.id, today])).rows[0].code, 'OFF');
  await expectError('42501', async () => as(db, spvPrd, `select public.roster_set($1::uuid[], $2::date, $2::date, 'D')`, [[empHse.id], today]));
  await expectError('22023', async () => as(db, spvPrd, `select public.roster_set($1::uuid[], $2::date, $2::date + 70, 'D')`, [[emp.id], today]));
});
await test('permintaan GA: bernomor, hanya terlihat peminta & petugas GA, selesai wajib keterangan', async () => {
  const g = (await as(db, ownerId, `select (g).* from public.ga_request_create('mess', 'AC kamar mess B-12 mati', 'Mess B') g`)).rows[0];
  if (!/^GA-BSB-\d{4}-\d{5}$/.test(g.request_no)) throw new Error(g.request_no);
  eq((await as(db, spvHse, `select 1 from public.ga_requests where id = $1`, [g.id])).rowCount, 0);
  eq((await as(db, hrStaff, `select 1 from public.ga_register where id = $1`, [g.id])).rowCount, 1);
  await expectError('42501', async () => as(db, ownerId, `select public.ga_request_process($1, 'start')`, [g.id]));
  await as(db, hrStaff, `select public.ga_request_process($1, 'start')`, [g.id]);
  await expectError('22023', async () => as(db, ownerId, `select public.ga_request_cancel($1)`, [g.id]));
  await expectError('22023', async () => as(db, hrStaff, `select public.ga_request_process($1, 'done')`, [g.id]));
  eq((await as(db, hrStaff, `select (g).status from public.ga_request_process($1, 'done', 'Freon diisi ulang') g`, [g.id])).rows[0].status, 'done');
  eq((await as(db, ownerId, `select 1 from public.notifications where kind = 'ga.request'`)).rowCount, 1);
});
await test('karyawan keluar: akun dinonaktifkan dan semua perannya berakhir', async () => {
  await as(db, opUser, `select public.ga_request_create('office', 'Minta ATK')`);
  await expectError('42501', async () => as(db, hrStaff, `select public.employee_exit($1, $2::date, 'Resign')`, [emp.id, today]));
  await expectError('22023', async () => as(db, hrHead, `select public.employee_exit($1, $2::date, 'Resign')`, [emp.id, await due(1)]));
  await as(db, hrHead, `select public.employee_exit($1, $2::date, 'Mengundurkan diri')`, [emp.id, today]);
  eq((await db.query(`select status from public.profiles where id = $1`, [opUser])).rows[0].status, 'exited');
  eq((await db.query(`select count(*)::int c from public.user_roles where user_id = $1 and valid_until is null`, [opUser])).rows[0].c, 0);
  await expectError('42501', async () => as(db, opUser, `select public.ga_request_create('office', 'Minta ATK lagi')`));
  await expectError('22023', async () => as(db, hrHead, `select public.employee_exit($1, $2::date, 'Lagi')`, [emp.id, today]));
});

console.log('Adaptasi Portal SHE');
await test('pelanggaran: dicatat HSE, ditutup hanya setelah sanksi, SP dan konseling lengkap; hitungan berulang', async () => {
  const V = `select (v).* from public.violation_record($1::date, $2, $3, 'Melanggar batas kecepatan', $4) v`;
  await expectError('42501', async () => as(db, spvPrd, V, [today, PRD, 'SPDK_OVERSPEED', emp2.id]));
  const v = (await as(db, spvHse, V, [today, PRD, 'SPDK_OVERSPEED', emp2.id])).rows[0];
  if (!/^PLG-BSB-\d{4}-0001$/.test(v.violation_no)) throw new Error(v.violation_no);
  eq(v.offender_name, 'Budi'); eq(v.company, 'PT Mitra Hauling');
  await expectError('22023', async () => as(db, spvHse, `select public.violation_close($1, null)`, [v.id]));
  await as(db, spvHse, `select public.violation_followup($1, 'sp1', null, null, $2::date, 'Spv HSE', 'Memahami dan berkomitmen')`, [v.id, today]);
  await expectError('22023', async () => as(db, spvHse, `select public.violation_close($1, null)`, [v.id]));
  await as(db, spvHse, `select public.violation_followup($1, 'sp1', 'SP/001/HRGA/X/2026', $2::date, $2::date, 'Spv HSE', 'Memahami')`, [v.id, today]);
  eq((await as(db, spvHse, `select (v).status from public.violation_close($1, 'Selesai') v`, [v.id])).rows[0].status, 'closed');
  const v2 = (await as(db, spvHse, V, [today, PRD, 'APD', emp2.id])).rows[0];
  eq((await as(db, spvHse, `select repeat_no from public.violation_register where id = $1`, [v2.id])).rows[0].repeat_no, 2);
  eq((await as(db, spvPrd, `select count(*)::int c from public.violations`)).rows[0].c, 2);
  const staffLog = await createUser('staff.log2@bsb.co.id');
  await db.query(`insert into public.user_roles(user_id, role_code, department_id) values ($1, 'STAFF', $2)`, [staffLog, await dept('LOG')]);
  eq((await as(db, staffLog, `select count(*)::int c from public.violations`)).rows[0].c, 0);
});
await test('induksi lulus memperbarui kompetensi INDUKSI; nilai di bawah batas ditolak; tamu tanpa data karyawan', async () => {
  const I = `select (i).* from public.induction_record($1::date, $2, 'Spv HSE', $3, $4, $5, null, null, null, $6) i`;
  await expectError('42501', async () => as(db, spvPrd, I, [today, 'reinduction', 'pass', empHse.id, null, 90]));
  await expectError('22023', async () => as(db, spvHse, I, [today, 'reinduction', 'pass', empHse.id, null, 60]));
  await expectError('22023', async () => as(db, spvHse, I, [today, 'new_hire', 'pass', null, 'Tanpa data', 90]));
  const i = (await as(db, spvHse, I, [today, 'reinduction', 'pass', empHse.id, null, 85])).rows[0];
  if (!i.employee_competency_id) throw new Error('kompetensi INDUKSI tidak dibuat');
  eq((await db.query(`select app.competency_valid($1, $2)`, [empHse.id, INDUKSI])).rows[0].competency_valid, true);
  eq((await as(db, spvHse, I, [today, 'visitor', 'pass', null, 'Tamu Vendor', null])).rows[0].participant_name, 'Tamu Vendor');
});
await test('izin masuk area: pemohon tidak menyetujui sendiri, wajib pendamping, penolakan beralasan', async () => {
  const R = `select (p).* from public.area_permit_request('Tamu', 'PT Vendor', 'Servis genset', $1::date, $1::date, 2) p`;
  const p = (await as(db, spvHse, R, [today])).rows[0];
  if (!/^IMA-BSB-\d{4}-0001$/.test(p.permit_no)) throw new Error(p.permit_no);
  await expectError('42501', async () => as(db, spvHse, `select public.area_permit_decide($1, true, null, $2)`, [p.id, empHse.id]));
  await expectError('22023', async () => as(db, hseMgr, `select public.area_permit_decide($1, true)`, [p.id]));
  await expectError('42501', async () => as(db, spvPrd, `select public.area_permit_decide($1, true, null, $2)`, [p.id, empHse.id]));
  eq((await as(db, hseMgr, `select (p).status from public.area_permit_decide($1, true, null, $2) p`, [p.id, empHse.id])).rows[0].status, 'approved');
  eq((await as(db, spvHse, `select on_site_today from public.area_permit_register where id = $1`, [p.id])).rows[0].on_site_today, true);
  const p2 = (await as(db, spvHse, R, [today])).rows[0];
  await expectError('22023', async () => as(db, hseMgr, `select public.area_permit_decide($1, false)`, [p2.id]));
});
await test('register komisioning (SPIP): oleh Plant/HSE, status berlaku dihitung', async () => {
  const C = `select (c).* from public.commissioning_save(null, 'tool', $1, 'Stand jack', 'Tool workshop', $2, $3::date, $4::date) c`;
  await expectError('42501', async () => as(db, spvPrd, C, ['SJ-01', null, null, null]));
  const c = (await as(db, spvHse, C, ['sj-01', 'REG/1', '2025-01-01', '2025-07-01'])).rows[0];
  eq(c.ref_code, 'SJ-01');
  eq((await as(db, spvPrd, `select validity from public.commissioning_register where id = $1`, [c.id])).rows[0].validity, 'expired');
  await expectError('23514', async () => as(db, spvHse, C, ['SJ-02', 'REG/2', '2025-07-01', '2025-01-01']));
});
await test('Pusat Data: tautan harus https dan hanya dikelola pengelola pustaka', async () => {
  const L = `select (l).* from public.resource_link_save('dt-mcu', 'Pusat Data SHE', 'Medical check up', 'Database MCU', $1, 'sheet') l`;
  await expectError('42501', async () => as(db, spvHse, L, ['https://docs.google.com/spreadsheets/d/x']));
  await expectError('23514', async () => as(db, hseMgr, L, ['http://contoh']));
  eq((await as(db, hseMgr, L, ['https://docs.google.com/spreadsheets/d/x'])).rows[0].code, 'dt-mcu');
});
await test('SAP per karyawan: act dari formulir sendiri atau atas nama, cuti nol, minggu terkunci, nomor minggu', async () => {
  eq((await db.query(`select app.sap_week('2026-10-19')::text w, app.sap_week_no('2026-10-13') n, app.sap_week_no('2026-10-20') m`)).rows[0].n, 41);
  eq((await db.query(`select app.sap_week_no('2026-10-20') m`)).rows[0].m, 42);
  const spvEmp = (await as(db, hrStaff, EMP_SQL, ['BSB-010', 'Spv HSE', HSE, null, 'permanent', null, 'spv.hse@bsb.co.id'])).rows[0];
  await expectError('42501', async () => as(db, spvHse, `select public.sap_participant_save($1, 'SH', 'HSE', '2026-01-06')`, [spvEmp.id]));
  await as(db, hseMgr, `select public.sap_participant_save($1, 'SH', 'HSE', '2026-01-06')`, [spvEmp.id]);
  await as(db, hseMgr, `select public.sap_participant_save($1, 'FOR', 'HSE', '2026-01-06')`, [empHse.id]);
  await as(db, hseMgr, `select public.sap_set_target($1, '2026-01-06', 2, 1, 1)`, [spvEmp.id]);
  await as(db, hseMgr, `select public.sap_set_target($1, '2026-01-06', 1, 1, 1)`, [empHse.id]);
  const O = `select (o).* from public.observation_record(app.site_today(), $1, 'Observasi SAP', 'safe') o`;
  const o1 = (await as(db, spvHse, O, [HSE])).rows[0];
  eq(o1.employee_id, spvEmp.id);
  const o2 = (await as(db, spvHse, O, [HSE])).rows[0];
  await expectError('42501', async () => as(db, spvPrd, `select public.she_credit('observations', $1, $2)`, [o2.id, empHse.id]));
  await as(db, spvHse, `select public.she_credit('observations', $1, $2)`, [o2.id, empHse.id]);
  const W = `select * from public.sap_weekly where employee_id = $1 and week_start = app.sap_week(app.site_today())`;
  const w = (await as(db, spvPrd, W, [spvEmp.id])).rows[0];
  eq(w.obs_target, 2); eq(w.obs_act, 1); eq(w.level, 'SH');
  eq((await as(db, spvPrd, W, [empHse.id])).rows[0].obs_act, 1);
  await as(db, hseMgr, `select public.sap_set_leave($1, app.sap_week(app.site_today()), true)`, [empHse.id]);
  eq((await as(db, spvPrd, W, [empHse.id])).rows[0].obs_target, 0);
  await expectError('22023', async () => as(db, hseMgr, `select public.sap_lock_week(app.sap_week(app.site_today()))`));
  const prev = `app.sap_week(app.site_today()) - 7`;
  await as(db, hseMgr, `select public.sap_set_leave($1, ${prev}, true)`, [spvEmp.id]);
  eq((await as(db, hseMgr, `select public.sap_lock_week(${prev}) n`)).rows[0].n, 2);
  eq((await as(db, spvPrd, `select locked, on_leave, obs_target from public.sap_weekly where employee_id = $1 and week_start = ${prev}`, [spvEmp.id])).rows[0].locked, true);
  await expectError('22023', async () => as(db, hseMgr, `select public.sap_set_leave($1, ${prev}, false)`, [spvEmp.id]));
  await as(db, hseMgr, `select public.sap_participant_end($1, app.site_today(), 'Mutasi')`, [empHse.id]);
});

console.log('Audit internal & tinjauan manajemen');
const auditor = await createUser('auditor.internal@bsb.co.id');
await db.query(`insert into public.user_roles(user_id, role_code) values ($1, 'INTERNAL_AUDITOR')`, [auditor]);
const PLAN_SQL = `select (a).* from public.audit_plan('Audit SMKP Produksi', 'Elemen 4 & 5 di Pit 1', $1::date, $2::date, $3, $4, $5::uuid[]) a`;
let aud, fMajor;
await test('program audit: auditor berwenang dan independen dari departemen auditee; nomor AUD', async () => {
  await expectError('42501', async () => as(db, spvPrd, PLAN_SQL, [today, today, auditor, PRD, []]));
  await expectError('22023', async () => as(db, hseMgr, PLAN_SQL, [today, today, auditor, PLT, [dhPlt]]));
  await expectError('22023', async () => as(db, hseMgr, PLAN_SQL, [today, today, auditor, PRD, [spvHse]]));
  aud = (await as(db, hseMgr, PLAN_SQL, [today, await due(2), auditor, PRD, [dhPlt]])).rows[0];
  if (!/^AUD-BSB-\d{4}-\d{3}$/.test(aud.audit_no)) throw new Error(aud.audit_no);
  eq((await db.query(`select count(*)::int c from public.audit_team where audit_id = $1`, [aud.id])).rows[0].c, 2);
});
await test('audit dimulai ketua tim sesuai jadwal; temuan hanya oleh tim selama audit berlangsung', async () => {
  const later = (await as(db, hseMgr, PLAN_SQL, [await due(5), await due(6), auditor, PRD, []])).rows[0];
  await expectError('22023', async () => as(db, auditor, `select public.audit_start($1)`, [later.id]));
  await expectError('42501', async () => as(db, dhPlt, `select public.audit_start($1)`, [aud.id]));
  await expectError('22023', async () => as(db, auditor, `select public.audit_finding_add($1, $2, 'major', 'x', 'y')`, [aud.id, C57]));
  await as(db, auditor, `select public.audit_start($1)`, [aud.id]);
  await expectError('42501', async () => as(db, spvHse, `select public.audit_finding_add($1, $2, 'minor', 'x', 'y')`, [aud.id, C57]));
  await expectError('22023', async () => as(db, dhPlt, `select public.audit_finding_add($1, $2, 'minor', 'Tidak ada bukti', '')`, [aud.id, C57]));
  fMajor = (await as(db, dhPlt, `select (f).* from public.audit_finding_add($1, $2, 'major', 'Action plan temuan inspeksi tidak dipantau', 'Register ACT: 5 lewat target') f`, [aud.id, C57])).rows[0];
  await as(db, auditor, `select public.audit_finding_add($1, $2, 'ofi', 'Papan informasi KPI belum ada', 'Observasi lapangan')`, [aud.id, C22]);
  eq((await db.query(`select finding_ref from public.audit_finding_register where id = $1`, [fMajor.id])).rows[0].finding_ref, `${aud.audit_no}-F01`);
  eq((await as(db, dhPrd, `select 1 from public.notifications where kind = 'audit.finding'`)).rowCount, 1);
});
await test('laporan oleh ketua tim mengunci temuan; audit ditutup pengelola setelah temuan mayor/minor punya action plan', async () => {
  await expectError('42501', async () => as(db, dhPlt, `select public.audit_report($1, 'Ringkasan')`, [aud.id]));
  await as(db, auditor, `select public.audit_report($1, '1 mayor, 1 peluang perbaikan')`, [aud.id]);
  await expectError('22023', async () => as(db, auditor, `select public.audit_finding_remove($1)`, [fMajor.id]));
  await expectError('22023', async () => as(db, hseMgr, `select public.audit_close($1)`, [aud.id]));
  await as(db, dhPrd, `select public.capa_create('Pantau action plan mingguan', 'Temuan audit mayor', 'audit', $1, 'medium', $2, $3, $4, $5::date,
    'corrective', null, 'audit_findings', $6)`, [C57, PRD, spvPrd, dhPrd, await due(14), fMajor.id]);
  eq((await db.query(`select action_no is not null ok from public.audit_finding_register where id = $1`, [fMajor.id])).rows[0].ok, true);
  eq((await as(db, hseMgr, `select (a).status from public.audit_close($1) a`, [aud.id])).rows[0].status, 'closed');
  eq((await db.query(`select without_capa from public.audit_register where id = $1`, [aud.id])).rows[0].without_capa, 0);
});
await test('tinjauan manajemen: semua masukan wajib dibahas, keputusan bertindak wajib action plan, ditutup pimpinan rapat', async () => {
  await expectError('42501', async () => as(db, spvPrd, `select public.mgmt_review_create('RTM', $1::date, $2)`, [today, pjoId]));
  const m = (await as(db, pjoId, `select (m).* from public.mgmt_review_create('Tinjauan manajemen semester II', $1::date, $2) m`, [today, pjoId])).rows[0];
  if (!/^RTM-BSB-\d{4}-\d{2}$/.test(m.review_no)) throw new Error(m.review_no);
  await expectError('22023', async () => as(db, pjoId, `select public.mgmt_review_hold($1, 'PJO, HSE Mgr')`, [m.id]));
  await expectError('23514', async () => as(db, pjoId, `select public.mgmt_review_item_save($1, 'resources', 'Mekanik kurang', 'Tambah 2 mekanik', true)`, [m.id]));
  const topics = (await db.query(`select code from public.management_review_topics where required`)).rows.map(r => r.code);
  for (const t of topics) await as(db, hseMgr, `select public.mgmt_review_item_save($1, $2, 'Dibahas', null, false)`, [m.id, t]);
  const item = (await as(db, pjoId, `select (i).id from public.mgmt_review_item_save($1, 'resources', 'Mekanik kurang', 'Tambah 2 mekanik', true, $2, $3) i`, [m.id, C23, PLT])).rows[0].id;
  await as(db, pjoId, `select public.mgmt_review_hold($1, 'PJO, HSE Manager, Dept Head PRD/PLT')`, [m.id]);
  eq((await db.query(`select performance_snapshot ? 'capa_open' ok from public.management_reviews where id = $1`, [m.id])).rows[0].ok, true);
  await expectError('42501', async () => as(db, hseMgr, `select public.mgmt_review_close($1, 'Selesai')`, [m.id]));
  await expectError('22023', async () => as(db, pjoId, `select public.mgmt_review_close($1, 'Selesai')`, [m.id]));
  await as(db, pjoId, `select public.capa_create('Rekrut 2 mekanik', 'Keputusan tinjauan manajemen', 'management_review', $1, 'medium', $2, $3, $4, $5::date,
    'improvement', null, 'management_review_items', $6)`, [C23, PLT, spvPlt, dhPlt, await due(30), item]);
  eq((await as(db, pjoId, `select (m).status from public.mgmt_review_close($1, 'Sistem berjalan; sumber daya Plant ditambah') m`, [m.id])).rows[0].status, 'closed');
});
await test('dashboard eksekutif & capaian elemen SMKP terbaca pengguna aktif', async () => {
  const k = (await as(db, spvPrd, `select * from public.executive_kpi`)).rows[0];
  eq(k.review_overdue, false); eq(k.findings_without_capa, 0);
  if (!(k.capa_open > 0 && k.audits_ytd >= 1)) throw new Error(JSON.stringify(k));
  eq((await as(db, spvPrd, `select count(*)::int c from public.smkp_element_status`)).rows[0].c, 7);
});

console.log('Spreadsheet: feed & impor');
const anon = async (sql, params = []) => {
  await db.query('begin');
  try { await db.query('set local role anon'); const r = await db.query(sql, params); await db.query('commit'); return r; }
  catch (e) { await db.query('rollback'); throw e; }
};
await test('feed Google Sheets: token pribadi (hanya hash disimpan), dataset terbatas, bisa dicabut', async () => {
  const token = (await as(db, logStaff, `select public.feed_token_create('Laporan logistik') t`)).rows[0].t;
  eq((await db.query(`select count(*)::int n from public.feed_tokens where token_hash = $1`, [token])).rows[0].n, 0);
  const rows = (await anon(`select public.feed_rows($1, 'stok') r`, [token])).rows[0].r;
  if (!rows.some(r => r.code === 'SP-FLT-01')) throw new Error('stok tidak ada di feed');
  await expectError('22023', async () => anon(`select public.feed_rows($1, 'pelanggaran')`, [token]));
  await expectError('42501', async () => anon(`select public.feed_rows('salah', 'stok')`));
  await expectError('42501', async () => anon(`select count(*) from public.feed_tokens`));
  const id = (await as(db, logStaff, `select id from public.feed_tokens where label = 'Laporan logistik'`)).rows[0].id;
  await expectError('P0002', async () => as(db, hrStaff, `select public.feed_token_revoke($1)`, [id]));
  await as(db, logStaff, `select public.feed_token_revoke($1)`, [id]);
  await expectError('42501', async () => anon(`select public.feed_rows($1, 'stok')`, [token]));
});
await test('impor massal: periksa tanpa menyimpan, baris gagal dilaporkan, impor menyimpan sisanya', async () => {
  const rows = JSON.stringify([
    { kode: 'imp-01', nama: 'Baut roda', kategori: 'Suku cadang', satuan: 'pcs', stok_min: '10' },
    { kode: 'imp-02', nama: 'Oli mesin', kategori: 'oli', satuan: 'L' },
    { kode: '', nama: 'Tanpa kode' },
  ]);
  const check = (await as(db, logHead, `select public.import_rows('barang', $1::jsonb, false) r`, [rows])).rows[0].r;
  eq(check.ok, 2); eq(check.errors.length, 1); eq(check.errors[0].row, 3);
  eq((await db.query(`select count(*)::int n from public.materials where code like 'IMP-%'`)).rows[0].n, 0);
  const done = (await as(db, logHead, `select public.import_rows('barang', $1::jsonb, true) r`, [rows])).rows[0].r;
  eq(done.ok, 2);
  eq((await db.query(`select category from public.materials where code = 'IMP-02'`)).rows[0].category, 'lubricant');
  const denied = (await as(db, pltStaff, `select public.import_rows('barang', $1::jsonb, true) r`, [rows])).rows[0].r;
  eq(denied.ok, 0); eq(denied.errors.length, 3);
  await expectError('22023', async () => as(db, logHead, `select public.import_rows('rahasia', '[{}]'::jsonb)`));
});
await test('impor karyawan & sertifikat memakai kode departemen, nama jabatan dan kode kompetensi', async () => {
  const emp = JSON.stringify([{ nrp: 'imp-100', nama: 'Rudi Impor', departemen: 'prd', jabatan: 'OPR-DT', status_kerja: 'Kontrak', tgl_masuk: '2026-02-01' },
    { nrp: 'imp-101', nama: 'Salah Dept', departemen: 'XYZ' }]);
  const r = (await as(db, hrStaff, `select public.import_rows('karyawan', $1::jsonb, true) r`, [emp])).rows[0].r;
  eq(r.ok, 1); if (!/XYZ/.test(r.errors[0].error)) throw new Error(r.errors[0].error);
  eq((await db.query(`select employment_type from public.employees where nrp = 'IMP-100'`)).rows[0].employment_type, 'contract');
  const cert = JSON.stringify([{ nrp: 'IMP-100', kompetensi: 'mcu', tgl_terbit: '2026-03-01', berlaku_sampai: '2027-03-01', no_sertifikat: 'MCU-9' }]);
  eq((await as(db, hrStaff, `select public.import_rows('sertifikat', $1::jsonb, true) r`, [cert])).rows[0].r.ok, 1);
});

await test('anon hanya bisa memanggil verifikasi dokumen & feed spreadsheet', async () => {
  const r = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`);
  eq(r.rows.map(x => x.proname).sort().join(','), 'feed_rows,verify_document');
});

console.log('HRIS: Core HR');
const selfUser = await createUser('operator.exc@bsb.co.id');
await db.query(`insert into public.user_roles(user_id, role_code, department_id) values ($1,'STAFF',$2)`, [selfUser, PRD]);
const OPREXC = await pos('OPR-EXC'), PGW = await pos('PGW-PRD');
let ops, boss;
await test('karyawan baru otomatis punya riwayat "join"; mutasi tercatat dengan alasan & SK', async () => {
  boss = (await as(db, hrStaff, EMP_SQL, ['BSB-100', 'Dedi Pengawas', PRD, PGW, 'permanent', null, null])).rows[0];
  ops = (await as(db, hrStaff, EMP_SQL, ['BSB-101', 'Eko Operator', PRD, OPRDT, 'contract', null, 'operator.exc@bsb.co.id'])).rows[0];
  eq((await db.query(`select kind from public.employee_movements where employee_id = $1`, [ops.id])).rows[0].kind, 'join');
  const MOVE = `select public.employee_move($1, $2::date, $3, $4, null, $5, null, $6, 'SK/HR/01')`;
  await expectError('42501', async () => as(db, spvPrd, MOVE, [ops.id, today, 'position_change', PRD, OPREXC, 'Rotasi unit']));
  await expectError('22023', async () => as(db, hrStaff, MOVE, [ops.id, today, 'position_change', PRD, OPREXC, '']));
  await expectError('22023', async () => as(db, hrStaff, MOVE, [ops.id, today, 'position_change', PRD, MEK, 'Salah dept']));
  await as(db, hrStaff, MOVE, [ops.id, today, 'position_change', PRD, OPREXC, 'Rotasi ke excavator']);
  const m = (await db.query(`select kind, reason, reference_no, from_position, to_position from public.movement_register where employee_id = $1 and kind <> 'join'`, [ops.id])).rows[0];
  eq(m.kind, 'position_change'); eq(m.reason, 'Rotasi ke excavator'); eq(m.reference_no, 'SK/HR/01'); eq(m.to_position, 'Operator excavator');
  // pengaturan sesi tidak bocor ke perubahan berikutnya
  await as(db, hrStaff, EMP_SQL, ['BSB-101', 'Eko Operator', PRD, OPRDT, 'contract', null, null]);
  eq((await db.query(`select reason from public.employee_movements where employee_id = $1 order by created_at desc limit 1`, [ops.id])).rows[0].reason, null);
});
await test('atasan langsung tidak boleh melingkar; atasan langsung bisa melihat riwayat bawahannya', async () => {
  const ORG = `select public.employee_org_save($1, $2, null, 'G3', '10/4', 'Balikpapan')`;
  await as(db, hrStaff, ORG, [ops.id, boss.id]);
  await expectError('22023', async () => as(db, hrStaff, ORG, [boss.id, ops.id]));
  eq((await db.query(`select kind from public.employee_movements where employee_id = $1 order by created_at desc limit 1`, [ops.id])).rows[0].kind, 'supervisor_change');
  eq((await as(db, selfUser, `select 1 from public.employee_movements where employee_id = $1`, [ops.id])).rowCount > 0, true);
  eq((await as(db, spvHse, `select 1 from public.employee_movements where employee_id = $1`, [ops.id])).rowCount, 0);
});
await test('data pribadi hanya HRGA & karyawan ybs; karyawan hanya boleh ubah kontak, bukan rekening', async () => {
  await as(db, hrStaff, `select public.employee_private_save($1, $2::jsonb)`, [ops.id, JSON.stringify({ nik: '6471010101900001', bank_account: '123', ptkp_status: 'K/1', birth_date: '1990-01-01' })]);
  await expectError('22023', async () => as(db, hrStaff, `select public.employee_private_save($1, '{"gaji":1}'::jsonb)`, [ops.id]));
  await expectError('23514', async () => as(db, hrStaff, `select public.employee_private_save($1, '{"nik":"123"}'::jsonb)`, [ops.id]));
  eq((await as(db, spvPrd, `select 1 from public.employee_private`)).rowCount, 0);
  eq((await as(db, selfUser, `select nik from public.employee_private`)).rows[0].nik, '6471010101900001');
  await as(db, selfUser, `select public.my_private_update('{"phone":"0812","shoe_size":"42"}'::jsonb)`);
  await expectError('42501', async () => as(db, selfUser, `select public.my_private_update('{"bank_account":"999"}'::jsonb)`));
  const r = (await db.query(`select phone, bank_account from public.employee_private where employee_id = $1`, [ops.id])).rows[0];
  eq(r.phone, '0812'); eq(r.bank_account, '123');
});
await test('NIK karyawan otomatis tanpa duplikat; No. KTP unik; profil lengkap menghitung umur & masa kerja', async () => {
  const a = (await as(db, hrStaff, EMP_SQL, [null, 'Karyawan Otomatis A', PRD, OPRDT, 'contract', null, null])).rows[0];
  const b = (await as(db, hrStaff, EMP_SQL, ['', 'Karyawan Otomatis B', PRD, OPRDT, 'contract', null, null])).rows[0];
  eq(/^\d{2}\.\d{2}\.\d{3}$/.test(a.nrp), true); eq(a.nrp !== b.nrp, true);
  // format YY.MM.NNN dari tanggal masuk; urutan per tahun
  const EMPJ = `select (e).* from public.employee_save($1, $2, $3, $4, $5, $6, $7::date, null) e`;
  const j = (await as(db, hrStaff, EMPJ, [null, 'Masuk 2031', PRD, OPRDT, 'contract', null, '2031-03-05'])).rows[0];
  eq(j.nrp, '31.03.001');
  const j2 = (await as(db, hrStaff, EMPJ, [null, 'Masuk 2031 B', PRD, OPRDT, 'contract', null, '2031-07-01'])).rows[0];
  eq(j2.nrp, '31.07.002');
  // nomor yang sudah terpakai (hasil impor, lintas bulan) dilompati
  await as(db, hrStaff, EMPJ, ['31.09.003', 'Impor Lama', PRD, OPRDT, 'contract', null, '2031-09-01']);
  const c = (await as(db, hrStaff, EMPJ, [null, 'Masuk 2031 C', PRD, OPRDT, 'contract', null, '2031-09-10'])).rows[0];
  eq(c.nrp, '31.09.004');
  await as(db, hrStaff, `select public.employee_private_save($1, $2::jsonb)`, [a.id, JSON.stringify({ nik: '6471010101900099', kelurahan: 'Gunung Bahagia', kecamatan: 'Balikpapan Selatan', kabupaten: 'Balikpapan', provinsi: 'Kalimantan Timur', sim_no: 'SIM-123', children_count: '2', birth_date: '1990-01-01' })]);
  await expectError('23505', async () => as(db, hrStaff, `select public.employee_private_save($1, $2::jsonb)`, [b.id, JSON.stringify({ nik: '6471010101900099' })]));
  await as(db, hrStaff, `select public.employee_classify($1, 'local', 'non_staff')`, [a.id]);
  await expectError('23514', async () => as(db, hrStaff, `select public.employee_classify($1, 'asing', null)`, [a.id]));
  await expectError('42501', async () => as(db, spvPrd, `select public.employee_classify($1, 'local', 'staff')`, [a.id]));
  const r = (await as(db, hrStaff, `select age, children_count, recruitment_origin, worker_class, provinsi from public.profile_register where employee_id = $1`, [a.id])).rows[0];
  eq(r.age >= 35, true); eq(r.children_count, 2); eq(r.recruitment_origin, 'local'); eq(r.worker_class, 'non_staff'); eq(r.provinsi, 'Kalimantan Timur');
});
await test('kontrak: PKWT wajib tanggal akhir, status kerja ikut kontrak, register menandai segera habis', async () => {
  await expectError('23514', async () => as(db, hrStaff, `select public.contract_add($1, 'pkwt', 'PKWT/1', $2::date, null)`, [ops.id, today]));
  await as(db, hrStaff, `select public.contract_add($1, 'pkwt', 'PKWT/1', $2::date - 340, $2::date + 20)`, [ops.id, today]);
  eq((await as(db, hrStaff, `select contract_status from public.contract_register where employee_id = $1`, [ops.id])).rows[0].contract_status, 'expiring');
  await as(db, hrStaff, `select public.contract_add($1, 'pkwtt', 'SK-TETAP/1', $2::date + 21, null)`, [ops.id, today]);
  eq((await db.query(`select employment_type from public.employees where id = $1`, [ops.id])).rows[0].employment_type, 'permanent');
  eq((await as(db, spvPrd, `select 1 from public.contract_register`)).rowCount, 0);
});
await test('MPP vs aktual per jabatan', async () => {
  const y = Number(today.slice(0, 4));
  await expectError('42501', async () => as(db, spvPrd, `select public.mpp_set($1, $2, 5)`, [y, OPRDT]));
  await as(db, hrStaff, `select public.mpp_set($1, $2, 5, 'Tambahan 2 DT')`, [y, OPRDT]);
  const g = (await as(db, spvPrd, `select planned, actual, gap from public.manpower_gap where year = $1 and position_id = $2`, [y, OPRDT])).rows[0];
  eq(g.planned, 5); eq(g.gap, g.actual - 5);
});
await test('MCU unfit membatalkan kelayakan: SIMPER & ID card ditolak sampai fit', async () => {
  await as(db, hrStaff, ADD_SQL, [ops.id, INDUKSI, today, null, null]);
  const mcu = (await as(db, hrStaff, ADD_SQL, [ops.id, MCU, today, null, 'MCU-77'])).rows[0];
  const DET = `select public.employee_competency_detail($1, $2, $3, null)`;
  await expectError('22023', async () => as(db, hrStaff, DET, [mcu.id, 'temporary_unfit', '']));
  await as(db, hrStaff, DET, [mcu.id, 'temporary_unfit', 'Hipertensi, kontrol 2 minggu']);
  eq((await db.query(`select validity from public.employee_competency_view where id = $1`, [mcu.id])).rows[0].validity, 'unfit');
  await expectError('22023', async () => as(db, hrStaff, ADD_SQL, [ops.id, SIMDT, today, null, 'SIM-9']));
  await expectError('22023', async () => as(db, hrStaff, `select public.id_card_issue($1, 'ID-101', '{PIT}')`, [ops.id]));
  await as(db, hrStaff, DET, [mcu.id, 'fit', null]);
  const sim = (await as(db, hrStaff, ADD_SQL, [ops.id, SIMDT, today, null, 'SIM-9'])).rows[0];
  await expectError('22023', async () => as(db, hrStaff, `select public.employee_competency_detail($1, 'fit', null, null)`, [sim.id]));
  await as(db, hrStaff, `select public.employee_competency_detail($1, null, null, 'B')`, [sim.id]);
});
await test('ID card: area harus dikenal, satu kartu aktif, ditangguhkan otomatis saat karyawan keluar', async () => {
  await expectError('22023', async () => as(db, hrStaff, `select public.id_card_issue($1, 'ID-101', '{BULAN}')`, [ops.id]));
  await as(db, hrStaff, `select public.id_card_issue($1, 'id-101', '{PIT,HAULING}')`, [ops.id]);
  await expectError('22023', async () => as(db, hrStaff, `select public.id_card_issue($1, 'ID-102', '{PIT}')`, [ops.id]));
  const w = (await as(db, spvPrd, `select ready, id_card_ok, unit_types from public.workforce_readiness where employee_id = $1`, [ops.id])).rows[0];
  eq(w.id_card_ok, true); eq(w.unit_types.join(), 'DT');
  const a = (await as(db, spvPrd, `select authorized from public.operator_availability where unit_type = 'DT'`)).rows[0];
  eq(a.authorized >= 1, true);
});
await test('mobilisasi: checklist manual + otomatis (induksi, MCU, ID card) wajib lengkap sebelum selesai', async () => {
  const m = (await as(db, hrStaff, `select (m).* from public.mobilization_create($1, 'mob', $2::date) m`, [boss.id, today])).rows[0];
  await expectError('22023', async () => as(db, hrStaff, `select public.mobilization_create($1, 'mob', $2::date)`, [boss.id, today]));
  for (const i of m.items) await as(db, hrStaff, `select public.mobilization_check($1, $2, true)`, [m.id, i.key]);
  try { await as(db, hrStaff, `select public.mobilization_complete($1)`, [m.id]); throw new Error('harus gagal'); }
  catch (e) { if (!/induksi/.test(e.message) || !/ID card/.test(e.message)) throw e; }
  eq((await as(db, selfUser, `select 1 from public.mobilizations where id = $1`, [m.id])).rowCount, 0);
  await as(db, hrStaff, `select public.mobilization_cancel($1, 'Batal berangkat')`, [m.id]);
});
await test('impor satu tombol: data pribadi & kontrak lewat NRP', async () => {
  const rows = JSON.stringify([{ nrp: 'bsb-100', nik: '6471-0101-0190-0002', jenis_kelamin: 'Laki-laki', ptkp: 'k / 2', no_rekening: '123-456' },
    { nrp: 'TIDAKADA', nik: '1' }]);
  const r = (await as(db, hrStaff, `select public.import_rows('data_pribadi', $1::jsonb, true) r`, [rows])).rows[0].r;
  eq(r.ok, 1); eq(r.errors.length, 1);
  const p = (await db.query(`select nik, gender, ptkp_status, bank_account from public.employee_private where employee_id = $1`, [boss.id])).rows[0];
  eq(p.nik, '6471010101900002'); eq(p.gender, 'L'); eq(p.ptkp_status, 'K/2'); eq(p.bank_account, '123456');
  const pf = JSON.stringify([{ nrp: 'BSB-100', gol_darah: 'o', status_nikah: 'Menikah', jumlah_anak: '3', kelurahan: 'Margasari', kecamatan: 'Balikpapan Barat',
    kabupaten: 'Balikpapan', provinsi: 'Kalimantan Timur', no_sim: 'SIM-77', penerimaan: 'Non lokal', golongan_karyawan: 'Staff' }]);
  eq((await as(db, hrStaff, `select public.import_rows('data_pribadi', $1::jsonb, true) r`, [pf])).rows[0].r.ok, 1);
  const q = (await db.query(`select pr.blood_type, pr.marital_status, pr.children_count, pr.kelurahan, pr.sim_no, e.recruitment_origin, e.worker_class
    from public.employee_private pr join public.employees e on e.id = pr.employee_id where e.id = $1`, [boss.id])).rows[0];
  eq(q.blood_type, 'O'); eq(q.marital_status, 'married'); eq(q.children_count, 3); eq(q.kelurahan, 'Margasari'); eq(q.sim_no, 'SIM-77');
  eq(q.recruitment_origin, 'non_local'); eq(q.worker_class, 'staff');
  const k = JSON.stringify([{ nrp: 'BSB-100', jenis: 'Tetap', no_kontrak: 'SK/9', mulai: '2025-01-01' }]);
  eq((await as(db, hrStaff, `select public.import_rows('kontrak', $1::jsonb, true) r`, [k])).rows[0].r.ok, 1);
  eq((await as(db, spvPrd, `select public.import_rows('data_pribadi', $1::jsonb, true) r`, [rows])).rows[0].r.ok, 0);
  const o = JSON.stringify([{ nrp: 'BSB-002', atasan: 'bsb-100', pola_roster: '10/4' }, { nrp: 'BSB-002', atasan: 'X-1' }]);
  const ro = (await as(db, hrStaff, `select public.import_rows('organisasi', $1::jsonb, true) r`, [o])).rows[0].r;
  eq(ro.ok, 1); eq(ro.errors[0].error.includes('X-1'), true);
  eq((await db.query(`select supervisor_id from public.employees where nrp = 'BSB-002'`)).rows[0].supervisor_id, boss.id);
  const c = JSON.stringify([{ nrp: 'BSB-100', no_kartu: 'idc-100', area: 'office; pit' }]);
  eq((await as(db, hrStaff, `select public.import_rows('idcard', $1::jsonb, true) r`, [c])).rows[0].r.errors[0].error.includes('induksi'), true);
});
await test('karyawan keluar: riwayat "exit" dan ID card ditangguhkan', async () => {
  await as(db, hrHead, `select public.employee_exit($1, $2::date, 'Habis kontrak')`, [ops.id, today]);
  eq((await db.query(`select status from public.id_cards where employee_id = $1`, [ops.id])).rows[0].status, 'suspended');
  eq((await db.query(`select reason from public.employee_movements where employee_id = $1 and kind = 'exit'`, [ops.id])).rows[0].reason, 'Habis kontrak');
});

console.log('HRIS: Waktu (absensi, cuti, lembur)');
const absUser = await createUser('operator.absen@bsb.co.id');
await db.query(`insert into public.user_roles(user_id, role_code, department_id) values ($1,'STAFF',$2)`, [absUser, PRD]);
const wk = (await as(db, hrStaff, EMP_SQL, ['BSB-102', 'Fajar Operator', PRD, OPRDT, 'permanent', null, 'operator.absen@bsb.co.id'])).rows[0];
const ROSTER = `select public.roster_set(array[$1]::uuid[], $2::date, $3::date, $4)`;
await test('absen aplikasi: selfie wajib, di luar radius ditandai (mode flag) atau ditolak (mode reject), tidak dobel', async () => {
  const CLOCK = `select (a).* from public.attendance_clock($1, $2, $3, 15, $4, 'test') a`;
  await expectError('42501', async () => as(db, absUser, `select public.attendance_location_save(null, 'Pit', -1, 116, 300)`));
  await as(db, hrStaff, `select public.attendance_location_save(null, 'Office BDA', -1.000000, 116.000000, 300)`);
  await expectError('22023', async () => as(db, absUser, CLOCK, ['in', -1.0005, 116.0005, null]));
  await expectError('22023', async () => as(db, absUser, CLOCK, ['in', null, null, (await upload(absUser)).id]));
  const far = (await as(db, absUser, CLOCK, ['in', -1.02, 116.0, (await upload(absUser)).id])).rows[0];
  eq(far.in_geofence, false); eq(far.distance_m > 2000, true);
  await expectError('22023', async () => as(db, absUser, CLOCK, ['in', -1.0, 116.0, (await upload(absUser)).id]));
  await db.query(`update public.app_settings set value = '"reject"' where key = 'attendance_geofence_mode'`);
  await expectError('22023', async () => as(db, absUser, CLOCK, ['out', -1.02, 116.0, (await upload(absUser)).id]));
  const near = (await as(db, absUser, CLOCK, ['out', -1.0005, 116.0005, (await upload(absUser)).id])).rows[0];
  eq(near.in_geofence, true);
  await db.query(`update public.app_settings set value = '"flag"' where key = 'attendance_geofence_mode'`);
  // karyawan lain dari departemen lain tidak melihat log absen
  eq((await as(db, spvHse, `select 1 from public.attendance_logs where employee_id = $1`, [wk.id])).rowCount, 0);
  eq((await as(db, spvPrd, `select 1 from public.attendance_logs where employee_id = $1`, [wk.id])).rowCount, 2);
});
await test('absen tanpa GPS wajib alasan & ditandai; waktu dari antrean offline dibatasi; kiriman ganda ditolak lewat client_requests', async () => {
  const NOGPS = `select (a).* from public.attendance_clock($1, null, null, null, $2, 'test', $3::timestamptz, $4) a`;
  await expectError('22023', async () => as(db, absUser, NOGPS, ['in', (await upload(absUser)).id, new Date(Date.now() - 36e5 * 30).toISOString(), null]));
  await expectError('22023', async () => as(db, absUser, NOGPS, ['in', (await upload(absUser)).id, new Date(Date.now() - 36e5 * 24 * 5).toISOString(), 'GPS mati']));
  await expectError('22023', async () => as(db, absUser, NOGPS, ['in', (await upload(absUser)).id, new Date(Date.now() + 36e5).toISOString(), 'GPS mati']));
  const r = (await as(db, absUser, NOGPS, ['in', (await upload(absUser)).id, new Date(Date.now() - 36e5 * 30).toISOString(), 'GPS mati di pit'])).rows[0];
  eq(r.note, 'TANPA GPS: GPS mati di pit'); eq(r.lat, null); eq(r.in_geofence, null);
  const id = '11111111-2222-4333-8444-555555555555';
  eq((await as(db, absUser, `select public.client_request_claim($1) c`, [id])).rows[0].c, true);
  eq((await as(db, absUser, `select public.client_request_claim($1) c`, [id])).rows[0].c, false);
  await as(db, absUser, `select public.client_request_release($1)`, [id]);
  eq((await as(db, absUser, `select public.client_request_claim($1) c`, [id])).rows[0].c, true);
  // pengguna lain tidak bisa melepas kiriman milik orang lain
  await as(db, spvPrd, `select public.client_request_release($1)`, [id]);
  eq((await as(db, absUser, `select public.client_request_claim($1) c`, [id])).rows[0].c, false);
  await expectError('42501', () => as(db, absUser, `select * from public.client_requests`));
});
await test('login NIK: pendaftar pending, admin lihat kecocokan tanggal lahir, aktivasi menautkan karyawan, tanggal lahir dihapus', async () => {
  const emp = (await as(db, hrStaff, EMP_SQL, ['BSB-777', 'Budi NIK', PRD, OPRDT, 'permanent', null, null])).rows[0];
  const reg = async (nrp, birth, tag = '') => {
    const id = randomUUID();
    await db.query(`insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [id, `${nrp.toLowerCase()}${tag}@nrp.bsb.local`, { full_name: 'Pendaftar', nrp, birth_date: birth }]);
    return id;
  };
  const u1 = await reg('BSB-777', '1990-05-17');
  eq((await db.query(`select status from public.profiles where id = $1`, [u1])).rows[0].status, 'pending');
  eq((await db.query(`select raw_user_meta_data ? 'birth_date' b from auth.users where id = $1`, [u1])).rows[0].b, false);
  // palsu: bukan email NIK tidak membuat klaim
  const fake = randomUUID();
  await db.query(`insert into auth.users(id, email, raw_user_meta_data) values ($1, 'x@gmail.com', $2)`, [fake, { nrp: 'BSB-777', birth_date: '1990-05-17' }]);
  eq((await db.query(`select count(*)::int c from public.nik_registrations where user_id = $1`, [fake])).rows[0].c, 0);
  await expectError('42501', () => as(db, staffId, `select * from public.nik_pending()`));
  await expectError('42501', () => as(db, u1, `select public.activate_nik_user($1, 'STAFF', null, null)`, [u1]));
  // tanggal lahir karyawan belum diisi
  await expectError('22023', () => as(db, adminId, `select public.activate_nik_user($1, 'STAFF', $2, 'SK')`, [u1, PRD]));
  await db.query(`insert into public.employee_private(employee_id, birth_date) values ($1, '1990-05-17') on conflict (employee_id) do update set birth_date = '1990-05-17'`, [emp.id]);
  await expectError('22023', () => as(db, adminId, `select public.activate_user($1, 'STAFF', $2, 'SK')`, [u1, PRD]));
  const pend = (await as(db, adminId, `select * from public.nik_pending() where user_id = $1`, [u1])).rows[0];
  eq(pend.employee_name, 'Budi NIK'); eq(pend.birth_match, true); eq(pend.already_linked, false);
  eq(Object.keys(pend).includes('birth_date'), false);
  // tanggal lahir salah ditolak
  const u2 = await reg('BSB-777', '1991-01-01', 'b');
  eq((await as(db, adminId, `select birth_match from public.nik_pending() where user_id = $1`, [u2])).rows[0].birth_match, false);
  await expectError('22023', () => as(db, adminId, `select public.activate_nik_user($1, 'STAFF', $2, 'SK')`, [u2, PRD]));
  await as(db, adminId, `select public.activate_nik_user($1, 'STAFF', $2, 'SK 1')`, [u1, PRD]);
  const p1 = (await db.query(`select status, full_name from public.profiles where id = $1`, [u1])).rows[0];
  eq(p1.status, 'active'); eq(p1.full_name, 'Budi NIK');
  eq((await db.query(`select profile_id from public.employees where id = $1`, [emp.id])).rows[0].profile_id, u1);
  eq((await db.query(`select count(*)::int c from public.nik_registrations where user_id = $1`, [u1])).rows[0].c, 0);
  // NRP yang sudah tertaut tidak bisa dipakai akun kedua
  const u3 = await reg('BSB-777', '1990-05-17', 'c');
  await expectError('23505', () => as(db, adminId, `select public.activate_nik_user($1, 'STAFF', $2, 'SK')`, [u3, PRD]));
  await expectError('22023', () => as(db, adminId, `select public.reject_nik_user($1, '')`, [u3]));
  await as(db, adminId, `select public.reject_nik_user($1, 'Bukan karyawan')`, [u3]);
  eq((await db.query(`select status from public.profiles where id = $1`, [u3])).rows[0].status, 'suspended');
  // reset sandi: hanya akun NIK aktif, bukan diri sendiri, hanya yang berwenang
  eq((await as(db, adminId, `select public.password_reset_authorize($1) e`, [u1])).rows[0].e, 'bsb-777@nrp.bsb.local');
  await expectError('22023', () => as(db, adminId, `select public.password_reset_authorize($1)`, [staffId]));
  await expectError('42501', () => as(db, staffId, `select public.password_reset_authorize($1)`, [u1]));
  await expectError('42501', () => as(db, adminId, `select public.password_reset_authorize($1)`, [adminId]));
});
await test('impor mesin fingerprint: masuk/pulang ditentukan otomatis, terlambat dihitung, impor ulang tidak dobel', async () => {
  const d = await due(-3);
  await as(db, spvPrd, ROSTER, [boss.id, d, d, 'D']);
  const rows = JSON.stringify([{ nrp: 'BSB-100', waktu: `${d} 06:20` }, { nrp: 'BSB-100', tanggal: d, jam: '12:00' }, { nrp: 'BSB-100', waktu: `${d} 18:05`, mesin: 'FP-1' }]);
  eq((await as(db, spvPrd, `select public.import_rows('absensi', $1::jsonb, true) r`, [rows])).rows[0].r.ok, 0);
  const ri = (await as(db, hrStaff, `select public.import_rows('absensi', $1::jsonb, true) r`, [rows])).rows[0].r;
  if (ri.ok !== 3) throw new Error(JSON.stringify(ri.errors));
  await as(db, hrStaff, `select public.import_rows('absensi', $1::jsonb, true) r`, [rows]);
  eq((await db.query(`select count(*)::int c from public.attendance_logs where employee_id = $1`, [boss.id])).rows[0].c, 3);
  const a = (await as(db, spvPrd, `select status, late_minutes, worked_hours, punches from public.attendance_daily where employee_id = $1 and work_date = $2::date`, [boss.id, d])).rows[0];
  eq(a.status, 'terlambat'); eq(a.late_minutes, 20); eq(Number(a.worked_hours), 11.75); eq(a.punches, 3);
  // jadwal D tanpa absen = alpa; koreksi manual wajib keterangan
  const d2 = await due(-2);
  await as(db, spvPrd, ROSTER, [boss.id, d2, d2, 'D']);
  eq((await as(db, spvPrd, `select status from public.attendance_daily where employee_id = $1 and work_date = $2::date`, [boss.id, d2])).rows[0].status, 'alpa');
  const MAN = `select public.attendance_manual($1, ($2::date + time '06:00') at time zone app.site_tz(), 'in', $3)`;
  await expectError('22023', async () => as(db, spvPrd, MAN, [boss.id, d2, '']));
  await expectError('42501', async () => as(db, spvHse, MAN, [boss.id, d2, 'Lupa absen']));
  await as(db, spvPrd, MAN, [boss.id, d2, 'Mesin mati']);
  eq((await as(db, spvPrd, `select status from public.attendance_daily where employee_id = $1 and work_date = $2::date`, [boss.id, d2])).rows[0].status, 'hadir');
});
let leave;
await test('cuti: hitung hari kerja dari roster, saldo & bentrok dicek, dua tahap (atasan lalu HRGA), roster terisi CUTI', async () => {
  const y = Number(today.slice(0, 4)) + 1, s = `${y}-03-02`, e = `${y}-03-06`;
  await as(db, spvPrd, ROSTER, [wk.id, s, `${y}-03-04`, 'D']);
  await as(db, spvPrd, ROSTER, [wk.id, `${y}-03-05`, e, 'OFF']);
  const CREATE = `select (l).* from public.leave_request_create(null, $1, $2::date, $3::date, $4) l`;
  await expectError('22023', async () => as(db, absUser, CREATE, ['SKT', s, s, 'Demam']));
  await as(db, hrStaff, `select public.employee_private_save($1, '{"gender":"L"}'::jsonb)`, [wk.id]);
  await expectError('22023', async () => as(db, absUser, CREATE, ['CHD', s, s, 'Haid']));
  await expectError('22023', async () => as(db, absUser, CREATE, ['CT', `${y}-12-30`, `${y + 1}-01-02`, 'Liburan']));
  leave = (await as(db, absUser, CREATE, ['CT', s, e, 'Pulang kampung'])).rows[0];
  eq(Number(leave.days), 3); eq(leave.request_no.startsWith(`CUTI-BSB-${y}-`), true);
  await expectError('22023', async () => as(db, absUser, CREATE, ['CT', e, e, 'Bentrok']));
  // saldo 12 - 3 = 9; pengajuan 10 hari kerja ditolak
  await expectError('22023', async () => as(db, absUser, CREATE, ['CT', `${y}-04-06`, `${y}-04-17`, 'Terlalu banyak']));
  await expectError('42501', async () => as(db, spvHse, `select public.leave_request_decide($1, true)`, [leave.id]));
  await expectError('42501', async () => as(db, absUser, `select public.leave_request_decide($1, true)`, [leave.id]));
  eq((await as(db, spvPrd, `select can_decide from public.leave_register where id = $1`, [leave.id])).rows[0].can_decide, true);
  eq((await as(db, spvPrd, `select (l).status from public.leave_request_decide($1, true) l`, [leave.id])).rows[0].status, 'approved_1');
  await expectError('42501', async () => as(db, spvPrd, `select public.leave_request_decide($1, true)`, [leave.id]));
  eq((await as(db, hrStaff, `select (l).status from public.leave_request_decide($1, true) l`, [leave.id])).rows[0].status, 'approved');
  const codes = (await db.query(`select string_agg(code, ',' order by work_date) c from public.roster_entries where employee_id = $1 and work_date between $2 and $3`, [wk.id, s, e])).rows[0].c;
  eq(codes, 'CUTI,CUTI,CUTI,OFF,OFF');
  eq((await as(db, spvHse, `select 1 from public.leave_requests where id = $1`, [leave.id])).rowCount, 0);
  eq((await db.query(`select count(*)::int c from public.notifications where user_id = $1 and title like '%disetujui'`, [absUser])).rows[0].c, 1);
});
await test('cuti: tolak wajib alasan; batal sebelum berjalan; saldo awal lewat impor', async () => {
  const y = Number(today.slice(0, 4)) + 1;
  const l2 = (await as(db, absUser, `select (l).* from public.leave_request_create(null, 'IZN', $1::date, $1::date, 'Urusan keluarga') l`, [`${y}-05-04`])).rows[0];
  await expectError('22023', async () => as(db, spvPrd, `select public.leave_request_decide($1, false, '')`, [l2.id]));
  eq((await as(db, spvPrd, `select (l).status from public.leave_request_decide($1, false, 'Jadwal padat') l`, [l2.id])).rows[0].status, 'rejected');
  await expectError('42501', async () => as(db, absUser, `select public.leave_request_cancel($1)`, [leave.id]));
  await as(db, hrStaff, `select public.leave_request_cancel($1)`, [leave.id]);
  eq((await db.query(`select count(*)::int c from public.roster_entries where employee_id = $1 and code = 'CUTI'`, [wk.id])).rows[0].c, 0);
  const rows = JSON.stringify([{ nrp: 'BSB-102', jenis: 'CT', hari: '-2', keterangan: 'Sudah diambil Jan–Okt' }, { nrp: 'BSB-102', jenis: 'IZN', hari: 1 }]);
  const r = (await as(db, hrStaff, `select public.import_rows('saldo_cuti', $1::jsonb, true) r`, [rows])).rows[0].r;
  eq(r.ok, 1); eq(r.errors.length, 1);
  eq(Number((await as(db, absUser, `select available from public.leave_balance where leave_type = 'CT'`)).rows[0].available), 10);
});
await test('lembur (SPL): batas jam per hari & minggu, tidak bentrok, disetujui atasan bukan pembuat', async () => {
  await as(db, spvPrd, ROSTER, [wk.id, today, today, 'D']);
  const SPL = `select (o).* from public.overtime_request_create(null, $1::date, $2::time, $3::time, 'Perbaikan jalan hauling') o`;
  await expectError('22023', async () => as(db, absUser, SPL, [today, '18:00', '23:00']));
  const o = (await as(db, absUser, SPL, [today, '18:00', '21:00'])).rows[0];
  eq(Number(o.hours), 3); eq(o.day_type, 'workday'); eq(o.request_no.startsWith('LBR-BSB-'), true);
  await expectError('22023', async () => as(db, absUser, SPL, [today, '20:00', '22:00']));
  await db.query(`update public.app_settings set value = '4' where key = 'overtime_max_week_hours'`);
  await expectError('22023', async () => as(db, absUser, SPL, [today, '22:00', '23:30']));
  await db.query(`update public.app_settings set value = '18' where key = 'overtime_max_week_hours'`);
  await expectError('22023', async () => as(db, absUser, SPL, [await due(-10), '18:00', '20:00']));
  await expectError('42501', async () => as(db, absUser, `select public.overtime_request_decide($1, true)`, [o.id]));
  await expectError('42501', async () => as(db, spvHse, `select public.overtime_request_decide($1, true)`, [o.id]));
  eq((await as(db, spvPrd, `select (o).status from public.overtime_request_decide($1, true) o`, [o.id])).rows[0].status, 'approved');
  // hari OFF = hari istirahat, batas 11 jam
  const d = await due(1);
  await as(db, spvPrd, ROSTER, [wk.id, d, d, 'OFF']);
  const r = (await as(db, spvPrd, `select (o).* from public.overtime_request_create($1, $2::date, '07:00', '17:00', 'Overhaul') o`, [wk.id, d])).rows[0];
  eq(r.day_type, 'restday');
  await expectError('42501', async () => as(db, spvPrd, `select public.overtime_request_decide($1, true)`, [r.id]));
  await as(db, absUser, `select public.overtime_request_cancel($1)`, [r.id]);
});

console.log('HRIS: Payroll');
const payOff = await createUser('payroll@bsb.co.id');
const payApp = await createUser('fin.mgr@bsb.co.id');
const payEmpUser = await createUser('gilang@bsb.co.id');
await db.query(`insert into public.user_roles(user_id, role_code, department_id) values ($1,'PAYROLL_OFFICER',null), ($2,'PAYROLL_APPROVER',null), ($3,'STAFF',$4)`,
  [payOff, payApp, payEmpUser, PRD]);
const pe = (await as(db, hrStaff, EMP_SQL, ['BSB-200', 'Gilang Payroll', PRD, OPRDT, 'permanent', null, 'gilang@bsb.co.id'])).rows[0];
await db.query(`update public.employees set join_date = '2025-01-01' where id = $1`, [pe.id]);
const PAYSET = `select public.employee_pay_set($1, $2, $3, '2026-01-01')`;
const slipOf = async run => (await db.query(`select * from public.payroll_slip_register where run_id = $1 and employee_id = $2`, [run, pe.id])).rows[0];
const RUN = `select (r).* from public.payroll_run_create($1, $2, $3::date, $4) r`;
let run;
await test('struktur gaji hanya oleh bagian payroll; HRGA biasa tidak melihat nominal gaji', async () => {
  await expectError('42501', async () => as(db, hrStaff, PAYSET, [pe.id, 'GP', 8000000]));
  for (const [c, v] of [['GP', 8000000], ['TJAB', 1000000], ['TMAKAN', 50000]]) await as(db, payOff, PAYSET, [pe.id, c, v]);
  await expectError('22023', async () => as(db, payOff, PAYSET, [pe.id, 'KASBON', 1]));
  eq((await as(db, hrStaff, `select 1 from public.employee_pay`)).rowCount, 0);
  eq(Number((await as(db, payApp, `select fixed_wage from public.employee_pay_current where employee_id = $1`, [pe.id])).rows[0].fixed_wage), 9000000);
  await as(db, hrStaff, `select public.employee_private_save($1, '{"ptkp_status":"TK/0","bank_name":"BRI","bank_account":"0011"}'::jsonb)`, [pe.id]);
});
await test('gaji bulanan: BPJS dan PPh 21 TER kategori A (PP 58/2023), potongan kasbon', async () => {
  await expectError('42501', async () => as(db, hrStaff, RUN, ['2027-03', 'regular', '2027-03-25', false]));
  run = (await as(db, payOff, RUN, ['2027-03', 'regular', '2027-03-25', false])).rows[0];
  eq(run.att_from.toISOString ? run.att_from.toISOString().slice(0, 10) : run.att_from, '2027-02-21');
  await expectError('22023', async () => as(db, payOff, RUN, ['2027-03', 'regular', '2027-03-25', false]));
  await expectError('22023', async () => as(db, payOff, `select public.payroll_input_add($1, $2, 'GP', 1)`, [run.id, pe.id]));
  await as(db, payOff, `select public.payroll_input_add($1, $2, 'KASBON', 200000, 'Kasbon Feb')`, [run.id, pe.id]);
  await as(db, payOff, `select public.payroll_calculate($1)`, [run.id]);
  const s = await slipOf(run.id);
  eq(Number(s.fixed_wage), 9000000); eq(Number(s.earnings), 9000000);
  eq(Number(s.gross_tax), 9501300); eq(Number(s.ter_rate), 1.75); eq(Number(s.pph21), 166272);
  eq(Number(s.bpjs_ee), 360000); eq(Number(s.bpjs_er), 1014300); eq(Number(s.net), 8273728);
  eq(s.warnings.some(w => w.includes('absensi')), true);
  eq((await as(db, payEmpUser, `select 1 from public.payroll_slips`)).rowCount, 0);
  eq((await as(db, hrStaff, `select 1 from public.payroll_slips`)).rowCount, 0);
});
await test('gaji disetujui orang lain, lalu slip terbit hanya untuk karyawan ybs', async () => {
  await expectError('42501', async () => as(db, payOff, `select public.payroll_approve($1)`, [run.id]));
  await expectError('22023', async () => as(db, payOff, `select public.payroll_publish($1)`, [run.id]));
  await as(db, payApp, `select public.payroll_approve($1)`, [run.id]);
  await expectError('22023', async () => as(db, payOff, `select public.payroll_calculate($1)`, [run.id]));
  await as(db, payOff, `select public.payroll_publish($1)`, [run.id]);
  eq((await as(db, payEmpUser, `select net from public.payroll_slips`)).rows.length, 1);
  eq((await as(db, payEmpUser, `select 1 from public.payroll_lines`)).rowCount > 3, true);
  eq((await as(db, absUser, `select 1 from public.payroll_slips`)).rowCount, 0);
  eq((await db.query(`select count(*)::int c from public.notifications where user_id = $1 and kind = 'payroll'`, [payEmpUser])).rows[0].c, 1);
});
await test('THR: masa kerja >= 12 bulan = 1 bulan upah tetap; PPh TER atas gabungan gaji + THR di bulan yang sama', async () => {
  const thr = (await as(db, payOff, RUN, ['2027-03', 'thr', '2027-03-25', false])).rows[0];
  await as(db, payOff, `select public.payroll_calculate($1)`, [thr.id]);
  const s = await slipOf(thr.id);
  eq(Number(s.earnings), 9000000); eq(Number(s.bpjs_ee), 0); eq(Number(s.ter_rate), 8); eq(Number(s.pph21), 1313832);
});
await test('masa pajak Desember: PPh 21 setahun tarif Pasal 17 dikurangi PPh yang sudah dipotong', async () => {
  await as(db, payOff, `select public.payroll_ytd_set($1, 2028, 104514300, 1828992, 2970000, 11)`, [pe.id]);
  const dec = (await as(db, payOff, RUN, ['2028-12', 'regular', '2028-12-25', false])).rows[0];
  await as(db, payOff, `select public.payroll_calculate($1)`, [dec.id]);
  const s = await slipOf(dec.id);
  eq(s.annualized, true); eq(Number(s.pph21), 724708);
  const pkp = (await db.query(`select amount from public.payroll_lines l join public.payroll_slips s on s.id = l.slip_id where s.run_id = $1 and l.code = 'Y_PKP'`, [dec.id])).rows[0];
  eq(Number(pkp.amount), 51074000);
});
await test('lembur dari SPL disetujui: upah sejam 1/173 upah tetap, jam pertama x1,5 berikutnya x2', async () => {
  await as(db, spvPrd, ROSTER, [pe.id, today, today, 'D']);
  const o = (await as(db, payEmpUser, `select (o).* from public.overtime_request_create(null, $1::date, '18:00', '21:00', 'Bongkar muat') o`, [today])).rows[0];
  await as(db, spvPrd, `select public.overtime_request_decide($1, true)`, [o.id]);
  const period = (await db.query(`select to_char(app.site_today() + case when extract(day from app.site_today()) > 20 then interval '1 month' else interval '0' end, 'YYYY-MM') p`)).rows[0].p;
  const r = (await as(db, payOff, RUN, [period, 'regular', today, true])).rows[0];
  await as(db, payOff, `select public.payroll_calculate($1)`, [r.id]);
  const l = (await db.query(`select l.amount, l.qty from public.payroll_lines l join public.payroll_slips s on s.id = l.slip_id where s.run_id = $1 and s.employee_id = $2 and l.code = 'LEMBUR'`, [r.id, pe.id])).rows[0];
  eq(Number(l.qty), 5.5); eq(Number(l.amount), 286127);
  // hadir 0 hari karena tanpa absen: uang makan tidak dibayar, hari D tanpa absen = alpa dipotong 1/25
  const pot = (await db.query(`select l.amount from public.payroll_lines l join public.payroll_slips s on s.id = l.slip_id where s.run_id = $1 and s.employee_id = $2 and l.code = 'POTABS'`, [r.id, pe.id])).rows[0];
  eq(Number(pot.amount), -360000);
});
await test('uji paralel: hasil sistem lama dibandingkan per karyawan dan tidak diterbitkan', async () => {
  const p = (await as(db, payOff, RUN, ['2027-04', 'regular', '2027-04-25', true])).rows[0];
  await as(db, payOff, `select public.payroll_calculate($1)`, [p.id]);
  const rows = JSON.stringify([{ periode: '2027-04', nrp: 'BSB-200', gaji_bersih: '8.500.000', pph21: '170000' }]);
  eq((await as(db, payOff, `select public.import_rows('gaji_lama', $1::jsonb, true) r`, [rows])).rows[0].r.ok, 1);
  const s = await slipOf(p.id);
  eq(Number(s.diff_net), Number(s.net) - 8500000); eq(Number(s.net), 8473728);
  await as(db, payApp, `select public.payroll_approve($1)`, [p.id]);
  await expectError('22023', async () => as(db, payOff, `select public.payroll_publish($1)`, [p.id]));
});
await test('impor struktur gaji: nominal berformat titik, komponen input per proses ditolak', async () => {
  const rows = JSON.stringify([{ nrp: 'BSB-200', komponen: 'tsite', nilai: '1.500.000', berlaku_mulai: '2027-05-01' },
    { nrp: 'BSB-200', komponen: 'KASBON', nilai: '1', berlaku_mulai: '2027-05-01' }]);
  const r = (await as(db, payOff, `select public.import_rows('gaji', $1::jsonb, true) r`, [rows])).rows[0].r;
  eq(r.ok, 1); eq(r.errors.length, 1);
  eq((await as(db, hrStaff, `select public.import_rows('gaji', $1::jsonb, true) r`, [rows])).rows[0].r.ok, 0);
});
await test('pengaturan payroll: hanya kunci yang diizinkan, tanggal tutup <= 28, butuh payroll.manage', async () => {
  await as(db, payOff, `select public.payroll_setting_set('bpjs_jkk_er', 0.54)`);
  eq(Number((await db.query(`select value from public.app_settings where key = 'bpjs_jkk_er'`)).rows[0].value), 0.54);
  await as(db, payOff, `select public.payroll_setting_set('bpjs_jkk_er', 1.27)`);
  await expectError('22023', async () => as(db, payOff, `select public.payroll_setting_set('mr_high_value_limit', 1)`));
  await expectError('22023', async () => as(db, payOff, `select public.payroll_setting_set('payroll_cutoff_day', 30)`));
  await expectError('42501', async () => as(db, payApp, `select public.payroll_setting_set('bpjs_jkk_er', 1)`));
});

console.log('HRIS: Klaim & kasbon');
{
  const CLAIM = `select (c).* from public.expense_claim_create(null, $1, $2::date, $3, $4, null, $5::uuid[]) c`;
  const today = (await db.query(`select app.site_today()::text d`)).rows[0].d;
  const DEC = `select (c).* from public.expense_claim_decide($1, $2, $3, $4, $5) c`;
  let medis, dinas, loan, adv, krun;
  await test('klaim wajib bukti; plafon tahunan per jenis', async () => {
    await expectError('22023', async () => as(db, payEmpUser, CLAIM, ['MEDIS', today, 500000, 'Berobat klinik', []]));
    await as(db, payOff, `select public.claim_type_save('MEDIS', 'Pengobatan / rawat jalan', true, null, 1000000, true, true, 10)`);
    await expectError('22023', async () => as(db, payEmpUser, CLAIM, ['MEDIS', today, 1200000, 'Rawat jalan', [(await upload(payEmpUser)).id]]));
    medis = (await as(db, payEmpUser, CLAIM, ['MEDIS', today, 500000, 'Berobat klinik', [(await upload(payEmpUser)).id]])).rows[0];
    dinas = (await as(db, payEmpUser, CLAIM, ['DINAS', today, 300000, 'Tiket bus Samarinda', [(await upload(payEmpUser)).id]])).rows[0];
    eq(medis.claim_no.startsWith('RMB-BSB-'), true);
    await expectError('42501', async () => as(db, hrStaff, `select public.claim_type_save('X1', 'x', false, null, null, false, true)`));
  });
  await test('klaim: atasan/HRGA tahap 1, payroll tahap 2 (nominal bisa dikurangi), pengaju tidak memutuskan sendiri', async () => {
    await expectError('42501', async () => as(db, payEmpUser, DEC, [medis.id, true, null, null, 'payroll']));
    await expectError('42501', async () => as(db, payOff, DEC, [medis.id, true, null, null, 'payroll']));
    for (const c of [medis, dinas]) await as(db, hrStaff, DEC, [c.id, true, null, null, 'payroll']);
    await expectError('42501', async () => as(db, hrStaff, DEC, [medis.id, true, null, null, 'payroll']));
    await expectError('22023', async () => as(db, payOff, DEC, [medis.id, true, null, 600000, 'payroll']));
    eq(Number((await as(db, payOff, DEC, [medis.id, true, 'Obat non-generik tidak ditanggung', 400000, 'payroll'])).rows[0].approved_amount), 400000);
    await as(db, payOff, DEC, [dinas.id, true, null, null, 'payroll']);
    const r = (await as(db, hrStaff, `select can_decide from public.expense_claim_register where id = $1`, [medis.id])).rows[0];
    eq(r.can_decide, false);
    eq((await as(db, absUser, `select 1 from public.expense_claims`)).rowCount, 0);
  });
  await test('kasbon pribadi: plafon 1x upah tetap, satu kasbon berjalan, cair lalu dicicil', async () => {
    const LOAN = `select (a).* from public.cash_advance_create(null, $1, $2, $3, $4) a`;
    await expectError('22023', async () => as(db, payEmpUser, LOAN, ['loan', 'Biaya sekolah', 10000000, 3]));
    await expectError('22023', async () => as(db, payEmpUser, LOAN, ['loan', 'Biaya sekolah', 3000000, 24]));
    loan = (await as(db, payEmpUser, LOAN, ['loan', 'Biaya sekolah', 3000000, 3])).rows[0];
    eq(Number(loan.installment_amount), 1000000);
    await expectError('22023', async () => as(db, payEmpUser, LOAN, ['loan', 'Lagi', 500000, 1]));
    const tmp = (await as(db, payEmpUser, LOAN, ['advance', 'Batal', 100000, 1])).rows[0];
    await expectError('22023', async () => as(db, absUser, `select public.cash_advance_cancel($1)`, [tmp.id]));
    eq((await as(db, payEmpUser, `select (a).status from public.cash_advance_cancel($1) a`, [tmp.id])).rows[0].status, 'cancelled');
    adv = (await as(db, payEmpUser, LOAN, ['advance', 'Dinas ke Balikpapan', 2000000, 5])).rows[0];
    eq(adv.installments, 1);
    for (const a of [loan, adv]) {
      await as(db, hrStaff, `select public.cash_advance_decide($1, true)`, [a.id]);
      await as(db, payOff, `select public.cash_advance_decide($1, true)`, [a.id]);
      await expectError('42501', async () => as(db, hrStaff, `select public.cash_advance_disburse($1)`, [a.id]));
      await as(db, payOff, `select public.cash_advance_disburse($1)`, [a.id]);
    }
    await expectError('22023', async () => as(db, payEmpUser, `select public.cash_advance_report($1, 1)`, [loan.id]));
    await as(db, payEmpUser, `select public.cash_advance_report($1, 1500000, 'Hotel + transport')`, [adv.id]);
    eq(Number((await as(db, payEmpUser, `select balance from public.cash_advance_register where id = $1`, [adv.id])).rows[0].balance), 500000);
  });
  await test('proses gaji menarik klaim (pajak sesuai jenis) dan cicilan; tercatat lunas saat slip terbit', async () => {
    krun = (await as(db, payOff, RUN, ['2026-11', 'regular', '2026-11-25', false])).rows[0];
    await as(db, payOff, `select public.payroll_calculate($1)`, [krun.id]);
    const inp = (await db.query(`select component_code, amount from public.payroll_inputs where run_id = $1 and employee_id = $2 order by component_code, amount`,
      [krun.id, pe.id])).rows.map(r => `${r.component_code}:${Number(r.amount)}`).join(',');
    eq(inp, 'KASBON:500000,KASBON:1000000,REIMB:300000,REIMBT:400000');
    const auto = (await db.query(`select id from public.payroll_inputs where run_id = $1 and source_table is not null limit 1`, [krun.id])).rows[0];
    await expectError('22023', async () => as(db, payOff, `select public.payroll_input_delete($1)`, [auto.id]));
    await as(db, payOff, `select public.payroll_calculate($1)`, [krun.id]);
    eq((await db.query(`select count(*)::int c from public.payroll_inputs where run_id = $1 and employee_id = $2`, [krun.id, pe.id])).rows[0].c, 4);
    eq((await as(db, payEmpUser, `select status from public.expense_claims where id = $1`, [medis.id])).rows[0].status, 'approved');
    await as(db, payApp, `select public.payroll_approve($1)`, [krun.id]);
    await as(db, payOff, `select public.payroll_publish($1)`, [krun.id]);
    const c = (await as(db, payEmpUser, `select status, paid_run_no from public.expense_claim_register where id = $1`, [medis.id])).rows[0];
    eq(c.status, 'paid'); eq(c.paid_run_no, krun.run_no);
    const l = (await as(db, payEmpUser, `select status, balance, repaid from public.cash_advance_register where id = $1`, [loan.id])).rows[0];
    eq(Number(l.balance), 2000000); eq(l.status, 'active');
    eq((await as(db, payEmpUser, `select status from public.cash_advance_register where id = $1`, [adv.id])).rows[0].status, 'settled');
  });
  await test('pelunasan manual kasbon dan saldo kasbon dari sistem lama lewat impor', async () => {
    await expectError('22023', async () => as(db, payOff, `select public.advance_repay($1, 2500000)`, [loan.id]));
    await as(db, payOff, `select public.advance_repay($1, 2000000, null, 'Transfer pelunasan')`, [loan.id]);
    eq((await db.query(`select status from public.cash_advances where id = $1`, [loan.id])).rows[0].status, 'settled');
    const rows = JSON.stringify([{ nrp: 'BSB-200', sisa: '1.200.000', cicilan: '400.000' }]);
    eq((await as(db, hrStaff, `select public.import_rows('kasbon_awal', $1::jsonb, true) r`, [rows])).rows[0].r.ok, 0);
    const ir = (await as(db, payOff, `select public.import_rows('kasbon_awal', $1::jsonb, true) r`, [rows])).rows[0].r;
    eq(ir.ok, 1, JSON.stringify(ir.errors));
    const o = (await db.query(`select status, installments, installment_amount from public.cash_advances where employee_id = $1 and opening`, [pe.id])).rows[0];
    eq(o.status, 'active'); eq(o.installments, 3); eq(Number(o.installment_amount), 400000);
  });
}

console.log('HRIS: Rekrutmen');
{
  const REQ = `select (q).* from public.requisition_create($1, $2, $3, $4, $5, $6, $7::date, $8) q`;
  const CAND = `select (c).* from public.candidate_save(null, $1::jsonb) c`;
  const RES = `select (a).* from public.application_result($1, $2, $3, $4, $5) a`;
  let req, apps = [];
  await test('FPTK: atasan departemen mengajukan, HRGA verifikasi, PJO menyetujui (orang berbeda)', async () => {
    await expectError('42501', async () => as(db, absUser, REQ, [PRD, OPRDT, 2, 'contract', 'additional', null, '2026-12-01', 'SIM B2 umum']));
    await expectError('22023', async () => as(db, dhPrd, REQ, [PRD, OPRDT, 1, 'contract', 'replacement', null, '2026-12-01', 'SIM B2 umum']));
    req = (await as(db, dhPrd, REQ, [PRD, OPRDT, 2, 'contract', 'additional', null, '2026-12-01', 'SIM B2 umum, pengalaman DT 1 tahun'])).rows[0];
    eq(req.req_no.startsWith('FPTK-BSB-'), true);
    await expectError('42501', async () => as(db, dhPrd, `select public.requisition_decide($1, true)`, [req.id]));
    await expectError('42501', async () => as(db, pjoId, `select public.requisition_decide($1, true)`, [req.id]));
    await as(db, hrStaff, `select public.requisition_decide($1, true, 'Sesuai MPP')`, [req.id]);
    await expectError('42501', async () => as(db, hrStaff, `select public.requisition_decide($1, true)`, [req.id]));
    await as(db, pjoId, `select public.requisition_decide($1, true)`, [req.id]);
    eq((await db.query(`select status from public.job_requisitions where id = $1`, [req.id])).rows[0].status, 'open');
    eq((await as(db, dhHse, `select 1 from public.requisition_register where id = $1`, [req.id])).rowCount, 0);
  });
  await test('kandidat: hanya HRGA, NIK unik; pelamar hanya ke FPTK yang dibuka', async () => {
    await expectError('42501', async () => as(db, dhPrd, CAND, ['{"full_name":"Budi"}']));
    const c1 = (await as(db, hrStaff, CAND, ['{"full_name":"Budi Santoso","nik":"6403011201950001","phone":"0812","gender":"L","education_level":"sma","is_local":true}'])).rows[0];
    await expectError('23505', async () => as(db, hrStaff, CAND, ['{"full_name":"Budi lain","nik":"6403011201950001"}']));
    const c2 = (await as(db, hrStaff, CAND, ['{"full_name":"Joko Prasetyo"}'])).rows[0];
    for (const c of [c1, c2]) apps.push((await as(db, hrStaff, `select (a).* from public.application_add($1, $2) a`, [req.id, c.id])).rows[0]);
    await expectError('23505', async () => as(db, hrStaff, `select public.application_add($1, $2)`, [req.id, c1.id]));
    eq((await as(db, dhPrd, `select full_name from public.application_register where requisition_id = $1`, [req.id])).rowCount, 2);
    eq((await as(db, absUser, `select 1 from public.candidates`)).rowCount, 0);
  });
  await test('seleksi: wawancara oleh atasan departemen, gagal wajib alasan, penawaran setelah wawancara lulus', async () => {
    const [a1, a2] = apps;
    await expectError('42501', async () => as(db, dhPrd, RES, [a1.id, 'pass', null, null, null]));
    await as(db, hrStaff, RES, [a1.id, 'pass', null, 'CV sesuai', 'interview']);
    await as(db, hrStaff, RES, [a2.id, 'pass', 70, null, null]);
    await expectError('22023', async () => as(db, hrStaff, RES, [a2.id, 'fail', 40, null, null]));
    await as(db, hrStaff, RES, [a2.id, 'fail', 40, 'Nilai psikotes di bawah standar', null]);
    await expectError('22023', async () => as(db, hrStaff, RES, [a1.id, 'pass', null, null, 'screening']));
    await as(db, dhPrd, RES, [a1.id, 'pass', 85, 'Paham P2H', null]);
    eq((await db.query(`select stage from public.applications where id = $1`, [a1.id])).rows[0].stage, 'mcu');
    await expectError('42501', async () => as(db, dhPrd, RES, [a1.id, 'pass', null, 'MCU fit', null]));
    await as(db, hrStaff, RES, [a1.id, 'pass', null, 'MCU fit', null]);
    const r = (await as(db, dhPrd, `select stage, interview_score from public.application_register where id = $1`, [a1.id])).rows[0];
    eq(r.stage, 'offering'); eq(Number(r.interview_score), 85);
    eq((await db.query(`select stage from public.applications where id = $1`, [a2.id])).rows[0].stage, 'rejected');
  });
  await test('diterima: jadi karyawan + data pribadi + kontrak PKWT + mobilisasi; gaji tidak terlihat atasan; payroll diberi tahu', async () => {
    const a1 = apps[0];
    await expectError('22023', async () => as(db, hrStaff, `select public.application_hire($1, 'BSB-300')`, [a1.id]));
    await as(db, hrStaff, `select public.offer_save($1, 6500000, 'Tunjangan site 750rb', '2026-12-01')`, [a1.id]);
    eq((await as(db, dhPrd, `select 1 from public.job_offers`)).rowCount, 0);
    eq((await as(db, payOff, `select basic_wage from public.job_offers where application_id = $1`, [a1.id])).rows.length, 1);
    await as(db, hrStaff, `select public.offer_decide($1, true)`, [a1.id]);
    const e = (await as(db, hrStaff, `select (e).* from public.application_hire($1, 'BSB-300') e`, [a1.id])).rows[0];
    eq(e.employment_type, 'contract'); eq(e.position_id, OPRDT);
    eq((await db.query(`select nik from public.employee_private where employee_id = $1`, [e.id])).rows[0].nik, '6403011201950001');
    const k = (await db.query(`select contract_type, end_date::text from public.employee_contracts where employee_id = $1`, [e.id])).rows[0];
    eq(k.contract_type, 'pkwt'); eq(k.end_date, '2027-11-30');
    eq((await db.query(`select count(*)::int c from public.mobilizations where employee_id = $1 and kind = 'mob' and status = 'open'`, [e.id])).rows[0].c, 1);
    eq((await db.query(`select count(*)::int c from public.notifications where user_id = $1 and title like 'Karyawan baru%'`, [payOff])).rows[0].c, 1);
    const q = (await as(db, hrStaff, `select status, hired from public.requisition_register where id = $1`, [req.id])).rows[0];
    eq(q.status, 'open'); eq(q.hired, 1);
  });
  await test('impor bank kandidat dan penutupan FPTK menolak pelamar yang tersisa', async () => {
    const rows = JSON.stringify([{ nama: 'Slamet', nik: '6403011201950002', no_hp: '0813', pendidikan: 'SMA', lokal: 'ya' }]);
    eq((await as(db, hrStaff, `select public.import_rows('kandidat', $1::jsonb, true) r`, [rows])).rows[0].r.ok, 1);
    const c = (await db.query(`select id, is_local from public.candidates where nik = '6403011201950002'`)).rows[0];
    eq(c.is_local, true);
    const a = (await as(db, hrStaff, `select (a).* from public.application_add($1, $2) a`, [req.id, c.id])).rows[0];
    await expectError('22023', async () => as(db, hrStaff, `select public.requisition_close($1, false, null)`, [req.id]));
    await as(db, hrStaff, `select public.requisition_close($1, false, 'Kebutuhan dipenuhi dari mutasi')`, [req.id]);
    eq((await db.query(`select stage from public.applications where id = $1`, [a.id])).rows[0].stage, 'rejected');
  });
}

console.log('HRIS: Kinerja & e-learning');
{
  const REG = `select * from public.perf_review_register where employee_id = $1`;
  const GOAL = `select (g).* from public.perf_goal_save($1, null, $2, null, $3, $4) g`;
  const ADV = `select (c).status from public.perf_cycle_advance($1) c`;
  const noAcc = (await as(db, hrStaff, EMP_SQL, ['BSB-401', 'Operator Tanpa Akun', PRD, OPRDT, 'permanent', null, null])).rows[0];
  const behaviors = (await db.query(`select id from public.perf_behaviors where active order by sort_order`)).rows.map(r => r.id);
  const items = (goals, scores, beh) => JSON.stringify([...goals.map((g, i) => ({ kind: 'goal', id: g.id, score: scores[i], actual: 'tercapai' })),
    ...behaviors.map(id => ({ kind: 'behavior', id, score: beh }))]);
  let cyc, rev, revNo, goals = [];
  await test('kinerja: siklus oleh HRGA; KPI wajib total bobot 100%; atasan mengembalikan dengan catatan lalu menyetujui', async () => {
    await expectError('42501', async () => as(db, absUser, `select public.perf_cycle_save(null, 'X', '2026-01-01', '2026-12-31', 70)`));
    cyc = (await as(db, hrStaff, `select (c).* from public.perf_cycle_save(null, 'Penilaian 2026', '2026-01-01', '2026-12-31', 70) c`)).rows[0];
    eq((await as(db, absUser, `select 1 from public.perf_cycles where id = $1`, [cyc.id])).rowCount, 0);
    eq((await as(db, hrStaff, ADV, [cyc.id])).rows[0].status, 'goal_setting');
    rev = (await as(db, absUser, REG, [wk.id])).rows[0];
    eq(rev.my_action, 'Susun KPI');
    eq((await as(db, dhHse, REG, [wk.id])).rowCount, 0);
    goals.push((await as(db, absUser, GOAL, [rev.id, 'Ritase DT', '≥ 95% target', 60])).rows[0]);
    goals.push((await as(db, absUser, GOAL, [rev.id, 'Zero LTI', '0 kejadian', 30])).rows[0]);
    await expectError('22023', async () => as(db, absUser, `select public.perf_goals_submit($1)`, [rev.id]));
    goals.push((await as(db, absUser, GOAL, [rev.id, 'P2H tepat waktu', '100%', 10])).rows[0]);
    await expectError('42501', async () => as(db, dhPrd, `select public.perf_goals_submit($1)`, [rev.id]));
    await as(db, absUser, `select public.perf_goals_submit($1)`, [rev.id]);
    eq((await as(db, dhPrd, REG, [wk.id])).rows[0].my_action, 'Setujui KPI');
    await expectError('42501', async () => as(db, absUser, `select public.perf_goals_decide($1, true)`, [rev.id]));
    await expectError('22023', async () => as(db, dhPrd, `select public.perf_goals_decide($1, false, null)`, [rev.id]));
    await as(db, dhPrd, `select public.perf_goals_decide($1, false, 'Tambahkan target jam kerja aman')`, [rev.id]);
    eq((await as(db, absUser, REG, [wk.id])).rows[0].return_note, 'Tambahkan target jam kerja aman');
    await as(db, absUser, `select public.perf_goals_submit($1)`, [rev.id]);
    await as(db, dhPrd, `select public.perf_goals_decide($1, true)`, [rev.id]);
    await expectError('42501', async () => as(db, absUser, GOAL, [rev.id, 'KPI baru', '1', 5]));
    // karyawan tanpa akun: KPI diimpor HRGA, disetujui atasan langsung dari draf
    revNo = (await as(db, hrStaff, REG, [noAcc.id])).rows[0];
    const rows = JSON.stringify([{ nrp: 'BSB-401', kpi: 'Ritase', target: '95%', bobot: '70%' }, { nrp: 'BSB-401', kpi: 'Zero LTI', target: '0', bobot: '30' }]);
    eq((await as(db, hrStaff, `select public.import_rows('kpi', $1::jsonb, true) r`, [rows])).rows[0].r.ok, 2);
    await as(db, dhPrd, `select public.perf_goals_decide($1, true)`, [revNo.id]);
  });
  await test('kinerja: penilaian diri lalu atasan; nilai = KPI×70% + perilaku×30%; hasil tersembunyi dari karyawan sebelum terbit', async () => {
    const SELF = `select public.perf_self_review($1, $2::jsonb, 'Target tercapai')`;
    const MGR = `select (x).* from public.perf_manager_review($1, $2::jsonb, 'Konsisten', 'Pelatihan defensive driving') x`;
    await expectError('22023', async () => as(db, absUser, SELF, [rev.id, items(goals, [5, 5, 5], 5)]));
    await as(db, hrStaff, ADV, [cyc.id]);
    eq((await as(db, absUser, REG, [wk.id])).rows[0].my_action, 'Isi penilaian diri');
    await expectError('22023', async () => as(db, dhPrd, MGR, [rev.id, items(goals, [5, 4, 3], 4)]));
    await expectError('22023', async () => as(db, absUser, SELF, [rev.id, JSON.stringify([{ kind: 'goal', id: goals[0].id, score: 5 }])]));
    await as(db, absUser, SELF, [rev.id, items(goals, [5, 5, 4], 5)]);
    await expectError('42501', async () => as(db, absUser, MGR, [rev.id, items(goals, [5, 5, 5], 5)]));
    const x = (await as(db, dhPrd, MGR, [rev.id, items(goals, [5, 4, 3], 4)])).rows[0];
    eq(Number(x.kpi_score), 4.5); eq(Number(x.behavior_score), 4); eq(Number(x.final_score), 4.35); eq(x.computed_grade, 'B');
    eq((await as(db, absUser, `select 1 from public.perf_results`)).rowCount, 0);
    eq((await as(db, absUser, `select 1 from public.perf_ratings where rater = 'manager'`)).rowCount, 0);
    eq((await as(db, absUser, `select count(*)::int c from public.perf_ratings where rater = 'self'`)).rows[0].c, 3 + behaviors.length);
    eq((await as(db, absUser, REG, [wk.id])).rows[0].final_grade, null);
    eq((await as(db, dhPrd, REG, [wk.id])).rows[0].final_grade, 'B');
    // tanpa akun: atasan menilai tanpa penilaian diri
    const ng = (await db.query(`select id from public.perf_goals where review_id = $1 order by sort_order`, [revNo.id])).rows;
    eq((await as(db, dhPrd, MGR, [revNo.id, items(ng, [3, 3], 3)])).rows[0].computed_grade, 'C');
    const ev = (await as(db, dhPrd, `select public.perf_evidence($1) e`, [rev.id])).rows[0].e;
    eq(typeof ev.hadir, 'number'); eq(typeof ev.pelanggaran, 'number');
    eq((await as(db, dhHse, `select 1 from public.perf_reviews where id = $1`, [rev.id])).rowCount, 0);
  });
  await test('kinerja: kalibrasi HRGA wajib alasan; hasil terbit saat siklus ditutup lalu dikonfirmasi karyawan', async () => {
    const CAL = `select (x).* from public.perf_calibrate($1, $2, $3) x`;
    await expectError('22023', async () => as(db, hrStaff, CAL, [rev.id, 'A', 'x']));
    await as(db, hrStaff, ADV, [cyc.id]);
    await expectError('42501', async () => as(db, dhPrd, CAL, [rev.id, 'A', 'x']));
    await expectError('22023', async () => as(db, hrStaff, CAL, [rev.id, 'A', null]));
    eq((await as(db, hrStaff, CAL, [rev.id, 'A', 'Zero incident sepanjang tahun, nilai dinaikkan komite'])).rows[0].calibrated_grade, 'A');
    await expectError('22023', async () => as(db, absUser, `select public.perf_acknowledge($1)`, [rev.id]));
    eq((await as(db, hrStaff, ADV, [cyc.id])).rows[0].status, 'closed');
    const r = (await as(db, absUser, REG, [wk.id])).rows[0];
    eq(r.final_grade, 'A'); eq(r.my_action, 'Konfirmasi hasil');
    eq((await as(db, absUser, `select count(*)::int c from public.perf_ratings where rater = 'manager'`)).rows[0].c, 3 + behaviors.length);
    await as(db, absUser, `select public.perf_acknowledge($1, 'Terima kasih')`, [rev.id]);
    eq((await db.query(`select status from public.perf_reviews where id = $1`, [rev.id])).rows[0].status, 'acknowledged');
    eq((await db.query(`select count(*)::int c from public.notifications where user_id = $1 and title like 'Hasil penilaian%'`, [absUser])).rows[0].c, 1);
  });

  let course;
  const QS = `select (q).* from public.course_question_save($1, null, $2, $3::text[], $4) q`;
  await test('e-learning: kursus disusun departemen pemilik; terbit wajib ada soal; kunci jawaban tidak terbaca peserta', async () => {
    const SAVE = `select (c).* from public.course_save(null, $1::jsonb) c`;
    await expectError('42501', async () => as(db, absUser, SAVE, [JSON.stringify({ code: 'K3-01', title: 'K3', department_id: HSE })]));
    await expectError('42501', async () => as(db, dhHse, SAVE, [JSON.stringify({ code: 'PRD-01', title: 'Produksi', department_id: PRD })]));
    course = (await as(db, dhHse, SAVE, [JSON.stringify({ code: 'k3-dasar', title: 'Induksi K3 dasar', department_id: HSE, competency_id: INDUKSI,
      pass_score: 70, max_attempts: 2 })])).rows[0];
    eq(course.code, 'K3-DASAR');
    await as(db, dhHse, `select public.course_material_save($1, null, 'Aturan lalu lintas tambang', 'text', 'Jarak aman 50 m', null)`, [course.id]);
    await expectError('22023', async () => as(db, dhHse, `select public.course_set_status($1, 'published')`, [course.id]));
    await expectError('22023', async () => as(db, dhHse, QS, [course.id, 'Jarak aman?', ['50 m'], 1]));
    await as(db, dhHse, QS, [course.id, 'Jarak aman antar DT?', ['50 m', '10 m', '5 m'], 1]);
    await as(db, dhHse, QS, [course.id, 'APD wajib di pit?', ['Sandal', 'Helm, rompi, safety shoes', 'Topi'], 2]);
    const rows = JSON.stringify([{ kode_kursus: 'K3-DASAR', pertanyaan: 'P2H dilakukan?', opsi_a: 'Setelah shift', opsi_b: 'Kapan saja', opsi_c: 'Sebelum operasi', jawaban: 'C' }]);
    eq((await as(db, dhHse, `select public.import_rows('soal_kursus', $1::jsonb, true) r`, [rows])).rows[0].r.ok, 1);
    eq((await db.query(`select answer from public.course_questions where question = 'P2H dilakukan?'`)).rows[0].answer, 3);
    await as(db, dhHse, `select public.course_set_status($1, 'published')`, [course.id]);
    eq((await as(db, absUser, `select 1 from public.courses where id = $1`, [course.id])).rowCount, 1);
    eq((await as(db, absUser, `select 1 from public.course_questions`)).rowCount, 0);
    eq((await as(db, dhHse, `select public.course_assign($1, array[$2]::uuid[], null, null, '2026-12-31') n`, [course.id, wk.id])).rows[0].n, 1);
    eq((await as(db, absUser, `select my_assigned from public.course_register where id = $1`, [course.id])).rows[0].my_assigned, true);
  });
  await test('e-learning: kuis setelah materi selesai; lulus → sertifikat LMS jadi kompetensi; batas percobaan', async () => {
    await expectError('22023', async () => as(db, absUser, `select public.course_start($1)`, [course.id]));
    const mat = (await db.query(`select id from public.course_materials where course_id = $1`, [course.id])).rows[0];
    await as(db, absUser, `select public.course_material_done($1)`, [mat.id]);
    let s = (await as(db, absUser, `select public.course_start($1) s`, [course.id])).rows[0].s;
    eq(s.questions.length, 3); eq(s.questions[0].answer, undefined);
    eq((await as(db, absUser, `select public.course_start($1) s`, [course.id])).rows[0].s.attempt_id, s.attempt_id);
    const key = Object.fromEntries((await db.query(`select id, answer from public.course_questions where course_id = $1`, [course.id])).rows.map(r => [r.id, r.answer]));
    const wrong = s.questions.map(q => (key[q.id] % q.options.length) + 1);
    const a1 = (await as(db, absUser, `select (a).* from public.course_submit($1, $2::int[]) a`, [s.attempt_id, wrong])).rows[0];
    eq(a1.passed, false); eq(Number(a1.score), 0); eq(a1.cert_no, null);
    await expectError('22023', async () => as(db, absUser, `select public.course_submit($1, $2::int[])`, [s.attempt_id, wrong]));
    s = (await as(db, absUser, `select public.course_start($1) s`, [course.id])).rows[0].s;
    const a2 = (await as(db, absUser, `select (a).* from public.course_submit($1, $2::int[]) a`, [s.attempt_id, s.questions.map(q => key[q.id])])).rows[0];
    eq(a2.passed, true); eq(Number(a2.score), 100); eq(a2.cert_no.startsWith('LMS-BSB-'), true);
    const ec = (await db.query(`select cert_no, valid_until is not null v from public.employee_competencies where id = $1`, [a2.employee_competency_id])).rows[0];
    eq(ec.cert_no, a2.cert_no); eq(ec.v, true);
    eq((await as(db, dhHse, `select status from public.course_assignment_register where course_id = $1 and employee_id = $2`, [course.id, wk.id])).rows[0].status, 'completed');
    await expectError('22023', async () => as(db, absUser, `select public.course_start($1)`, [course.id]));
    await expectError('22023', async () => as(db, absUser, `select public.course_submit($1, $2::int[])`, [s.attempt_id, []]));
  });
}

console.log('HRIS: Analitik');
await test('analitik HR: hanya HRGA; angka konsisten dengan data; gaji hanya untuk payroll; filter departemen', async () => {
  const AN = `select public.hr_analytics($1, $2) a`;
  await expectError('42501', async () => as(db, dhPrd, AN, [12, null]));
  await expectError('42501', async () => as(db, absUser, AN, [12, null]));
  const a = (await as(db, hrStaff, AN, [6, null])).rows[0].a;
  eq(a.monthly.length, 6);
  const active = (await db.query(`select count(*)::int c from public.employees where status = 'active'`)).rows[0].c;
  eq(a.monthly[a.monthly.length - 1].headcount, (await db.query(`select count(*)::int c from public.employees where status = 'active' and (join_date is null or join_date <= (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date)`)).rows[0].c);
  eq(a.departments.reduce((n, d) => n + d.headcount, 0), active);
  eq(a.tenure.reduce((n, d) => n + d.n, 0), active);
  eq(a.age.reduce((n, d) => n + d.n, 0), active);
  eq(a.cost, null);
  const prdN = (await db.query(`select count(*)::int c from public.employees where status = 'active' and department_id = $1`, [PRD])).rows[0].c;
  const p = (await as(db, hrStaff, AN, [6, PRD])).rows[0].a;
  eq(p.departments.length, 1); eq(p.departments[0].headcount, prdN);
  eq(typeof a.recruitment.open_requisitions, 'number'); eq(typeof a.learning.assigned, 'number');
  const pay = (await as(db, payOff, `select public.hr_analytics(6, null) a`).catch(e => e)); // payroll bukan HRGA
  eq(pay.code, '42501');
});

console.log('Plant: biaya, keandalan, komponen');
await test('biaya WO: kode downtime & jam mekanik; suku cadang dari pengeluaran stok; KPI keandalan terhitung', async () => {
  const wo = (await as(db, dhPlt, `select (w).* from public.wo_create($1, 'repair', 'Ganti hose hidrolik', 'medium') w`, [unit.id])).rows[0];
  await expectError('42501', async () => as(db, spvHse, `select public.wo_costing($1, 'breakdown', 2)`, [wo.id]));
  await expectError('22023', async () => as(db, spvPlt, `select public.wo_costing($1, 'salah', 2)`, [wo.id]));
  await expectError('22023', async () => as(db, spvPlt, `select public.wo_costing($1, 'breakdown', -1)`, [wo.id]));
  await as(db, spvPlt, `select public.wo_costing($1, 'waiting_part', 4)`, [wo.id]);
  const m = (await db.query(`select id from public.materials limit 1`)).rows[0];
  await db.query(`insert into public.stock_movements(movement_type, material_id, qty, unit_cost, wo_id, unit_id, moved_by) values ('issue', $1, -2, 150000, $2, $3, $4)`, [m.id, wo.id, unit.id, ownerId]);
  const c = (await as(db, spvPlt, `select parts_cost::int p, labor_cost::int l, total_cost::int t from public.wo_cost where wo_id = $1`, [wo.id])).rows[0];
  eq(c.p, 300000); eq(c.l, 200000); eq(c.t, 500000);
  const r = (await as(db, spvPlt, `select failures_90d::int f, pa_90d::float pa from public.unit_reliability where unit_id = $1`, [unit.id])).rows[0];
  eq(r.f >= 1, true); eq(r.pa > 90 && r.pa <= 100, true);
  eq((await as(db, spvPlt, `select count(*)::int c from public.downtime_by_code`)).rows[0].c >= 1, true);
  const cs = (await as(db, spvPlt, `select total_cost_90d::int t, hm_90d::float h from public.unit_cost_summary where unit_id = $1`, [unit.id])).rows[0];
  eq(cs.t >= 500000, true);
  eq((await db.query(`select count(*)::int c from public.unit_hm_log where unit_id = $1`, [unit.id])).rows[0].c >= 2, true);
});
await test('komponen: daftar unik per nomor seri; pasang butuh stok & HM tidak mundur; lepas menambah umur; overhaul reset', async () => {
  await expectError('42501', async () => as(db, spvPlt, `select public.component_save('engine', 'ENG-001', 'Cummins', 'QSM11', 15000)`));
  const c = (await as(db, dhPlt, `select (c).* from public.component_save('engine', 'eng-001', 'Cummins', 'QSM11', 15000, 1000) c`)).rows[0];
  eq(/^CMP-BSB-\d{5}$/.test(c.comp_no), true); eq(c.serial_no, 'ENG-001');
  await expectError('23505', async () => as(db, dhPlt, `select public.component_save('engine', 'ENG-001', null, null, 100)`));
  const hm0 = Number((await db.query(`select current_hm from public.units where id = $1`, [unit.id])).rows[0].current_hm);
  await expectError('42501', async () => as(db, spvHse, `select public.component_install($1, $2, $3)`, [c.id, unit.id, hm0]));
  await expectError('22023', async () => as(db, spvPlt, `select public.component_install($1, $2, $3)`, [c.id, unit.id, hm0 - 10]));
  await as(db, spvPlt, `select public.component_install($1, $2, $3, 'Engine')`, [c.id, unit.id, hm0]);
  const c2 = (await as(db, dhPlt, `select (c).* from public.component_save('engine', 'ENG-002', 'Cummins', null, 15000) c`)).rows[0];
  await expectError('23505', async () => as(db, spvPlt, `select public.component_install($1, $2, $3, 'Engine')`, [c2.id, unit.id, hm0]));
  await expectError('22023', async () => as(db, spvPlt, `select public.component_install($1, $2, $3)`, [c.id, unit.id, hm0]));
  await db.query(`update public.units set current_hm = current_hm + 5000 where id = $1`, [unit.id]);
  const v = (await as(db, spvPlt, `select life_hm::float l, life_pct::int p, due from public.component_view where id = $1`, [c.id])).rows[0];
  eq(v.l, 6000); eq(v.p, 40); eq(v.due, false);
  await expectError('22023', async () => as(db, spvPlt, `select public.component_remove($1, $2, null)`, [c.id, hm0 + 5000]));
  await expectError('22023', async () => as(db, spvPlt, `select public.component_remove($1, $2, 'failure')`, [c.id, hm0 + 100]));
  const r = (await as(db, spvPlt, `select (c).* from public.component_remove($1, $2, 'failure', 'rebuild') c`, [c.id, hm0 + 5000])).rows[0];
  eq(r.status, 'rebuild'); eq(Number(r.accumulated_hm), 6000);
  await expectError('42501', async () => as(db, spvPlt, `select public.component_rebuild_done($1, 1000000)`, [c.id]));
  const rb = (await as(db, dhPlt, `select (c).* from public.component_rebuild_done($1, 25000000) c`, [c.id])).rows[0];
  eq(rb.status, 'in_stock'); eq(Number(rb.accumulated_hm), 0); eq(rb.rebuild_count, 1);
  eq((await as(db, spvPlt, `select count(*)::int c from public.component_event_view where component_id = $1`, [c.id])).rows[0].c, 4);
  const st = (await as(db, spvPlt, `select failures::int f from public.component_life_stats where component_type = 'engine'`)).rows[0];
  eq(st.f, 1);
  await expectError('22023', async () => as(db, dhPlt, `select public.component_scrap($1, '')`, [c2.id]));
  await as(db, dhPlt, `select public.component_scrap($1, 'Blok retak')`, [c2.id]);
});
console.log('Logistik: stasiun BBM');
await test('tangki BBM: master oleh pengelola; isi awal sekali; terima kiriman vendor dengan ukur & kapasitas', async () => {
  await expectError('42501', async () => as(db, logStaff, `select public.fuel_tank_save('TK-01', 'Tangki solar 1', $1, 20000)`, [solar.id]));
  await expectError('22023', async () => as(db, logHead, `select public.fuel_tank_save('TK-X', 'Salah', $1, 100)`, [sp.id]));
  const tk = (await as(db, logHead, `select (t).* from public.fuel_tank_save('tk-01', 'Tangki solar 1', $1, 20000) t`, [solar.id])).rows[0];
  eq(tk.code, 'TK-01');
  global.fuelTank = tk;
  await expectError('22023', async () => as(db, logStaff, `select public.fuel_tank_receive($1, $2, 1000, 14000, 'SJ-1')`, [tk.id, sup.id]));
  await expectError('22023', async () => as(db, logStaff, `select public.fuel_tank_opening($1, 99999)`, [tk.id]));
  await as(db, logStaff, `select public.fuel_tank_opening($1, 4000, 'Dip awal')`, [tk.id]);
  await expectError('22023', async () => as(db, logStaff, `select public.fuel_tank_opening($1, 100)`, [tk.id]));
  const before = Number((await db.query(`select stock_qty from public.materials where id = $1`, [solar.id])).rows[0].stock_qty);
  await expectError('22023', async () => as(db, logStaff, `select public.fuel_tank_receive($1, $2, 17000, 14000, 'SJ-2')`, [tk.id, sup.id]));
  await expectError('22023', async () => as(db, logStaff, `select public.fuel_tank_receive($1, $2, 8000, 14000, 'SJ-2', 4000, 11000)`, [tk.id, sup.id]));
  await as(db, logStaff, `select public.fuel_tank_receive($1, $2, 8000, 14000, 'SJ-2', 4000, 11980, 'Selisih ukur 20 L, suhu')`, [tk.id, sup.id]);
  eq(Number((await db.query(`select level_l from public.fuel_tanks where id = $1`, [tk.id])).rows[0].level_l), 12000);
  eq(Number((await db.query(`select stock_qty from public.materials where id = $1`, [solar.id])).rows[0].stock_qty), before + 8000);
});
await test('BBM keluar dari tangki ke unit memakai HM & mengurangi isi tangki; ukur menyesuaikan selisih', async () => {
  const tk = global.fuelTank;
  const hm = Number((await db.query(`select current_hm from public.units where id = $1`, [unit.id])).rows[0].current_hm);
  await expectError('22023', async () => as(db, logStaff, `select public.fuel_tank_dispense($1, $2, 13000, $3)`, [tk.id, unit.id, hm + 1]));
  await expectError('22023', async () => as(db, logStaff, `select public.fuel_tank_dispense($1, $2, 200, $3)`, [tk.id, unit.id, hm - 5]));
  await as(db, logStaff, `select public.fuel_tank_dispense($1, $2, 400, $3)`, [tk.id, unit.id, hm + 20]);
  await as(db, logStaff, `select public.fuel_tank_dispense($1, $2, 450, $3)`, [tk.id, unit.id, hm + 30]);
  eq(Number((await db.query(`select level_l from public.fuel_tanks where id = $1`, [tk.id])).rows[0].level_l), 11150);
  const f = (await as(db, logStaff, `select l_per_hm::float l from public.fuel_fills where unit_id = $1 and hm = $2`, [unit.id, hm + 30])).rows[0];
  eq(f.l, 45);
  const stockBefore = Number((await db.query(`select stock_qty from public.materials where id = $1`, [solar.id])).rows[0].stock_qty);
  await expectError('22023', async () => as(db, logStaff, `select public.fuel_tank_dip($1, 11000)`, [tk.id]));
  await expectError('22023', async () => as(db, logStaff, `select public.fuel_tank_dip($1, 99999, 'x')`, [tk.id]));
  await as(db, logStaff, `select public.fuel_tank_dip($1, 11000, 'Susut penguapan')`, [tk.id]);
  eq(Number((await db.query(`select level_l from public.fuel_tanks where id = $1`, [tk.id])).rows[0].level_l), 11000);
  eq(Number((await db.query(`select stock_qty from public.materials where id = $1`, [solar.id])).rows[0].stock_qty), stockBefore - 150);
  const st = (await as(db, logStaff, `select level_pct::float p, last_dip_variance::float v from public.fuel_tank_status where tank_id = $1`, [tk.id])).rows[0];
  eq(st.p, 55); eq(st.v, -150);
  eq((await as(db, logStaff, `select count(*)::int c from public.fuel_tank_log_view where tank_id = $1`, [tk.id])).rows[0].c, 5);
  eq((await as(db, logStaff, `select count(*)::int c from public.fuel_reconciliation`)).rowCount, 1);
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
await test('push: langganan milik sendiri, pindah akun bila endpoint sama, antrean hanya untuk yang berlangganan dan tidak menolak', async () => {
  const ep = 'https://push.example/abc';
  await as(db, staffId, `select public.push_subscribe($1, 'p256', 'authk', 'UA')`, [ep]);
  eq((await as(db, staffId, `select public.push_status() s`)).rows[0].s.devices, 1);
  eq((await as(db, adminId, `select public.push_status() s`)).rows[0].s.devices, 0);
  await expectError('42501', () => as(db, staffId, `select * from public.push_subscriptions`));
  await expectError('22023', () => as(db, staffId, `select public.push_subscribe('http://x', 'a', 'b')`));
  await db.query(`insert into public.notifications(user_id, kind, title, body, link) values ($1, 't', 'Judul', 'Isi', '/tugas'), ($2, 't', 'Lain', 'x', '/')`, [staffId, adminId]);
  const q = await db.query(`select user_id, channel from public.notification_outbox`);
  eq(q.rowCount, 1); eq(q.rows[0].user_id, staffId);
  // HP dipakai bergantian: endpoint yang sama pindah ke akun yang sedang masuk
  await as(db, adminId, `select public.push_subscribe($1, 'p2', 'a2', 'UA')`, [ep]);
  eq((await as(db, staffId, `select public.push_status() s`)).rows[0].s.devices, 0);
  eq((await as(db, adminId, `select public.push_status() s`)).rows[0].s.devices, 1);
  // matikan lewat preferensi
  await as(db, staffId, `select public.push_subscribe('https://push.example/s', 'p', 'a', null)`);
  await as(db, staffId, `select public.push_set_pref(false)`);
  await db.query(`insert into public.notifications(user_id, kind, title) values ($1, 't', 'Tidak dikirim')`, [staffId]);
  eq((await db.query(`select count(*)::int c from public.notification_outbox where user_id = $1`, [staffId])).rows[0].c, 1);
});
await test('push: klaim dan penyelesaian antrean hanya untuk service_role; 3 kali gagal -> failed; langganan mati dihapus', async () => {
  await expectError('42501', () => as(db, adminId, `select public.dispatch_claim_push(10)`));
  await expectError('42501', () => as(db, adminId, `select public.dispatch_complete_push(gen_random_uuid(), true)`));
  const svc = async (sql, params = []) => {
    await db.query('begin');
    try {
      await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      await db.query('set local role service_role');
      const r = await db.query(sql, params); await db.query('commit'); return r;
    } catch (e) { await db.query('rollback'); throw e; }
  };
  await db.query(`update public.notification_outbox set status = 'pending', attempts = 0`);
  await db.query(`insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/dead', 'p', 'a')`, [staffId]);
  const claimed = (await svc(`select public.dispatch_claim_push(10) c`)).rows[0].c;
  eq(claimed.length, 1);
  eq(claimed[0].title, 'Judul');
  eq(claimed[0].subs.length, 2, 'dua langganan milik staff (s dan dead)');
  const id = claimed[0].id;
  eq((await svc(`select public.dispatch_claim_push(10) c`)).rows[0].c.length, 0, 'sudah diklaim');
  await svc(`select public.dispatch_complete_push($1, false, 'boom', '{}')`, [id]);
  eq((await db.query(`select status from public.notification_outbox where id = $1`, [id])).rows[0].status, 'pending');
  await svc(`select public.dispatch_claim_push(10)`); await svc(`select public.dispatch_complete_push($1, false, 'boom', '{}')`, [id]);
  await svc(`select public.dispatch_claim_push(10)`); await svc(`select public.dispatch_complete_push($1, false, 'boom', ARRAY['https://push.example/dead'])`, [id]);
  eq((await db.query(`select status from public.notification_outbox where id = $1`, [id])).rows[0].status, 'failed');
  eq((await db.query(`select count(*)::int c from public.push_subscriptions where endpoint = 'https://push.example/dead'`)).rows[0].c, 0);
});
await test('whatsapp: nomor dari data HRGA, wajib opt-in, saklar utama, jenis terbatas, klaim hanya service_role', async () => {
  eq((await db.query(`select app.wa_normalize('0812-3456-7890') n, app.wa_normalize('+62 811 222 333') m, app.wa_normalize('123') x`)).rows[0].n, '6281234567890');
  eq((await db.query(`select app.wa_normalize('+62 811 222 333') m`)).rows[0].m, '62811222333');
  eq((await db.query(`select app.wa_normalize('123') x`)).rows[0].x, null);
  // akun tanpa karyawan tertaut / tanpa nomor ditolak
  await expectError('22023', () => as(db, outsiderId, `select public.whatsapp_optin()`));
  const emp = (await db.query(`select id from public.employees where profile_id = $1`, [opUser])).rows[0];
  if (!emp) throw new Error('opUser tidak tertaut karyawan');
  {
    await db.query(`insert into public.employee_private(employee_id, phone) values ($1, '0812-0000-1111') on conflict (employee_id) do update set phone = excluded.phone`, [emp.id]);
    await as(db, opUser, `select public.whatsapp_optin()`);
    eq((await as(db, opUser, `select public.whatsapp_status() s`)).rows[0].s.number_hint, '…111');
    const cnt = async () => (await db.query(`select count(*)::int c from public.notification_outbox where channel = 'whatsapp'`)).rows[0].c;
    await db.query(`insert into public.notifications(user_id, kind, title) values ($1, 'workflow.task', 'A')`, [opUser]);
    eq(await cnt(), 0, 'saklar utama mati');
    await db.query(`update public.app_settings set value = 'true'::jsonb where key = 'whatsapp_enabled'`);
    await db.query(`insert into public.notifications(user_id, kind, title) values ($1, 'workflow.result', 'B'), ($1, 'workflow.task', 'C')`, [opUser]);
    eq(await cnt(), 1, 'hanya jenis yang diizinkan');
    await expectError('42501', () => as(db, opUser, `select public.dispatch_claim_whatsapp(5)`));
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await db.query('set local role service_role');
    const c = (await db.query(`select public.dispatch_claim_whatsapp(5) c`)).rows[0].c;
    await db.query('commit');
    eq(c.length, 1); eq(c[0].title, 'C');
    eq(c[0].phone, null, 'karyawan sudah keluar -> tidak ada nomor, pengirim akan skip');
    await db.query(`update public.notification_outbox set status = 'pending', attempts = 0`);
    await db.query(`update public.employees set status = 'active' where id = $1`, [emp.id]);
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await db.query('set local role service_role');
    const c2 = (await db.query(`select public.dispatch_claim_whatsapp(5) c`)).rows[0].c;
    await db.query('commit');
    eq(c2[0].phone, '6281200001111');
    await as(db, opUser, `select public.whatsapp_optout()`);
    await db.query(`insert into public.notifications(user_id, kind, title) values ($1, 'workflow.task', 'D')`, [opUser]);
    eq(await cnt(), 1, 'setelah opt-out tidak ada antrean baru');
  }
});
await test('pengguna tanpa audit.read tidak melihat audit log', async () => {
  eq((await as(db, staffId, `select 1 from public.audit_logs`)).rowCount, 0);
});

await db.end();
console.log(`\n${passed} lulus, ${failed} gagal`);
process.exit(failed ? 1 : 0);
