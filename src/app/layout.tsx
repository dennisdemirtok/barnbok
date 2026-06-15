import type { Metadata } from 'next'
import { Quicksand, Be_Vietnam_Pro } from 'next/font/google'
import './globals.css'
import Providers from './providers'

const quicksand = Quicksand({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-heading',
  display: 'swap',
})

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Bokverktyget - Skapa barnböcker med AI',
  description: 'Skapa kompletta barnböcker med konsekventa karaktärer via AI-bildgenerering',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="sv" className={`${quicksand.variable} ${beVietnamPro.variable}`}>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
