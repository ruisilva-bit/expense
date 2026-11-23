import type { Metadata, Viewport } from "next";
import {
  Cormorant_Garamond,
  DM_Sans,
  DM_Serif_Display,
  Geist,
  Geist_Mono,
  Manrope,
  Space_Grotesk,
} from "next/font/google";
import "./globals.css";
import "./themes.css";
import { AppProvider } from "@/context/AppState";
import { ThemeProvider } from "@/context/ThemeContext";
import {
  COLOR_MODE_STORAGE_KEY,
  DEFAULT_VISUAL_THEME,
  VISUAL_THEME_IDS,
  VISUAL_THEME_STORAGE_KEY,
} from "@/lib/theme-preferences";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const dmSerif = DM_Serif_Display({
  variable: "--font-dm-serif-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const cormorantGaramond = Cormorant_Garamond({
  variable: "--font-cormorant-garamond",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const themeInitScript = `
(() => {
  try {
    const supportedThemes = ${JSON.stringify(VISUAL_THEME_IDS)};
    const savedTheme = localStorage.getItem(${JSON.stringify(VISUAL_THEME_STORAGE_KEY)});
    const visualTheme = supportedThemes.includes(savedTheme) ? savedTheme : ${JSON.stringify(DEFAULT_VISUAL_THEME)};
    const savedMode = localStorage.getItem(${JSON.stringify(COLOR_MODE_STORAGE_KEY)});
    const colorMode = savedMode === "light" || savedMode === "dark"
      ? savedMode
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const root = document.documentElement;
    root.dataset.visualTheme = visualTheme;
    root.classList.toggle("dark", colorMode === "dark");
    root.style.colorScheme = colorMode;
  } catch {}
})();`;

export const metadata: Metadata = {
  title: "HomeFund",
  description: "HomeFund - multi-user household finance tracking",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f6f7fb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fontVariables = [
    geist.variable,
    geistMono.variable,
    manrope.variable,
    spaceGrotesk.variable,
    dmSans.variable,
    dmSerif.variable,
    cormorantGaramond.variable,
  ].join(" ");

  return (
    <html
      lang="en"
      className={fontVariables}
      data-visual-theme="minimal"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <AppProvider>{children}</AppProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
