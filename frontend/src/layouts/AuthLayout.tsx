import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";

export function AuthLayout({ children }: PropsWithChildren) {
  return (
    <main className="auth-frame">
      <aside className="brand-panel" aria-label="SalesMesh">
        <Link className="brand-lockup" to="/login" aria-label="SalesMesh home">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>SalesMesh</span>
        </Link>
        <div className="brand-copy">
          <p className="eyebrow">DISTRIBUTED ONBOARDING</p>
          <h2>Every connection starts here.</h2>
          <p className="brand-subtitle">
            A secure workspace for teams, agents, and clients.
          </p>
        </div>
        <div className="brand-art" aria-hidden="true">
          <div className="art-ring art-ring-one" />
          <div className="art-ring art-ring-two" />
          <div className="art-node art-node-one" />
          <div className="art-node art-node-two" />
          <div className="art-node art-node-three" />
          <div className="art-line art-line-one" />
          <div className="art-line art-line-two" />
          <div className="art-line art-line-three" />
          <div className="art-caption">A considered start</div>
        </div>
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
