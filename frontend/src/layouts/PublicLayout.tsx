import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { PageLoading } from "../components/PageLoading";

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
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="public-footer">
        SalesMesh · Secure customer registration
      </footer>
    </div>
  );
}
