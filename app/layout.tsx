import type { Metadata } from "next";
import "../src/client/styles.css";

export const metadata: Metadata = {
  title: "Goal Network",
  description: "Goal network management system"
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
      <body>{children}</body>
    </html>
  );
}
