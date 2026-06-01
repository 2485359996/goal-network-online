export default async function ErrorPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const params = await searchParams;
  return (
    <main className="login-shell">
      <section className="login-panel">
        <h1>请求失败</h1>
        <p>{params.message || "请返回后重试。"}</p>
      </section>
    </main>
  );
}
