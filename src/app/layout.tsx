import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });
const barlow = Barlow_Condensed({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-barlow' });

export const metadata: Metadata = {
  title: { default: 'BSB IMS', template: '%s · BSB IMS' },
  description: 'BSB Integrated Management System · PT Berkarya Sejahtera Bersama',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#232826', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${plex.variable} ${plexMono.variable} ${barlow.variable}`}>
      <body className="min-h-dvh font-sans text-[15px] leading-relaxed antialiased">{children}</body>
    </html>
  );
}
