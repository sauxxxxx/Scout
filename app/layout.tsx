import type { Metadata } from 'next';
import './globals.css';

const description = 'Find local businesses, track follow-ups and manage your sales pipeline.';

export const metadata: Metadata = {
  metadataBase: new URL('https://scoutcrm.pages.dev'),
  title: 'Scout',
  description,
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'Scout',
    description,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Scout' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Scout',
    description,
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
