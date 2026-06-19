const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "登录请求失败，请稍后重试。",
  config_missing: "本地登录服务配置缺失。",
  forbidden: "登录请求来源异常，请重试。",
  email_already_registered: "这个邮箱已经注册，请直接登录，或使用下方的重置密码。",
  email_not_confirmed: "这个邮箱还没有完成确认，请先查看邮箱中的确认邮件。",
  email_required: "请先填写邮箱，再发送重置密码邮件。",
  invalid_credentials: "邮箱或密码不正确。你可以重新输入，或重置密码。",
  password_rejected: "密码不符合 Supabase 的安全要求，请换一个更强的密码。",
  reset_failed: "重置密码邮件发送失败，请稍后重试。"
};

const STATUS_MESSAGES: Record<string, string> = {
  reset_email_sent: "如果这个邮箱已注册，重置密码邮件会很快发送到你的邮箱。",
  signup_check_email: "注册请求已提交，请查看邮箱并完成确认。"
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ email?: string; error?: string; status?: string }> }) {
  const params = await searchParams;
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const errorMessage = !supabaseConfigured
    ? "本地登录服务配置缺失。请在 .env.local 中设置 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 后重启预览服务。"
    : params.error
      ? ERROR_MESSAGES[params.error] || "登录请求失败，请稍后重试。"
      : null;
  const statusMessage = params.status ? STATUS_MESSAGES[params.status] : null;

  return (
    <main id="main-content" className="login-shell auth-shell">
      <section className="login-brief" aria-label="目标网络说明">
        <div className="login-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">目标网络</p>
        <h1>登录后进入你的目标地图</h1>
        <p>查看目标树、编辑目标和行动候选，并同步保存你的最新改动。</p>
      </section>
      <form className="login-panel" action="/auth/session" method="post">
        <div className="login-panel-head">
          <p className="eyebrow">邮箱账户</p>
          <h2>登录或注册</h2>
          <p>使用邮箱和密码登录。新用户可直接注册，注册后请按邮件完成确认。</p>
        </div>
        {errorMessage ? <p className="login-message login-message-error">{errorMessage}</p> : null}
        {statusMessage ? <p className="login-message login-message-success">{statusMessage}</p> : null}
        <label>
          <span>邮箱</span>
          <input name="email" type="email" autoComplete="email" defaultValue={params.email || ""} required />
        </label>
        <label>
          <span>密码</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <div className="login-actions">
          <button name="intent" value="login" type="submit" className="primary-button" disabled={!supabaseConfigured}>
            登录
          </button>
          <button name="intent" value="signup" type="submit" className="secondary-button" disabled={!supabaseConfigured}>
            注册
          </button>
        </div>
        <div className="login-help-row">
          <button name="intent" value="reset" formNoValidate type="submit" className="login-link-button" disabled={!supabaseConfigured}>
            忘记密码？发送重置邮件
          </button>
        </div>
      </form>
    </main>
  );
}
