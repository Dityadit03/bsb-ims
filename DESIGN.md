---
version: "alpha"
name: "BSB IMS"
description: "Aplikasi operasional tambang batu bara PT Berkarya Sejahtera Bersama. Padat informasi, dipakai di HP lapangan dan laptop kantor, bahasa Indonesia."
colors:
  ground: "#f4f4f7"
  panel: "#ffffff"
  ink: "#1c1726"
  muted: "#625c70"
  line: "#e3e0ea"
  coal: "#1e1433"
  accent: "#c2125a"
  accent-soft: "#fce6ef"
  violet: "#5b21b6"
  orange: "#e8891a"
  blue: "#2563eb"
  ok: "#2f7d4f"
  warn: "#b07a00"
  crit: "#b3261e"
  dark-ground: "#131019"
  dark-panel: "#1c1824"
  dark-ink: "#ece8f3"
  dark-accent: "#f2588f"
typography:
  display:
    fontFamily: Plus Jakarta Sans
    fontWeight: 700
  body:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.875rem
    fontWeight: 400
  mono:
    fontFamily: IBM Plex Mono
    fontSize: 0.75rem
rounded:
  control: 8px
  card: 16px
  table: 12px
  pill: 9999px
spacing:
  card: 16px
  card-wide: 24px
components:
  button:
    minHeight: 40px
    rounded: "{rounded.control}"
  input:
    minHeight: 40px
    rounded: "{rounded.control}"
  panel:
    rounded: "{rounded.card}"
    border: "1px solid {colors.line}"
---

## Overview

Sumber kebenaran visual adalah `src/app/globals.css` (token `@theme`) dan `src/components/ui.tsx` (Panel, PageHeader, Pill, Table, `btn`, `input`). File ini merangkum keduanya supaya halaman baru konsisten. Bila ada selisih, kode yang benar dan file ini yang diperbarui.

Karakter: tenang, padat, mudah dipindai. Dipakai di HP Android murah di lapangan dan di laptop kantor, sering di bawah sinar matahari, jadi kontras dan area tap lebih penting daripada hiasan.

## Colors

- **coal** (#1e1433, plum gelap dari logo BSB): bilah navigasi dan permukaan gelap.
- **accent** (#c2125a, magenta logo): tautan aktif, penanda menu, cincin fokus. Jangan dipakai untuk status.
- **violet** (#5b21b6): warna tombol utama (`btnPrimary`), satu per kartu.
- **ok / warn / crit**: hanya untuk status, selalu disertai label teks atau ikon, tidak pernah warna saja.
- **orange, blue** dan violet: seri grafik dan penanda kategori. Gradien magenta-ungu-oranye hanya sebagai garis penanda (`brand-line`), tidak sebagai latar.
- Mode gelap mengikuti perangkat kecuali pengguna memilih Terang/Gelap di Pengaturan. Setiap warna baru wajib punya padanan gelap.

## Typography

- Satu keluarga: Plus Jakarta Sans. IBM Plex Mono hanya untuk nomor dokumen, NRP, kode dan angka teknis.
- Judul memakai `font-display` dengan jarak huruf rapat (-0.02em). Label memakai huruf kecil biasa, bukan kapital berjarak.
- Teks isi minimal 14px. Hindari 10-11px: untuk keterangan terkecil pakai 12px (`text-xs`). Angka dalam tabel memakai `tabular`.

## Layout

- Kartu (`Panel`) dengan radius 16px, border 1px `line`, bayangan lembut hanya di mode terang.
- Tabel dibungkus radius 12px, baris punya umpan balik hover, dan boleh digulir ke samping di HP.
- Kelipatan jarak 4px. Isi halaman satu kolom di HP, dua kolom mulai `lg`.
- Tidak ada gulir horizontal pada halaman, hanya di dalam tabel.

## Components

- **Tombol:** tinggi minimal 40px (44px untuk aksi lapangan seperti P2H dan absen), radius 8px, satu tombol utama (violet) per kartu.
- **Input:** label di atas, tinggi minimal 40px, fokus dengan cincin accent. Pesan galat di bawah isian dalam `crit`. Formulir tidak boleh kosong kembali saat server menolak.
- **Pill status:** bentuk kapsul, warna sesuai nada, teks wajib.
- **Konfirmasi:** aksi yang tidak bisa dibatalkan memakai `confirm`.
- **Keadaan kosong:** kalimat penjelas dan tindakan berikutnya, bukan tabel kosong.
- **Offline:** formulir lapangan boleh masuk antrean, tampilkan penanda antrean.

## Do's and Don'ts

- Do pakai istilah Indonesia di seluruh antarmuka.
- Do jaga kontras teks minimal 4.5:1 di kedua mode.
- Do ukur halaman baru di HP lebar 360px.
- Don't pakai emoji sebagai ikon.
- Don't pakai warna status sebagai hiasan atau seri grafik.
- Don't menambah font ketiga atau radius di luar token.
- Don't membuat latar gradien atau efek berat: HP lapangan lambat.
