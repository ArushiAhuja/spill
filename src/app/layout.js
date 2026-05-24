import { Outfit, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['300', '400', '500', '600'],
})
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
})

export const metadata = {
  title: 'spill',
  description: 'watch the internet before it becomes a problem.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${outfit.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
