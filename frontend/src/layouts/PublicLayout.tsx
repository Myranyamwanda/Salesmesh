import { Outlet } from "react-router-dom";

/** A single, mobile-first column for pages customers open without signing in. */
export function PublicLayout() {
  return (
    <div className="public-frame">
      <header className="public-header">
        <span className="brand-mark" aria-hidden="true">
          S
        </span>
        <span>SalesMesh</span>
      </header>
      <main className="public-main">
        <Outlet />
      </main>
      <footer className="public-footer">
        SalesMesh · Secure customer registration
      </footer>
    </div>
  );
}
