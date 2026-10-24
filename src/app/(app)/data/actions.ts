'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { importKind, mapHeaders, parseDelimited, toIsoDate } from '@/lib/datasets';
import { readXlsx } from '@/lib/xlsx';

export type TokenState = { error?: string; ok?: string; token?: string; label?: string };

export async function createFeedToken(_: TokenState, f: FormData): Promise<TokenState> {
  const label = String(f.get('label') ?? '').trim();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('feed_token_create', { p_label: label });
  if (error) return { error: error.message };
  revalidatePath('/data');
  return { token: data as string, label };
}

export async function revokeFeedToken(_: { error?: string; ok?: string }, f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('feed_token_revoke', { p_id: String(f.get('id')) });
  if (error) return { error: error.message };
  revalidatePath('/data');
  return { ok: 'Token dicabut; rumus yang memakainya berhenti bekerja' };
}

export type ImportState = {
  error?: string;
  kind?: string;
  rows?: Record<string, string>[];
  columns?: { header: string; field: string | null }[];
  missing?: string[];
  checked?: { ok: number; errors: { row: number; error: string }[] };
  done?: { ok: number; errors: { row: number; error: string }[] };
};

// Langkah 1: baca berkas / tempelan, cocokkan kolom, lalu periksa di database tanpa menyimpan.
// Langkah 2 (commit): kirim ulang baris yang sudah dibaca dan simpan; baris yang gagal dilewati.
export async function runImport(prev: ImportState, f: FormData): Promise<ImportState> {
  const supabase = await createClient();
  if (f.get('commit') === '1' && prev.rows && prev.kind) {
    const { data, error } = await supabase.rpc('import_rows', { p_dataset: prev.kind, p_rows: prev.rows, p_commit: true });
    if (error) return { ...prev, error: error.message };
    revalidatePath('/', 'layout');
    return { kind: prev.kind, rows: prev.rows, columns: prev.columns, done: data as ImportState['done'] };
  }
  const kind = importKind(String(f.get('kind') ?? ''));
  if (!kind) return { error: 'Pilih jenis data' };
  let table: string[][];
  try {
    const file = f.get('file');
    const paste = String(f.get('paste') ?? '');
    if (file instanceof File && file.size > 0) {
      if (file.size > 10 * 1048576) return { error: 'Berkas maksimal 10 MB' };
      const buf = Buffer.from(await file.arrayBuffer());
      table = /\.xlsx$/i.test(file.name) || buf.subarray(0, 2).toString() === 'PK' ? readXlsx(buf) : parseDelimited(buf.toString('utf8').replace(/^﻿/, ''));
    } else if (paste.trim()) table = parseDelimited(paste);
    else return { error: 'Unggah berkas Excel/CSV atau tempel tabel dari Excel' };
  } catch (e) { return { error: (e as Error).message }; }
  // Baris judul = baris pertama yang paling banyak cocok dengan kolom baku (abaikan judul laporan di atasnya)
  const scan = table.slice(0, 10).map(r => mapHeaders(kind, r).filter(Boolean).length);
  const h = scan.indexOf(Math.max(0, ...scan));
  if (h < 0 || scan[h] === 0) return { error: 'Judul kolom tidak dikenali. Unduh templat agar judul kolom sesuai.' };
  const headers = table[h].map(x => x.trim());
  const map = mapHeaders(kind, headers);
  const dates = new Set(kind.fields.filter(x => x.date).map(x => x.key));
  const rows = table.slice(h + 1).map(r => {
    const o: Record<string, string> = {};
    map.forEach((k, i) => { if (k) o[k] = dates.has(k) ? toIsoDate(r[i] ?? '') : (r[i] ?? '').trim(); });
    return o;
  }).filter(o => Object.values(o).some(v => v !== ''));
  if (!rows.length) return { error: 'Tidak ada baris data di bawah judul kolom' };
  if (rows.length > 2000) return { error: `Berkas berisi ${rows.length} baris; maksimal 2000 sekali impor` };
  const missing = kind.fields.filter(x => x.required && !map.includes(x.key)).map(x => x.label);
  const columns = headers.map((header, i) => ({ header, field: map[i] }));
  if (missing.length) return { kind: kind.key, columns, missing, rows };
  const { data, error } = await supabase.rpc('import_rows', { p_dataset: kind.key, p_rows: rows, p_commit: false });
  if (error) return { error: error.message };
  return { kind: kind.key, rows, columns, missing, checked: data as ImportState['checked'] };
}
