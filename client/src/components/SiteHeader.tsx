import { Link, useLocation } from "wouter";
import { House, Info, LayoutDashboard, LogIn, PhoneCall } from "lucide-react";
import { useStaffAuth } from "@/lib/staffAuth";
import hrsLogo from "@/assets/hrs-logo.png";

function LogoMark() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <img
        src={hrsLogo}
        alt="HRS"
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
  const [location] = useLocation();
  const { staff } = useStaffAuth();
  const isLoggedIn = !!staff && staff.active;

  const isForm = location.startsWith("/form/");
  const isHome = location === "/";

  if (location === "/admin") return null;
  if (isForm) return null;

  const openEmergency = () => {
    if (location === "/" || location === "/about") {
      window.dispatchEvent(new CustomEvent("open-emergency"));
    } else {
      window.location.href = "/?emergency=1";
    }
  };

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
        <nav className="desktop-nav" aria-label="Primary navigation">
          {isHome ? (
            <Link href="/about" className="nav-icon-link">
              <Info size={15} /> About
            </Link>
          ) : (
            <Link href="/" className="nav-icon-link">
              <House size={15} /> Home
            </Link>
          )}
          <button
            type="button"
            className="nav-icon-link nav-emergency-btn"
            onClick={openEmergency}
            aria-label="Open emergency help"
          >
            <PhoneCall size={15} /> Emergency
          </button>
          <span className="nav-divider" aria-hidden="true" />
          <Link href="/admin" className="admin-link">
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
      </div>
    </header>
  );
}
