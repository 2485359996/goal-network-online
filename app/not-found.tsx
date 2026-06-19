import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main id="main-content" className="login-shell auth-shell compact-auth-shell">
      <section className="login-brief compact" aria-label="页面未找到说明">
        <div className="login-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">404</p>
        <h1>这颗节点不在当前星图里</h1>
        <p>链接可能已经移动，或者你当前的会话还没有权限查看它。</p>
      </section>
      <section className="login-panel">
        <div className="login-panel-head">
          <p className="eyebrow">页面未找到</p>
          <h2>返回目标网络</h2>
          <p>回到星图后，可以从目标地图或登录状态继续定位。</p>
        </div>
        <div className="login-actions">
          <Link className="primary-button" href="/">
            回到星图
          </Link>
          <Link className="secondary-button" href="/login">
            前往登录
          </Link>
        </div>
      </section>
    </main>
  );
}
