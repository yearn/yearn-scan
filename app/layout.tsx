import type { ReactNode } from 'react';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><head><title>Yearn Scan</title><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body>{children}</body></html>;
}
