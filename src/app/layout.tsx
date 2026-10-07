import type { Metadata } from "next";
import { getTheme } from "@/features/preferences";
import { getLocale, getT } from "@/i18n";
import { faceVariables, fontVariables } from "./fonts";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.meta.title, description: t.meta.description };
}

/**
 * `<html lang>` follows the locale cookie (ADR 0010) and `data-theme` the theme cookie (ARCHITECTURE 8.4);
 * with no theme cookie the attribute is absent and tokens.css follows `prefers-color-scheme`.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);
  return (
    <html
      lang={locale}
      data-theme={theme ?? undefined}
      className={`${fontVariables} h-full antialiased`}
      style={faceVariables}
    >
      <body className="type-body flex min-h-full flex-col bg-bg text-fg">{children}</body>
    </html>
  );
}
