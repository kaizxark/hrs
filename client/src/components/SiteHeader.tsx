import { useState } from "react";
import { Link, useLocation } from "wouter";
import { House, Info, LogIn, Menu, X } from "lucide-react";

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
  const isAbout = location === "/about";
  const isHome = location === "/";

  if (location === "/admin") return null;

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
            <strong>HRS</strong>
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
          <span className="nav-divider" aria-hidden="true" />
          <Link href="/admin" className="admin-link" onClick={closeMenu}>
            <LogIn size={15} /> Login
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
