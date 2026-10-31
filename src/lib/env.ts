export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'public-anon-key',
  // alamat aplikasi untuk tautan di Excel/Sheets (foto temuan dan perbaikan)
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? 'https://bsb-ims.vercel.app').replace(/\/$/, ''),
  workspaceDomain: process.env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN ?? '',
};
