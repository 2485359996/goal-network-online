import { login, signup } from "./actions";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <form className="login-panel">
        <h1>目标网络</h1>
        <label>
          邮箱
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          密码
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <div className="login-actions">
          <button formAction={login} type="submit" className="primary-button">
            登录
          </button>
          <button formAction={signup} type="submit" className="secondary-button">
            注册
          </button>
        </div>
      </form>
    </main>
  );
}
