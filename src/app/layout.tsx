import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-jakarta' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: { default: 'BSB IMS', template: '%s · BSB IMS' },
  description: 'BSB Integrated Management System · PT Berkarya Sejahtera Bersama',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#ffffff', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${jakarta.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh font-sans text-[15px] leading-normal antialiased">{children}</body>
    </html>
  );
}
