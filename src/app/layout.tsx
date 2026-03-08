import type { Metadata } from 'next'
import './globals.css'

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
    <html lang="sv">
      <body className="bg-gray-50 min-h-screen">
        {children}
      </body>
    </html>
  )
}
