import { Link, useLocation } from "wouter";
import { House, Info, LayoutDashboard, LockKeyhole, PhoneCall, UserRoundPlus } from "lucide-react";
import { useStaffAuth } from "@/lib/staffAuth";

interface MobileBottomNavProps {
  onOpenEmergency: () => void;
}

export default function MobileBottomNav({ onOpenEmergency }: MobileBottomNavProps) {
  const [location] = useLocation();
  const { staff } = useStaffAuth();
  const isLoggedIn = !!staff && staff.active;

  const isHome = location === "/";
  const isAbout = location === "/about";
  const isRegister = location === "/register";
  const isAdmin = location === "/admin";

  const handleHomeClick = (e: React.MouseEvent) => {
    if (isHome) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      <Link
        className={`nav-slot${isHome ? " selected" : ""}`}
        href="/"
        onClick={handleHomeClick}
      >
        <House size={20} />
        <span>Home</span>
      </Link>
      <Link
        className={`nav-slot${isAbout ? " selected" : ""}`}
        href="/about"
      >
        <Info size={20} />
        <span>About</span>
      </Link>
      <button
        type="button"
        className="nav-slot emergency-tab"
        onClick={onOpenEmergency}
        aria-label="Open emergency help"
      >
        <span className="emergency-tab-icon">
          <PhoneCall size={24} />
        </span>
        <span>Emergency</span>
      </button>
      <Link
        className={`nav-slot${isRegister ? " selected" : ""}`}
        href="/register"
      >
        <UserRoundPlus size={20} />
        <span>Register</span>
      </Link>
      <Link
        className={`nav-slot${isAdmin ? " selected" : ""}`}
        href="/admin"
      >
        {isLoggedIn ? (
          <>
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </>
        ) : (
          <>
            <LockKeyhole size={20} />
            <span>Login</span>
          </>
        )}
      </Link>
    </nav>
  );
}
