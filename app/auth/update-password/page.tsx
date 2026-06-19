import Link from "next/link";
import { updatePassword } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  password_too_short: "新密码至少需要 6 位。",
  password_mismatch: "两次输入的新密码不一致。",
  update_failed: "密码更新失败，请重新打开邮件中的重置链接后再试。"
};

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] || "密码更新失败，请稍后重试。" : null;

  return (
    <main id="main-content" className="login-shell auth-shell compact-auth-shell">
      <section className="login-brief compact" aria-label="密码重置说明">
        <div className="login-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">账户安全</p>
        <h1>为你的星图换一把新钥匙</h1>
        <p>保存后请使用新密码重新登录，目标网络会继续读取同一个云端工作区。</p>
      </section>
      <form className="login-panel">
        <div className="login-panel-head">
          <p className="eyebrow">重置密码</p>
          <h2>设置新密码</h2>
          <p>至少 6 位。两次输入需要保持一致。</p>
        </div>
        {errorMessage ? <p className="login-message login-message-error">{errorMessage}</p> : null}
        <label>
          <span>新密码</span>
          <input name="password" type="password" autoComplete="new-password" minLength={6} required />
        </label>
        <label>
          <span>确认新密码</span>
          <input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} required />
        </label>
        <div className="login-actions">
          <button formAction={updatePassword} type="submit" className="primary-button">
            保存新密码
          </button>
          <Link className="secondary-button" href="/login">
            返回登录
          </Link>
        </div>
      </form>
    </main>
  );
}
