import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../src/client/styles.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap"
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap"
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "目标网络",
    template: "%s · 目标网络"
  },
  description: "把目标、子方向、行动候选和复盘问题整理成可探索的个人星图。",
  applicationName: "目标网络",
  openGraph: {
    title: "目标网络",
    description: "把个人目标整理成可探索、可同步、可复盘的星图。",
    images: [
      {
        url: "/goal-network-og.svg",
        width: 1200,
        height: 630,
        alt: "目标网络星图界面"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "目标网络",
    description: "把个人目标整理成可探索、可同步、可复盘的星图。",
    images: ["/goal-network-og.svg"]
  }
};

// 预绘制主题脚本：必须先于首帧执行，否则深色用户每次加载都会闪白。
// 逻辑与 src/client/theme.ts 的 readStoredTheme + applyThemePreference 保持镜像。
const themeInitScript = `(function(){try{var p=localStorage.getItem("goal-network-theme");if(p!=="light"&&p!=="dark"&&p!=="system")p="system";var t=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;var r=document.documentElement;r.dataset.theme=t;r.dataset.themePreference=p;r.style.colorScheme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
