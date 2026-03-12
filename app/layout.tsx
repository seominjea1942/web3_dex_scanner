import type { Metadata } from "next";
import localFont from "next/font/local";
import { Roboto, Roboto_Mono } from "next/font/google";
import { ThemeProvider } from "./providers";
import "./globals.css";

const moderat = localFont({
  src: [
    { path: "../public/fonts/Moderat-Light.otf", weight: "300", style: "normal" },
    { path: "../public/fonts/Moderat-Regular.otf", weight: "400", style: "normal" },
    { path: "../public/fonts/Moderat-Medium.otf", weight: "500", style: "normal" },
    { path: "../public/fonts/Moderat-Bold.otf", weight: "700", style: "normal" },
  ],
  variable: "--font-moderat",
  display: "swap",
});

const moderatMono = localFont({
  src: [
    { path: "../public/fonts/Moderat-Mono-Light.otf", weight: "300", style: "normal" },
    { path: "../public/fonts/Moderat-Mono-Regular.otf", weight: "400", style: "normal" },
    { path: "../public/fonts/Moderat-Mono-Medium.otf", weight: "500", style: "normal" },
    { path: "../public/fonts/Moderat-Mono-Bold.otf", weight: "700", style: "normal" },
  ],
  variable: "--font-moderat-mono",
  display: "swap",
});

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-roboto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CHAINSCOPE | DEX Scanner powered by TiDB Cloud",
  description:
    "Real-time Solana DEX pool scanner with 1M+ transactions, powered by TiDB Cloud Serverless HTAP.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body
        className={`${moderat.variable} ${moderatMono.variable} ${roboto.variable} ${robotoMono.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
