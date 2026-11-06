import type { Metadata } from 'next';
import './globals.css';

const description = 'Find local businesses, track follow-ups and manage your sales pipeline.';

// Runs before the page paints, so nobody sees a white flash or their text jump to another size.
const themeScript = "try{var t=localStorage.getItem('scout.theme')||'System';if(t==='Dark'||(t==='System'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark';var d=document.documentElement.dataset;[['scout.fontSize','fontSize'],['scout.density','density'],['scout.accent','accent']].forEach(function(p){var v=localStorage.getItem(p[0]);if(v)d[p[1]]=v})}catch(e){}";

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
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body>{children}</body></html>;
}
