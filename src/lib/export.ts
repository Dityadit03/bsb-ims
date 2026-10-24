import 'server-only';
import { NextResponse } from 'next/server';
import { type Dataset, tableOf, toCsv } from '@/lib/datasets';
import { writeXlsx, type Cell } from '@/lib/xlsx';

const stamp = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); // WITA

export function spreadsheetResponse(name: string, sheets: { name: string; rows: Cell[][] }[], format: string, cache = 'private, no-store') {
  const file = `${name}-${stamp()}`;
  if (format === 'csv') {
    // BOM agar Excel membaca UTF-8 dengan benar
    return new NextResponse('﻿' + toCsv(sheets[0].rows as (string | number | boolean | null)[][]), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}.csv"`, 'Cache-Control': cache },
    });
  }
  return new NextResponse(new Uint8Array(writeXlsx(sheets)), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${file}.xlsx"`, 'Cache-Control': cache,
    },
  });
}

export const datasetSheet = (d: Dataset, rows: Record<string, unknown>[]) => ({ name: d.label, rows: tableOf(d, rows) });
