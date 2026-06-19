import { redirect } from "next/navigation";
import Link from "next/link";

export default async function ErrorPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const params = await searchParams;
  if (params.message === "Invalid login credentials") {
    redirect("/login?error=invalid_credentials");
  }

  return (
    <main id="main-content" className="login-shell auth-shell compact-auth-shell">
      <section className="login-brief compact" aria-label="请求失败说明">
        <div className="login-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">连接中断</p>
        <h1>这次请求没有抵达轨道</h1>
        <p>返回登录页后可以重新建立会话。如果问题持续出现，请检查 Supabase 配置。</p>
      </section>
      <section className="login-panel">
        <div className="login-panel-head">
          <p className="eyebrow">请求失败</p>
          <h2>请重新尝试</h2>
          <p>{params.message || "请返回后重试。"}</p>
        </div>
        <div className="login-actions">
          <Link className="primary-button" href="/login">
            返回登录
          </Link>
          <Link className="secondary-button" href="/">
            回到星图
          </Link>
        </div>
      </section>
    </main>
  );
}
