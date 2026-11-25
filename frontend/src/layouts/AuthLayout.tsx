import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import ErrorRounded from "@mui/icons-material/ErrorRounded";
import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "../components/VisualIdentity";

/**
 * A stylised picture of the admin dashboard. Decorative only (hidden from
 * screen readers): the figures are illustrative, not data.
 */
function DashboardPreview() {
  return (
    <div className="brand-preview" aria-hidden="true">
      <div className="brand-preview-head">
        <span>Network overview</span>
        <span className="brand-preview-pill">This month</span>
      </div>
      <div className="brand-preview-stats">
        <div>
          <span>Reputation</span>
          <strong>94.5</strong>
        </div>
        <div>
          <span>Flag rate</span>
          <strong>6.3%</strong>
        </div>
      </div>
      <div className="brand-preview-bars">
        {[42, 55, 48, 66, 72, 88].map((height, index) => (
          <span key={index} style={{ height: `${height}%` }} />
        ))}
      </div>
      <ul className="brand-preview-agents">
        <li>
          <span className="brand-preview-avatar">AW</span> Amina W.
          <span className="brand-preview-band brand-preview-band-low">
            <CheckCircleRounded fontSize="inherit" /> Low risk
          </span>
        </li>
        <li>
          <span className="brand-preview-avatar">KM</span> Kevin M.
          <span className="brand-preview-band brand-preview-band-high">
            <ErrorRounded fontSize="inherit" /> High risk
          </span>
        </li>
      </ul>
    </div>
  );
}

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
        <DashboardPreview />
      </aside>
      <section className="auth-main">
        <div className="auth-content">{children}</div>
      </section>
    </main>
  );
}
