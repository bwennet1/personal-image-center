import Link from "next/link";

export default function HomePage() {
  return (
    <div className="auth-shell">
      <section className="auth-brand">
        <div>
          <div className="mark" />
          <h1>个人图片中心</h1>
          <p>把相册、幻灯片和家庭纪念网页放在同一份图片资产上。原图永不被编辑覆盖。</p>
        </div>
        <p>Personal · Family · Team</p>
      </section>
      <section className="auth-panel">
        <div className="card">
          <h2>开始使用</h2>
          <p className="sub">登录后进入当前空间的图库，而不是管理后台。</p>
          <Link className="btn" href="/login">
            登录
          </Link>
          <div style={{ height: 12 }} />
          <Link className="btn ghost" href="/register">
            注册账号
          </Link>
        </div>
      </section>
    </div>
  );
}
