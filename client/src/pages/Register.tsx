import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  KA_DISTRICTS,
  kaAreasForDistrict,
} from "@shared/kaDistricts";
import {
  Droplets,
  Check,
  ChevronDown,
  ArrowRight,
  ArrowLeft,
  HeartHandshake,
  ShieldCheck,
  UserRound,
  PartyPopper,
  Copy,
  Home,
  AlertCircle,
  X,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const BLOOD_GROUPS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Month dropdown options: the user sees the name, the form stores the
 *  1-based number as a string ("1"…"12") so date math stays numeric.
 *  (Previously the dropdown stored the NAME, and Number("June") === NaN
 *  poisoned the ISO date → age showed 0 and Postgres rejected the insert.) */
export const MONTH_OPTIONS = MONTHS.map((name, i) => ({
  value: String(i + 1),
  label: name,
}));

/** Strict ISO date (YYYY-MM-DD) — what the server and Postgres expect. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const GENDERS = ["Male", "Female", "Other"] as const;

/** Current year back to 1940, newest first (module-level, no hooks). */
const YEARS: number[] = (() => {
  const years: number[] = [];
  for (let y = new Date().getFullYear(); y >= 1940; y--) years.push(y);
  return years;
})();

/** Days in the selected month (leap-year aware). month is 1-based. */
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Exact age in completed years. Returns null for a malformed date — the
 * caller hides the age badge instead of displaying a nonsense "0 years".
 */
function exactAge(iso: string): number | null {
  if (!ISO_DATE_RE.test(iso)) return null;
  const birth = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) a--;
  return a;
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function StepBadge({
  n,
  active,
  done,
}: {
  n: number;
  active: boolean;
  done: boolean;
}) {
  return (
    <span
      className={`reg-step-badge${active ? " active" : ""}${done ? " done" : ""}`}
      aria-hidden
    >
      {done ? <Check size={13} strokeWidth={3} /> : n}
    </span>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="reg-field">
      <span className="reg-field-label">
        {label}
        {required && <em>*</em>}
      </span>
      {children}
      {hint && !error && <span className="reg-field-hint">{hint}</span>}
      {error && <span className="reg-field-error">{error}</span>}
    </label>
  );
}

function SelectBox({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly (string | number | { value: string; label: string })[];
  placeholder: string;
}) {
  return (
    <span className="reg-select-wrap">
      <select
        className={`reg-select${value ? "" : " placeholder"}`}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map(o => {
          const opt =
            typeof o === "object" ? o : { value: String(o), label: String(o) };
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </select>
      <ChevronDown size={15} className="reg-select-caret" aria-hidden />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type FormData = {
  fullName: string;
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  gender: string;
  phone: string;
  email: string;
  city: string;
  area: string;
  bloodGroup: string;
  donorConsent: boolean | null;
  storageConsent: boolean;
};

const INITIAL: FormData = {
  fullName: "",
  dobDay: "",
  dobMonth: "",
  dobYear: "",
  gender: "",
  phone: "",
  email: "",
  city: "",
  area: "",
  bloodGroup: "",
  donorConsent: null,
  storageConsent: false,
};

export default function Register({
  formType = "registration",
  formToken,
  formTitle,
  formDescription,
}: {
  /** "registration" = full form → VERIFIED; "pending" = personal details +
   *  storage consent only → PENDING (no blood group / donor consent asked). */
  formType?: "registration" | "pending";
  /** Set when rendering a specific activated form; submits against it. */
  formToken?: string;
  /** Custom heading for this form link (admin-set, per camp/generation). */
  formTitle?: string | null;
  /** Custom sub-heading shown under the title. */
  formDescription?: string | null;
} = {}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submittedHrsId, setSubmittedHrsId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isPendingForm = formType === "pending";
  /** Standalone form-link mode: no portal chrome, custom heading, its own
   *  success screen — the page's ONLY job is capturing one person. */
  const isFormLink = Boolean(formToken);
  const heading = formTitle?.trim() || "Join the donor network";
  const subheading =
    formDescription?.trim() ||
    (isPendingForm
      ? "One short form — your details and consents. HRS staff verify your record shortly after."
      : "One short form — your details, your blood group, and your consents. Consenting donors go live on the public directory instantly.");

  // Pending-form submissions go through the form-token endpoint (server
  // validates the link is active); registration submissions go through the
  // plain register endpoint when no token is involved.
  const formPendingMutation = trpc.form.submitPending.useMutation({
    onSuccess: result => {
      if (result.success) {
        setErrors({});
        setSubmittedHrsId(result.hrsId);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setErrors({ form: result.error || "Submission failed. Please try again." });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
  });
  const formRegistrationMutation = trpc.form.submitRegistration.useMutation({
    onSuccess: result => {
      if (result.success) {
        setErrors({});
        setSubmittedHrsId(result.hrsId);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setErrors({ form: result.error || "Submission failed. Please try again." });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
  });

  const registerMutation = trpc.hrs.registerDonor.useMutation({
    onSuccess: result => {
      if (result.success) {
        setErrors({});
        setSubmittedHrsId(result.hrsId);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setErrors({
          form: result.error || "Registration failed. Please try again.",
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
  });

  /** City change swaps the area list — reset the stale area in the same
   *  stroke so a Tumakuru locality can never be saved under Mysuru. */
  function setCity(v: string) {
    setForm(prev => ({
      ...prev,
      city: v,
      area: "",
    }));
    setErrors(prev => {
      const next = { ...prev };
      delete next.city;
      delete next.area;
      return next;
    }
    );
  }

  /** Area selection via its own handler for symmetry with setCity. */
  function setArea(v: string) {
    set("area", v);
  }

  const areaOptions = useMemo(
    () => kaAreasForDistrict(form.city),
    [form.city]
  );

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /* ---------------- DOB coherence ---------------- */

  /** Clamp the chosen day to what exists in the given month/year. */
  function clampDay(day: string, month: string, year: string): string {
    if (!day) return day;
    const m = month ? Number(month) : null;
    const y = year ? Number(year) : new Date().getFullYear();
    const max = m ? daysInMonth(m, y) : 31;
    const n = Number(day);
    return n > max ? String(max) : day;
  }

  /** Month/year changes re-clamp the day IN THE SAME STROKE — no flicker,
   * and an impossible date can never be staged (Feb 31 → Feb 28). */
  function setDobMonth(v: string) {
    setForm(prev => ({
      ...prev,
      dobMonth: v,
      dobDay: clampDay(prev.dobDay, v, prev.dobYear),
    }));
    setErrors(prev =>
      prev.dob ? { ...prev, dob: undefined as unknown as string } : prev
    );
  }
  function setDobYear(v: string) {
    setForm(prev => ({
      ...prev,
      dobYear: v,
      dobDay: clampDay(prev.dobDay, prev.dobMonth, v),
    }));
    setErrors(prev =>
      prev.dob ? { ...prev, dob: undefined as unknown as string } : prev
    );
  }

  const dayOptions = useMemo(() => {
    const m = form.dobMonth ? Number(form.dobMonth) : null;
    const y = form.dobYear ? Number(form.dobYear) : new Date().getFullYear();
    const max = m ? daysInMonth(m, y) : 31;
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [form.dobMonth, form.dobYear]);

  const dobIso = useMemo(() => {
    if (!form.dobDay || !form.dobMonth || !form.dobYear) return "";
    const y = Number(form.dobYear);
    const m = Number(form.dobMonth);
    const d = Number(form.dobDay);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }, [form.dobDay, form.dobMonth, form.dobYear]);

  const age = useMemo(() => (dobIso ? exactAge(dobIso) : null), [dobIso]);

  /** Busy while ANY submit path is in flight (plain register, pending-form
   *  link, or registration-form link) — the button must never look idle
   *  while the server is working. */
  const submitting =
    registerMutation.isPending ||
    formPendingMutation.isPending ||
    formRegistrationMutation.isPending;

  /** "14 May 1999" — what the user actually picked, for the review panel. */
  const dobPretty = useMemo(() => {
    if (!dobIso) return "";
    return `${Number(form.dobDay)} ${MONTHS[Number(form.dobMonth) - 1]} ${form.dobYear}`;
  }, [dobIso, form.dobDay, form.dobMonth, form.dobYear]);

  /* ---------------- validation ---------------- */

  function validateStep1(): boolean {
    const e: Record<string, string> = {};
    if (form.fullName.trim().length < 2)
      e.fullName = "Please enter the full name.";
    if (!dobIso) e.dob = "Select the full date of birth.";
    else if (
      !ISO_DATE_RE.test(dobIso) ||
      Number.isNaN(new Date(`${dobIso}T00:00:00`).getTime())
    )
      e.dob = "Select a valid date of birth.";
    else if (new Date(`${dobIso}T00:00:00`) > new Date())
      e.dob = "Date of birth cannot be in the future.";
    if (!form.gender) e.gender = "Select a gender.";
    const digits = form.phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15)
      e.phone = "Enter a valid mobile number (10–15 digits).";
    if (
      form.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    )
      e.email = "Enter a valid email, or leave it empty.";
    if (!form.city) e.city = "Select a city.";
    if (!form.area) e.area = "Select an area.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2(): boolean {
    const e: Record<string, string> = {};
    if (!isPendingForm && !form.bloodGroup)
      e.bloodGroup = "Select the blood group.";
    if (!isPendingForm && form.donorConsent === null)
      e.donorConsent = "Choose Yes or No — both are okay.";
    if (!form.storageConsent)
      e.storageConsent = "Storage consent is required to save the record.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() {
    if (step === 1 && validateStep1()) {
      setErrors({});
      setStep(2);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function back() {
    setStep(1);
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    if (!validateStep2()) return;
    // Pending form via the activated-form endpoint (token-gated server-side).
    if (isPendingForm && formToken) {
      await formPendingMutation.mutateAsync({
        token: formToken,
        fullName: form.fullName.trim(),
        dateOfBirth: ISO_DATE_RE.test(dobIso) ? dobIso : undefined,
        gender: form.gender,
        phoneNumber: form.phone.replace(/[^\d+]/g, ""),
        email: form.email.trim() || undefined,
        city: form.city,
        area: form.area,
        dataStorageConsent: "YES",
      });
      return;
    }
    // Registration form via the activated-form endpoint when opened from a
    // form link; otherwise the plain public registration endpoint.
    if (formToken) {
      await formRegistrationMutation.mutateAsync({
        token: formToken,
        fullName: form.fullName.trim(),
        dateOfBirth: ISO_DATE_RE.test(dobIso) ? dobIso : undefined,
        gender: form.gender,
        phoneNumber: form.phone.replace(/[^\d+]/g, ""),
        email: form.email.trim() || undefined,
        city: form.city,
        area: form.area,
        bloodGroup: form.bloodGroup,
        donorConsent: form.donorConsent ? "YES" : "NO",
        dataStorageConsent: "YES",
      });
      return;
    }
    // Loud failure: ANY error — network, validation, database — surfaces
    // here. No silent deaths, no opaque server strings.
    try {
      await registerMutation.mutateAsync({
        fullName: form.fullName.trim(),
        // Defense in depth: never ship a malformed date to the server —
        // Postgres would reject it and the user would see a generic failure.
        dateOfBirth: ISO_DATE_RE.test(dobIso) ? dobIso : undefined,
        gender: form.gender,
        phoneNumber: form.phone.replace(/[^\d+]/g, ""),
        email: form.email.trim() || undefined,
        city: form.city,
        area: form.area,
        bloodGroup: form.bloodGroup,
        donorConsent: form.donorConsent ? "YES" : "NO",
        dataStorageConsent: "YES",
      });
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "";
      setErrors({
        form: msg
          ? `Could not save: ${msg.slice(0, 160)}`
          : "Network problem — check your connection and try again.",
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function resetAll() {
    setForm(INITIAL);
    setErrors({});
    setStep(1);
    setSubmittedHrsId(null);
    setCopied(false);
    window.scrollTo({ top: 0 });
  }

  function copyId() {
    if (!submittedHrsId) return;
    navigator.clipboard?.writeText(submittedHrsId).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {}
    );
  }

  /* ---------------- success screen ---------------- */

  if (submittedHrsId) {
    return (
      <div className="register-page">
        <div className="reg-card reg-success">
          <div className="reg-success-icon">
            <PartyPopper size={30} />
          </div>
          <h1>Welcome to the HRS donor network!</h1>
          <p className="reg-success-sub">
            {form.donorConsent
              ? "Your profile is saved and live on the public donor directory."
              : "Your profile has been saved and is awaiting review by our team."}{" "}
            Keep this ID — it identifies you at every future camp or donation.
          </p>
          <div className="reg-id-box">
            <span className="reg-id-label">Your HRS Donor ID</span>
            <span className="reg-id-value">{submittedHrsId}</span>
            <button type="button" className="reg-id-copy" onClick={copyId}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="reg-success-actions">
            {isFormLink ? (
              <button
                type="button"
                className="reg-btn reg-btn-primary"
                onClick={resetAll}
              >
                Register another person
              </button>
            ) : (
              <>
                <Link href="/" className="reg-btn reg-btn-primary">
                  <Home size={16} /> Back to home
                </Link>
                <button
                  type="button"
                  className="reg-btn reg-btn-ghost"
                  onClick={resetAll}
                >
                  Register another person
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- form ---------------- */

  return (
    <div className="register-page">
      <header className="reg-head">
        <span className="reg-kicker">
          {isFormLink ? "Blood donor registration" : "HRS Blood Donor Portal"}
        </span>
        <h1>{heading}</h1>
        <p>{subheading}</p>
      </header>

      <div className="reg-card">
        <div className="reg-steps" aria-label="Registration steps">
          <StepBadge n={1} active={step === 1} done={step > 1} />
          <span className={`reg-step-label${step === 1 ? " current" : ""}`}>
            Personal details
          </span>
          <span className="reg-step-line" />
          <StepBadge n={2} active={step === 2} done={false} />
          <span className={`reg-step-label${step === 2 ? " current" : ""}`}>
            {isPendingForm ? "Consent" : "Blood group & consent"}
          </span>
        </div>

        {errors.form && (
          <div className="reg-form-error" role="alert">
            <AlertCircle size={16} /> {errors.form}
          </div>
        )}

        {step === 1 && (
          <section
            className="reg-step-panel"
            onKeyDown={e => {
              if (
                e.key === "Enter" &&
                (e.target as HTMLElement).tagName !== "SELECT"
              ) {
                e.preventDefault();
                next();
              }
            }}
          >
            <div className="reg-grid-2">
              <Field label="Full name" required error={errors.fullName}>
                <input
                  className="reg-input"
                  type="text"
                  value={form.fullName}
                  onChange={e => set("fullName", e.target.value)}
                  placeholder="As printed on your ID"
                  autoComplete="name"
                  autoFocus
                />
              </Field>
              <Field
                label="Mobile number"
                required
                error={errors.phone}
                hint="Used only to reach you if your group is urgently needed."
              >
                <input
                  className="reg-input"
                  type="tel"
                  inputMode="numeric"
                  value={form.phone}
                  onChange={e =>
                    set("phone", e.target.value.replace(/[^\d+]/g, ""))
                  }
                  placeholder="10-digit mobile number"
                  autoComplete="tel"
                  maxLength={15}
                />
              </Field>
            </div>

            <div className="reg-dob-block">
              <span className="reg-field-label">
                Date of birth <em>*</em>
              </span>
              <div className="reg-dob-row">
                <SelectBox
                  value={form.dobDay}
                  onChange={v => set("dobDay", v)}
                  options={dayOptions}
                  placeholder="Day"
                />
                <SelectBox
                  value={form.dobMonth}
                  onChange={setDobMonth}
                  options={MONTH_OPTIONS}
                  placeholder="Month"
                />
                <SelectBox
                  value={form.dobYear}
                  onChange={setDobYear}
                  options={YEARS}
                  placeholder="Year"
                />
              </div>
              {errors.dob && (
                <span className="reg-field-error">{errors.dob}</span>
              )}
              {age !== null && !errors.dob && (
                <span className="reg-dob-age">
                  <UserRound size={13} /> Age {age} years
                </span>
              )}
            </div>

            <div className="reg-grid-3">
              <Field label="Gender" required error={errors.gender}>
                <SelectBox
                  value={form.gender}
                  onChange={v => set("gender", v)}
                  options={GENDERS}
                  placeholder="Select"
                />
              </Field>
              <Field label="City" required error={errors.city}>
                <SelectBox
                  value={form.city}
                  onChange={setCity}
                  options={KA_DISTRICTS}
                  placeholder="Select district"
                />
              </Field>
              <Field label="Area / locality" required error={errors.area}>
                <SelectBox
                  value={form.area}
                  onChange={setArea}
                  options={areaOptions}
                  placeholder={form.city ? "Select taluk / area" : "Pick a city first"}
                />
              </Field>
            </div>

            <Field
              label="Email"
              hint="Optional — for updates about camps and eligibility."
              error={errors.email}
            >
              <input
                className="reg-input"
                type="email"
                value={form.email}
                onChange={e => set("email", e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </Field>

            <div className="reg-actions">
              <span />
              <button
                type="button"
                className="reg-btn reg-btn-primary"
                onClick={next}
              >
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="reg-step-panel">
            {!isPendingForm && (
            <div className="reg-blood-block">
              <span className="reg-field-label">
                <Droplets size={14} /> Blood group <em>*</em>
              </span>
              <div className="reg-blood-grid">
                {BLOOD_GROUPS.map(bg => (
                  <button
                    type="button"
                    key={bg}
                    className={`reg-blood-tile${form.bloodGroup === bg ? " selected" : ""}`}
                    onClick={() => set("bloodGroup", bg)}
                  >
                    {bg}
                  </button>
                ))}
              </div>
              {errors.bloodGroup && (
                <span className="reg-field-error">{errors.bloodGroup}</span>
              )}
            </div>
            )}

            {!isPendingForm && (
            <div className="reg-consent-block">
              <span className="reg-field-label">
                <HeartHandshake size={14} /> Willing to donate blood? <em>*</em>
              </span>
              <p className="reg-consent-sub">
                Saying <strong>Yes</strong> simply means HRS may contact you
                when your blood group is urgently needed. You can change this
                anytime.
              </p>
              <div className="reg-consent-row">
                <button
                  type="button"
                  className={`reg-consent-btn yes${form.donorConsent === true ? " selected" : ""}`}
                  onClick={() => set("donorConsent", true)}
                >
                  <Check size={18} /> Yes, I'd like to help
                </button>
                <button
                  type="button"
                  className={`reg-consent-btn no${form.donorConsent === false ? " selected" : ""}`}
                  onClick={() => set("donorConsent", false)}
                >
                  <X size={18} /> Not now
                </button>
              </div>
              {errors.donorConsent && (
                <span className="reg-field-error">{errors.donorConsent}</span>
              )}
            </div>
            )}

            <div className="reg-storage-block">
              <button
                type="button"
                className={`reg-storage-toggle${form.storageConsent ? " active" : ""}`}
                role="switch"
                aria-checked={form.storageConsent}
                onClick={() => set("storageConsent", !form.storageConsent)}
              >
                <span className="reg-toggle-track">
                  <i />
                </span>
                <span className="reg-storage-text">
                  <ShieldCheck size={15} />
                  <span>
                    <strong>I consent to secure data storage.</strong>
                    <small>
                      Required. Your details are stored only in the HRS donor
                      registry and used for donor coordination.
                    </small>
                  </span>
                </span>
              </button>
              {errors.storageConsent && (
                <span className="reg-field-error">{errors.storageConsent}</span>
              )}
            </div>

            <div className="reg-review">
              <span className="reg-review-title">Review your details</span>
              <button type="button" className="reg-review-edit" onClick={back}>
                Edit
              </button>
              <div className="reg-review-grid">
                <span className="reg-review-k">Name</span>
                <span>{form.fullName || "—"}</span>
                <span className="reg-review-k">Date of birth</span>
                <span>
                  {dobPretty
                    ? `${dobPretty}${age !== null ? ` · ${age} yrs` : ""}`
                    : "—"}
                </span>
                <span className="reg-review-k">Gender</span>
                <span>{form.gender || "—"}</span>
                <span className="reg-review-k">Mobile</span>
                <span>{form.phone || "—"}</span>
                {form.email.trim() && (
                  <>
                    <span className="reg-review-k">Email</span>
                    <span>{form.email}</span>
                  </>
                )}
                <span className="reg-review-k">Location</span>
                <span>{form.area ? `${form.area}, ${form.city}` : "—"}</span>
                {!isPendingForm && (
                  <>
                    <span className="reg-review-k">Blood group</span>
                    <span>{form.bloodGroup || "—"}</span>
                  </>
                )}
              </div>
            </div>

            <div className="reg-actions">
              <button
                type="button"
                className="reg-btn reg-btn-ghost"
                onClick={back}
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button
                type="button"
                className="reg-btn reg-btn-primary"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <span className="reg-spinner" /> Submitting…
                  </>
                ) : (
                  <>
                    Complete registration <Check size={16} />
                  </>
                )}
              </button>
            </div>
          </section>
        )}
      </div>

      {isFormLink ? (
        <footer className="reg-foot">
          <span>Questions? Ask any HRS volunteer at the camp.</span>
        </footer>
      ) : (
        <footer className="reg-foot">
          <Link href="/">← Back to HRS portal</Link>
          <span>Questions? Ask any HRS volunteer at the camp.</span>
        </footer>
      )}
    </div>
  );
}
