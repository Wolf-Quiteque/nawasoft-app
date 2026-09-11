import './globals.css';
import RegisterServiceWorker from '@/components/RegisterServiceWorker';

export const metadata = {
  applicationName: 'NAWASOFT',
  title: {
    default: 'NAWASOFT',
    template: '%s · NAWASOFT',
  },
  description: 'Painel operacional NAWABUS — bilhetes, viagens e frota em tempo real.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'NAWASOFT',
  },
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: { telephone: false },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBF3E7' },
    { media: '(prefers-color-scheme: dark)', color: '#241608' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt">
      <body>
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
