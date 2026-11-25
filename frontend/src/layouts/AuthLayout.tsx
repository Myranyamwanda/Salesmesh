import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";
import { KenyaMesh } from "../components/KenyaMesh";
import { BrandLogo } from "../components/VisualIdentity";

export function AuthLayout({ children }: PropsWithChildren) {
  return (
    <main className="auth-frame">
      <aside className="brand-panel" aria-label="SalesMesh">
        <Link className="brand-lockup" to="/login">
          <BrandLogo />
        </Link>
        <div className="brand-copy">
          <h2>Every connection starts here.</h2>
          <p className="brand-subtitle">
            A secure workspace for teams, agents, and clients.
          </p>
        </div>
        <KenyaMesh className="brand-mesh" />
      </aside>
      <section className="auth-main">
        <div className="auth-content">{children}</div>
      </section>
    </main>
  );
}
