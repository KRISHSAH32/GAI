import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vidyashilp University — AI Academic Advisor (Improved RAG)',
  description: 'Grounded AI Academic Advisor with Hybrid Retrieval, Fact Checking & Regulation Verification.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-50 text-slate-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}
