import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { siteMismatch } from '@/lib/site-guard';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  // hanya izinkan path internal agar tidak bisa dipakai untuk open redirect
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const site = searchParams.get('site');
      const actual = await siteMismatch(site);
      if (actual) return NextResponse.redirect(`${origin}/login?error=site&site=${encodeURIComponent(site ?? '')}&akun=${actual}`);
      return NextResponse.redirect(`${origin}${target}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=1`);
}
