import { Link, useLocation } from "wouter";
import { House, Info, LayoutDashboard, LockKeyhole, PhoneCall } from "lucide-react";
import { useStaffAuth } from "@/lib/staffAuth";

interface MobileBottomNavProps {
  onOpenEmergency: () => void;
}

export default function MobileBottomNav({ onOpenEmergency }: MobileBottomNavProps) {
  const [location] = useLocation();
  const { staff } = useStaffAuth();
  const isLoggedIn = !!staff && staff.active;

  const isHome = location === "/";

  return (
    <nav className="mobile-bottom-nav" aria-label="Navigation">
      {isHome ? (
        <Link className="nav-slot nav-left" href="/about">
          <Info size={20} />
          <span>About</span>
        </Link>
      ) : (
        <Link className="nav-slot nav-left" href="/">
          <House size={20} />
          <span>Home</span>
        </Link>
      )}

      <button
        type="button"
        className="nav-slot emergency-tab"
        onClick={onOpenEmergency}
        aria-label="Open emergency help"
      >
        <span className="emergency-tab-icon">
          <PhoneCall size={26} />
        </span>
        <span>Emergency</span>
      </button>

      <Link className="nav-slot nav-right" href="/admin">
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
