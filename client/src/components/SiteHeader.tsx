import { useState } from "react";
import { Link, useLocation } from "wouter";
import { House, Info, LayoutDashboard, LogIn, Menu, UserRoundPlus, X } from "lucide-react";
import { useStaffAuth } from "@/lib/staffAuth";

function LogoMark() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <img
        src="/hrs-logo.png"
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          borderRadius: "inherit",
        }}
      />
    </div>
  );
}

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();
  const { staff } = useStaffAuth();
  const isLoggedIn = !!staff && staff.active;

  const isForm = location.startsWith("/form/");
  const isAbout = location === "/about";
  const isHome = location === "/";
  const isRegister = location === "/register";

  if (location === "/admin") return null;

  // Form links (/form/<token>) are STANDALONE capture pages: no logo, no
  // navigation, no login — nothing but the form itself.
  if (isForm) return null;

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link
          className="brand"
          href="/"
          aria-label="HRS Blood Donor Portal home"
        >
          <LogoMark />
          <span>
            <strong>Humanitarian Relief Society</strong>
            <small>Blood Donor Portal</small>
          </span>
        </Link>
        <nav
          className={`desktop-nav ${menuOpen ? "nav-open" : ""}`}
          aria-label="Primary navigation"
        >
          <Link
            href="/"
            className={`nav-icon-link${isHome ? " active" : ""}`}
            onClick={closeMenu}
          >
            <House size={15} /> Home
          </Link>
          <Link
            href="/about"
            className={`nav-icon-link${isAbout ? " active" : ""}`}
            onClick={closeMenu}
          >
            <Info size={15} /> About
          </Link>
          <Link
            href="/register"
            className={`nav-icon-link nav-register${isRegister ? " active" : ""}`}
            onClick={closeMenu}
          >
            <UserRoundPlus size={15} /> Register
          </Link>
          <span className="nav-divider" aria-hidden="true" />
          <Link href="/admin" className="admin-link" onClick={closeMenu}>
            {isLoggedIn ? (
              <>
                <LayoutDashboard size={15} /> Dashboard
              </>
            ) : (
              <>
                <LogIn size={15} /> Login
              </>
            )}
          </Link>
        </nav>
        <button
          className="mobile-menu-button"
          onClick={() => setMenuOpen(open => !open)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>
    </header>
  );
}
