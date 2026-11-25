import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { PageLoading } from "../components/PageLoading";
import { LogoMark } from "../components/VisualIdentity";

/** A single, mobile-first column for pages customers open without signing in. */
export function PublicLayout() {
  return (
    <div className="public-frame identity-public">
      <header className="public-header">
        <LogoMark size={32} />
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
