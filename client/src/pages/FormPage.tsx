import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { RefreshCw, ShieldX } from "lucide-react";
import Register from "./Register";

/**
 * Public entry for form links: /form/<token>.
 *
 * These pages are STANDALONE capture pages — no site header, no logo, no
 * navigation, no footer links to the portal. The ONLY thing on the page is
 * the form itself, headed by the admin's custom title/description for that
 * camp or generation.
 *
 * Resolves the token against the server (live? which type? custom config?)
 * and renders the Register page in that mode. A closed or unknown token
 * shows a minimal closed screen (no portal navigation).
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
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);

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
            setTitle(payload.title ?? null);
            setDescription(payload.description ?? null);
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
      <div className="form-standalone">
        <div className="reg-card reg-success">
          <div className="reg-success-icon" style={{ color: "#b91c1c" }}>
            <ShieldX size={30} />
          </div>
          <h1>Form link is incomplete</h1>
          <p className="reg-success-sub">
            This link is missing its form identifier. Please ask the HRS
            volunteer who shared it with you.
          </p>
          <div className="reg-success-actions">
            <button
              type="button"
              className="reg-btn reg-btn-ghost"
              onClick={() => setCheck(c => c + 1)}
            >
              <RefreshCw size={16} /> Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="form-standalone">
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
      <div className="form-standalone">
        <div className="reg-card reg-success">
          <div className="reg-success-icon" style={{ color: "#b91c1c" }}>
            <ShieldX size={30} />
          </div>
          <h1>This form is closed</h1>
          <p className="reg-success-sub">
            The form you're trying to open is no longer accepting responses.
            If a camp or drive is currently running, please ask the HRS
            volunteer who shared this link for the new one.
          </p>
          <div className="reg-success-actions">
            <button
              type="button"
              className="reg-btn reg-btn-ghost"
              onClick={() => setCheck(c => c + 1)}
            >
              <RefreshCw size={16} /> Check again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-standalone">
      <Register
        key={token}
        formType={type}
        formToken={token}
        formTitle={title}
        formDescription={description}
      />
    </div>
  );
}
