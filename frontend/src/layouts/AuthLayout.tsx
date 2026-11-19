import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";
import { MeshMark } from "../components/VisualIdentity";

export function AuthLayout({ children }: PropsWithChildren) {
  return (
    <main className="auth-frame">
      <aside className="brand-panel" aria-label="SalesMesh">
        <Link className="brand-lockup" to="/login">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>SalesMesh</span>
        </Link>
        <div className="brand-copy">
          <p className="eyebrow">TRUSTED BY DESIGN</p>
          <h2>Good work moves through good connections.</h2>
          <p className="brand-subtitle">
            One clear path for teams, agents, and the people they serve.
          </p>
        </div>
        <MeshMark className="brand-art" />
        <p className="brand-foot">SALESMESH · SECURE ACCESS</p>
      </aside>
      <section className="auth-main">
        <div className="auth-topline">
          <span>Workspace access</span>
          <span className="status-indicator">
            <span /> Secure sign-in
          </span>
        </div>
        <div className="auth-content">{children}</div>
        <footer className="auth-footer">
          <span>SalesMesh</span>
          <span>Account access</span>
        </footer>
      </section>
    </main>
  );
}
