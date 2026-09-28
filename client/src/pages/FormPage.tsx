import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Link } from "wouter";
import { ShieldX, Home, RefreshCw } from "lucide-react";
import Register from "./Register";

/**
 * Public entry for activated forms: /form/<token>.
 *
 * Resolves the token against the server (active? which type?) and renders
 * the Register page in that mode. When the admin terminates the form — or
 * the token is unknown — shows a closed-form screen. A terminated form can
 * be re-activated later (a new token), so offer a re-check action.
 */
export default function FormPage() {
  // wouter's rest syntax: the splat param is exposed under the literal key
  const [match, params] = useRoute("/form/:token*");
  const token =
    (params as Record<string, string | undefined> | null)?.["token*"] ?? "";
  const [check, setCheck] = useState(0);
  const [state, setState] = useState<"loading" | "active" | "closed">(
    "loading"
  );
  const [type, setType] = useState<"pending" | "registration" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/trpc/form.resolve?batch=1&input=${encodeURIComponent(
      JSON.stringify({ 0: { json: { token } } })
    )}`)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return;
        try {
          const payload = body[0]?.result?.data?.json ?? body[0]?.result?.data;
          if (payload?.active) {
            setType(payload.type);
            setState("active");
          } else {
            setState("closed");
          }
        } catch {
          setState("closed");
        }
      })
      .catch(() => !cancelled && setState("closed"));
    return () => {
      cancelled = true;
    };
  }, [token, check]);

  if (!match || !token) {
    return (
      <div className="register-page">
        <div className="reg-card reg-success">
          <div className="reg-success-icon" style={{ color: "#b91c1c" }}>
            <ShieldX size={30} />
          </div>
          <h1>Form link is incomplete</h1>
          <p className="reg-success-sub">
            This link is missing its form identifier. Please ask HRS staff for
            the correct link.
          </p>
          <div className="reg-success-actions">
            <Link href="/" className="reg-btn reg-btn-primary">
              <Home size={16} /> Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="register-page">
        <div className="reg-card reg-success">
          <div className="reg-success-icon">
            <RefreshCw size={26} className="syncing-icon" />
          </div>
          <h1>Loading form…</h1>
        </div>
      </div>
    );
  }

  if (state !== "active" || !type) {
    return (
      <div className="register-page">
        <div className="reg-card reg-success">
          <div className="reg-success-icon" style={{ color: "#b91c1c" }}>
            <ShieldX size={30} />
          </div>
          <h1>This form is closed</h1>
          <p className="reg-success-sub">
            The form you're trying to open is no longer accepting responses.
            If a camp or drive is currently running, please ask HRS staff for
            the new link.
          </p>
          <div className="reg-success-actions">
            <button
              type="button"
              className="reg-btn reg-btn-ghost"
              onClick={() => setCheck(c => c + 1)}
            >
              <RefreshCw size={16} /> Check again
            </button>
            <Link href="/" className="reg-btn reg-btn-primary">
              <Home size={16} /> Back to home
            </Link>
          </div>
        </div>
        </div>
    );
  }

  return (
    <Register
      key={token}
      formType={type}
      formToken={token}
    />
  );
}
