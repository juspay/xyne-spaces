import { METADATA, VIEWPORT } from "@/lib/site";
import { fonts } from "@/lib/font";
import "./globals.css";
import Navbar from "@/components/Navbar";
// !TODO: Add Providers here
// import Providers from "@/components/providers";

export const metadata = METADATA;
export const viewport = VIEWPORT;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${fonts} antialiased`}>
        <a href="#main-content" className="skip-to-content">
          Skip to content
        </a>
        <main id="" className="relative">
          <Navbar />
          {children}
        </main>
      </body>
    </html>
  );
}
