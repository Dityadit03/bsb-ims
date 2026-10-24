export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'public-anon-key',
  workspaceDomain: process.env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN ?? '',
};
