import { FormEvent, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { useStaffAuth } from "@/lib/staffAuth";
import {
  ArrowLeft,
  ArrowRight,
  Droplets,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";

/**
 * `Field` — small labeled wrapper used by the login form (and by the admin
 * Staff & Access view, which imports it from here).
 */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`admin-field${className ? ` ${className}` : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/**
 * Shared staff login form — the SAME form used on the admin page.
 *
 * Credentials are checked by `staffRouter.login`, which tries, in order:
 *   1. the Google Sheets Volunteer tab (→ logs in as a *volunteer*),
 *   2. the hardcoded admin account,
 *   3. the Google Sheets Admin tab,
 *   4. the DB staff table.
 *
 * On success, `useStaffAuth` refetches `staff.me` and navigates logs the user
 * in on the spot; volunteers are redirected to /volunteer, admins stay put.
 */
export function StaffLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { login, isLoggingIn } = useStaffAuth();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username || !password) {
      toast.error("Enter your username and password to continue.");
      return;
    }

    try {
      const result = await login(username.trim(), password);
      if (!result.success) {
        toast.error(result.error || "Invalid username or password");
      }
      // Navigation handled by useStaffAuth onSuccess
    } catch (error) {
      console.error("Login error:", error);
      toast.error("An unexpected error occurred during login.");
    }
  };

  return (
    <div className="login-page">
      <div className="login-side">
        <Link className="login-back" href="/">
          <ArrowLeft size={16} /> Back to public portal
        </Link>
        <div className="login-side-content">
          <div className="login-symbol">
            <Droplets size={28} />
          </div>
          <span className="eyebrow light-eyebrow">STAFF WORKSPACE</span>
          <h1>
            Care starts
            <br />
            with <em>coordination.</em>
          </h1>
          <p>
            Manage verified donor records and help the relief team respond with
            confidence.
          </p>
          <div className="login-quote">
            <ShieldCheck size={18} />
            <span>
              All public searches keep phone numbers and email addresses
              private.
            </span>
          </div>
        </div>
        <span className="login-side-foot">HRS · Internal operations</span>
      </div>
      <div className="login-form-area">
        <div className="login-form-wrap">
          <div className="mobile-login-brand">
            <div className="logo-mark">
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
            <strong>HRS</strong>
          </div>
          <span className="eyebrow dark-eyebrow">AUTHORIZED ACCESS</span>
          <h2>Welcome back.</h2>
          <p className="login-copy">Sign in to manage blood donor records.</p>
          <form onSubmit={submit} className="login-form" autoComplete="off">
            <Field label="Username">
              <div className="admin-input">
                <UserRound size={17} />
                <input
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  placeholder="Enter username"
                  autoComplete="off"
                  disabled={isLoggingIn}
                />
              </div>
            </Field>
            <Field label="Password">
              <div className="admin-input">
                <KeyRound size={17} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="Enter password"
                  autoComplete="off"
                  disabled={isLoggingIn}
                />
                <button
                  type="button"
                  className="input-icon-button"
                  onClick={() => setShowPassword(value => !value)}
                  disabled={isLoggingIn}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>
            <button
              className="primary-button wide-button"
              type="submit"
              disabled={isLoggingIn}
              style={{ gap: isLoggingIn ? "10px" : "6px" }}
            >
              {isLoggingIn ? (
                <>
                  Signing in...{" "}
                  <span
                    className="spinner"
                    style={{
                      width: "16px",
                      height: "16px",
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "white",
                      marginBottom: 0,
                    }}
                  ></span>
                </>
              ) : (
                <>
                  Sign in <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          <div className="login-note">
            <LockKeyhole size={14} />
            <span>
              Credentials are checked against the authorized HRS staff and
              volunteer directory.
            </span>
          </div>
          <div className="demo-hint">
            Use your staff username and password from the Google Sheets directory.
          </div>
        </div>
      </div>
    </div>
  );
}

export default StaffLogin;