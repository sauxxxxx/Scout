import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://scout-sales-workspace.infojoynoinc.chatgpt.site'),
  title: 'Scout — Sales workspace',
  description: 'A focused sales operating system for finding, qualifying, and closing the right leads.',
  openGraph: {
    title: 'Scout — Sales workspace',
    description: 'Your sales work, clearly in view.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Scout — Your sales work, clearly in view.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Scout — Sales workspace',
    description: 'Your sales work, clearly in view.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
