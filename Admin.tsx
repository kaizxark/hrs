import { FormEvent, useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  clearAdminSession,
  getAdminSession,
  saveAdminSession,
} from "@/lib/adminAuth";
import { trpc } from "@/lib/trpc";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BadgeCheck,
  Check,
  ChevronDown,
  ClipboardList,
  Clock3,
  Droplets,
  Edit3,
  FileSpreadsheet,
  Heart,
  History,
  Info,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MapPin,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";

type AdminView =
  | "overview"
  | "statistics"
  | "records"
  | "donations"
  | "locations"
  | "staff"
  | "audit"
  | "sync"
  | "settings";

type RecordTab = "all" | "pending" | "donors" | "available" | "unavailable";
type ModalOrigin = { x: number; y: number };

const VIEW_LABELS: Record<AdminView, string> = {
  overview: "Dashboard",
  statistics: "Statistics",
  records: "Records",
  donations: "Donations",
  locations: "Locations",
  staff: "Staff & Access",
  audit: "Audit Log",
  sync: "Sync & Data",
  settings: "Settings",
};

const RECORD_TABS: { id: RecordTab; label: string }[] = [
  { id: "all", label: "All Records" },
  { id: "pending", label: "Pending" },
];

type AdminRecord = {
  id: string | null;
  name: string;
  dateOfBirth: string;
  age: number;
  gender: string;
  mobile: string;
  email: string;
  group: string;
  location: string;
  area: string;
  status: "Verified" | "Pending";
  consent: boolean;
  consentStatus: "Yes" | "No" | "Pending";
  availability: "Available" | "Unavailable";
  donorConsent: boolean | null;
  submitted: string;
  registeredAt: string | null;
  verifiedAt: string | null;
  donationCount: number;
  donationDates: string[];
  donationEligibleDates: string[];
  nextEligibleAt: string | null;
  publicVisible: boolean;
  initials: string;
  lastDonationAt: string | null;
};

function formatRecordDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}+05:30`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}+05:30`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatAge(dateOfBirth: string | null | undefined): string {
  if (!dateOfBirth || dateOfBirth === "Not recorded") return "—";
  // Try parsing the dateOfBirth string
  const date = new Date(dateOfBirth);
  if (Number.isNaN(date.getTime())) return "—";
  const age = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return age > 0 ? `(${age})` : "—";
}

const statisticsColors = [
  "#c92f3b",
  "#e16a70",
  "#9c3745",
  "#d99a9e",
  "#6f7f73",
  "#b9c7b9",
  "#8b9d8d",
  "#d7ded7",
];

function indiaDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatIndiaSyncTime(date: Date | null) {
  if (!date) return "Syncing directory...";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (elapsedSeconds < 60) return `Last synced ${elapsedSeconds} sec ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `Last synced ${elapsedMinutes} min ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `Last synced ${elapsedHours} hr ago`;
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`admin-field${className ? ` ${className}` : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="admin-select">
      <select value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown size={15} />
    </div>
  );
}

function Login({ onLogin }: { onLogin: (username: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username || !password) {
      toast.error("Enter your username and password to continue.");
      return;
    }
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1200));
    onLogin(username.trim());
  };

  return (
    <div className="login-page">
      <div className="login-side">
        <Link className="login-back" href="/">
          <ArrowLeft size={16} /> Back to public portal
        </Link>
        <div className="login-side-content">
          <div className="login-symbol">
            <img src="/hrs-logo.png" alt="HRS logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
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
              <img src="/hrs-logo.png" alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "inherit" }} />
            </div>
            <strong>HRS</strong>
          </div>
          <span className="eyebrow dark-eyebrow">AUTHORIZED ACCESS</span>
          <h2>Welcome back.</h2>
          <p className="login-copy">Sign in to manage blood donor records.</p>
          <form onSubmit={submit} className="login-form">
            <Field label="Username">
              <div className="admin-input">
                <UserRound size={17} />
                <input
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  disabled={isLoading}
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
                  autoComplete="current-password"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  className="input-icon-button"
                  onClick={() => setShowPassword(value => !value)}
                  disabled={isLoading}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>
            <button
              className="primary-button wide-button"
              type="submit"
              disabled={isLoading}
              style={{ gap: isLoading ? "10px" : "6px" }}
            >
              {isLoading ? (
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
              Admin credentials are checked against the authorized HRS staff
              directory.
            </span>
          </div>
          <div className="demo-hint">
            Demo mode · enter any non-empty credentials to explore
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const [loggedIn, setLoggedIn] = useState(() => Boolean(getAdminSession()));
  const [activeView, setActiveView] = useState<AdminView>("overview");
  const [recordTab, setRecordTab] = useState<RecordTab>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterGroup, setFilterGroup] = useState("All");
  const [filterLocation, setFilterLocation] = useState("All");
  const [filterArea, setFilterArea] = useState("All");
  const [filterGender, setFilterGender] = useState("All");
  const [filterDonorConsent, setFilterDonorConsent] = useState("All");
  const [filterAvailability, setFilterAvailability] = useState("All");
  const resetFilters = () => {
    setFilterGroup("All");
    setFilterLocation("All");
    setFilterArea("All");
    setFilterGender("All");
    setFilterDonorConsent("All");
    setFilterAvailability("All");
  };
  const [records, setRecords] = useState<AdminRecord[]>([]);
  const [addedPeriod, setAddedPeriod] = useState<"today" | "week" | "month">("week");
  const [addedPeriodOpen, setAddedPeriodOpen] = useState(false);
  const addedPeriodMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addedPeriodOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!addedPeriodMenuRef.current?.contains(event.target as Node)) {
        setAddedPeriodOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddedPeriodOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [addedPeriodOpen]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminRecord | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<ModalOrigin | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [indiaTime, setIndiaTime] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncRequested, setSyncRequested] = useState(0);
  const [selectedDonation, setSelectedDonation] = useState<AdminRecord | null>(null);
  const [donationDetailOpen, setDonationDetailOpen] = useState(false);
  const [donationPage, setDonationPage] = useState(1);
  const [recordingDonation, setRecordingDonation] = useState<AdminRecord | null>(null);
  const [donationDateTime, setDonationDateTime] = useState("");

  const openRecord = (record: AdminRecord, origin?: ModalOrigin) => {
    setSelectedOrigin(origin ?? null);
    setSelected(record);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [
    query,
    activeView,
    recordTab,
    filterGroup,
    filterLocation,
    filterArea,
    filterGender,
    filterDonorConsent,
    filterAvailability,
  ]);

  useEffect(() => {
    if (!loggedIn) clearAdminSession();
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn) return;

    const updateIndiaTime = () => {
      const now = new Date();
      const time = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(now);
      const date = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "long",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
        .format(now)
        .toUpperCase();
      const indiaHour = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Kolkata",
          hour: "numeric",
          hour12: false,
        }).format(now)
      );
      const greeting =
        indiaHour < 12
          ? "Good morning"
          : indiaHour < 17
            ? "Good afternoon"
            : "Good evening";

      setIndiaTime(time);
      const timeEl = document.querySelector(".top-sync-time");
      const dateEl = document.querySelector(".top-sync-date");
      const sidebarTimeEl = document.querySelector(".sidebar-clock-time");
      const sidebarDateEl = document.querySelector(".sidebar-clock-date");
      if (timeEl) timeEl.textContent = time;
      if (dateEl) dateEl.textContent = date;
      if (sidebarTimeEl) sidebarTimeEl.textContent = time;
      if (sidebarDateEl) sidebarDateEl.textContent = date;
      const heading = document.querySelector(".admin-page-heading h1");
      if (heading && activeView === "overview")
        heading.textContent = `${greeting}, Admin.`;
      const dateLabel = document.querySelector(".admin-page-heading .eyebrow");
      if (dateLabel && activeView === "overview") dateLabel.textContent = date;
    };

    updateIndiaTime();
    const timer = window.setInterval(updateIndiaTime, 1000);
    return () => window.clearInterval(timer);
  }, [activeView, loggedIn]);

  // Event listener for donation detail modal
  useEffect(() => {
    const handleOpenDonationDetail = (e: Event) => {
      const customEvent = e as CustomEvent<AdminRecord>;
      setSelectedDonation(customEvent.detail);
      setDonationDetailOpen(true);
    };

    window.addEventListener('openDonationDetail', handleOpenDonationDetail);
    return () => window.removeEventListener('openDonationDetail', handleOpenDonationDetail);
  }, []);

  // Scroll lock for donation detail modal
  useEffect(() => {
    if (donationDetailOpen) {
      const previousOverflow = document.body.style.overflow;
      const previousPaddingRight = document.body.style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

      document.body.style.overflow = "hidden";
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

      return () => {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
      };
    }
  }, [donationDetailOpen]);

  // Fetch profiles from API
  const profilesQuery = trpc.hrs.profiles.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30000,
    retry: 2,
  });

  // Convert API profiles to AdminRecord format
  useEffect(() => {
    if (profilesQuery.data?.success && profilesQuery.data.data) {
      // API returns data directly as array: { success, data: [...] }
      const apiProfiles = (Array.isArray(profilesQuery.data.data)
        ? profilesQuery.data.data
        : profilesQuery.data.data?.profiles || []) as Record<string, string>[];
      const convertedRecords: AdminRecord[] = apiProfiles.map((profile) => {
        const id = profile["HRS ID"] || null;
        const name = profile["Full Name"] || "Unknown";
        const dob = profile["Date of Birth"] || "";
        const gender = profile["Gender"] || "Prefer not to say";
        const mobile = profile["Phone Number"] || "Not provided";
        const email = profile["Email"] || "Not provided";
        const bloodGroup = profile["Blood Group"] || "—";
        const city = profile["City"] || "Unknown";
        const area = profile["Area"] || "Unknown";
        const registrationTime = profile["Registration Time"] || "";
        const storageConsent = profile["Data Storage Consent"] || "";
        const donationConsent = profile["Donor Consent"] || "";
        const verificationStatus = profile["Verification Status"] || "";
        const verifiedTime = profile["Verification Time"] || "";
        const donationCount = profile["Blood Donation Count"] || "0";
        const lastDonationTime = profile["Last Donation Time"] || "";
        const nextEligibleTime = profile["Next Eligible Time"] || "";
        const availabilityStatus = profile["Availability Status"] || "";
        const publicVisibility = profile["Public Directory Visibility"] || "";

        const birthDate = new Date(dob);
        const age = Number.isNaN(birthDate.getTime()) ? 0 : new Date().getFullYear() - birthDate.getFullYear();
        const rawStatus = verificationStatus.toUpperCase();
        const isPending = rawStatus.includes("PENDING") || rawStatus.includes("VERIFICATION");
        const consentStatus = storageConsent.toUpperCase() === "YES" ? "Yes" : storageConsent.toUpperCase() === "NO" ? "No" : "Pending";
        const donorConsent = isPending ? null : donationConsent.toUpperCase() === "YES";

        const parseSheetDate = (value: string | undefined) => {
          if (!value?.trim()) return null;
          const normalized = value.trim().replace(" ", "T");
          const withIndiaOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}+05:30`;
          const date = new Date(withIndiaOffset);
          return Number.isNaN(date.getTime()) ? null : date;
        };

        const registeredAt = parseSheetDate(registrationTime)?.toISOString() ?? null;
        const verifiedAt = parseSheetDate(verifiedTime)?.toISOString() ?? null;

        const donationDates: string[] = [];
        const donationEligibleDates: string[] = [];
        for (let i = 1; i <= 20; i++) {
          const dateKey = `Donation ${i} Date`;
          const eligibleKey = `Donation ${i} Eligible Time`;
          const dateValue = profile[dateKey];
          const eligibleValue = profile[eligibleKey];
          if (dateValue && dateValue.trim()) donationDates.push(dateValue.trim());
          if (eligibleValue && eligibleValue.trim()) donationEligibleDates.push(eligibleValue.trim());
        }

        // Parse nextEligibleTime - handle various date formats from Google Sheets
        const parseNextEligibleDate = (value: string | undefined): Date | null => {
          if (!value?.trim()) return null;
          const trimmed = value.trim();
          // Handle formats like "06 Dec 2026", "06-Dec-2026", "2026-12-06", "06/12/2026"
          const formats = [
            // Try ISO-like first
            () => new Date(trimmed),
            // Try DD Mon YYYY with various separators
            () => {
              const match = trimmed.match(/^(\d{1,2})[\s\-,\/]+([A-Za-z]{3,})[\s\-,\/]+(\d{4})$/);
              if (match) {
                const [, day, monthStr, year] = match;
                const monthIndex = new Date(`${monthStr} 1`).getMonth();
                const date = new Date(parseInt(year), monthIndex, parseInt(day));
                if (!Number.isNaN(date.getTime())) return date;
              }
              return null;
            },
            // Try DD/MM/YYYY
            () => {
              const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
              if (match) {
                const [, day, month, year] = match;
                const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                if (!Number.isNaN(date.getTime())) return date;
              }
              return null;
            },
          ];
          for (const tryFormat of formats) {
            const result = tryFormat();
            if (result && !Number.isNaN(result.getTime())) return result;
          }
          return null;
        };

        const parsedNextEligible = parseNextEligibleDate(nextEligibleTime);
        const now = new Date();

        // Determine availability: ALWAYS calculate from next eligible date, not from the API status
        // The backend availability status is unreliable - calculate based on the actual next eligible date
        let availability: "Available" | "Unavailable" = "Unavailable";
        if (parsedNextEligible) {
          // If we have a next eligible date, use it as the source of truth
          availability = parsedNextEligible <= now ? "Available" : "Unavailable";
        } else if (donorConsent) {
          // No next eligible date but has consent - check explicit status
          if (availabilityStatus.toLowerCase().includes("unavailable")) {
            availability = "Unavailable";
          } else if (availabilityStatus.toLowerCase().includes("available")) {
            // Only trust AVAILABLE status if there's no next eligible date
            availability = "Available";
          }
        }

        const publicVisible = Boolean(id && rawStatus === "VERIFIED" && donorConsent === true && bloodGroup && bloodGroup !== "—" && publicVisibility.toUpperCase() === "YES");
        const initials = name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() || "?";
        const lastDonationAt = lastDonationTime?.trim() || (donationDates.length > 0 ? donationDates[donationDates.length - 1] : null);

        return {
          id, name, dateOfBirth: dob || "Not recorded", age: isNaN(age) ? 0 : age, gender, mobile, email,
          group: bloodGroup, location: city, area,
          status: isPending ? "Pending" : "Verified" as const,
          consent: consentStatus === "Yes", consentStatus, availability, donorConsent,
          submitted: registrationTime || "Recently", registeredAt, verifiedAt,
          donationCount: parseInt(donationCount, 10) || 0, donationDates, donationEligibleDates, nextEligibleAt: (parsedNextEligible && !Number.isNaN(parsedNextEligible.getTime())) ? parsedNextEligible.toISOString() : null,
          publicVisible, initials, lastDonationAt,
        };
      });
      setRecords(convertedRecords);
      setLastSyncedAt(new Date());
    } else if (profilesQuery.isError) {
      console.error("Failed to fetch from API, falling back to CSV:", profilesQuery.error);
      // Fall back to CSV fetch
      fetchCsvData();
    }
  }, [profilesQuery.data, profilesQuery.isError]);

  // CSV data fetch function
  const fetchCsvData = async () => {
    const sheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQlyH9ped9Y7wb_QwvGBPiMkmqew4Ulu_DLjzvyO0V01tzxv1QCQBb6zAoz5kpFbwvFCFhMDSOsNpzy/pub?output=csv";
    try {
      const response = await fetch(`${sheetUrl}&t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Google Sheets responded with ${response.status}`);
      const text = await response.text();
      const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter(row => row.trim());
      const parsedRecords: AdminRecord[] = [];

      for (const row of rows) {
        const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 20) continue;

        const id = cols[0];
        const name = cols[1] || "Unknown";
        const dob = cols[2];
        const gender = cols[3] || "Prefer not to say";
        const mobile = cols[4] || "Not provided";
        const email = cols[5] || "Not provided";
        const city = cols[6] || "Unknown";
        const area = cols[7] || "Unknown";
        const registrationTime = cols[8];
        const bloodGroup = cols[9] || "—";
        const storageConsent = cols[11] || "";
        const donationConsent = cols[12] || "";
        const verificationStatus = cols[13] || "";
        const verifiedTime = cols[14];
        const donationCount = cols[15] || "0";
        const lastDonationTime = cols[16];
        const nextEligibleTime = cols[17];
        const availabilityStatus = cols[18];
        const publicVisibility = cols[19];

        const birthDate = new Date(dob);
        const age = Number.isNaN(birthDate.getTime()) ? 0 : new Date().getFullYear() - birthDate.getFullYear();
        const rawStatus = (verificationStatus || "").trim().toUpperCase();
        const isPending = rawStatus.includes("PENDING") || rawStatus.includes("VERIFICATION");
        const consentStatus = storageConsent?.toUpperCase() === "YES" ? "Yes" : storageConsent?.toUpperCase() === "NO" ? "No" : "Pending";
        const donorConsent = isPending ? null : donationConsent?.toUpperCase() === "YES";

        const parseSheetDate = (value: string | undefined) => {
          if (!value?.trim()) return null;
          const normalized = value.trim().replace(" ", "T");
          const withIndiaOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}+05:30`;
          return new Date(withIndiaOffset);
        };

        const registeredAt = parseSheetDate(registrationTime)?.toISOString() ?? null;
        const verifiedAt = parseSheetDate(verifiedTime)?.toISOString() ?? null;

        // Extract all donation dates and eligible dates
        const donationDates: string[] = [];
        const donationEligibleDates: string[] = [];
        for (let i = 0; i < 20; i++) {
          const donationCol = cols[20 + (i * 2)]; // Donation 1 Date is at index 20, Donation 2 at 22, etc.
          const eligibleCol = cols[21 + (i * 2)]; // Eligible time is right after the date
          if (donationCol?.trim()) donationDates.push(donationCol.trim());
          if (eligibleCol?.trim()) donationEligibleDates.push(eligibleCol.trim());
        }

        // Parse nextEligibleTime - handle various date formats from Google Sheets
        const parseNextEligibleDate = (value: string | undefined): Date | null => {
          if (!value?.trim()) return null;
          const trimmed = value.trim();
          const formats = [
            () => new Date(trimmed),
            () => {
              const match = trimmed.match(/^(\d{1,2})[\s\-,\/]+([A-Za-z]{3,})[\s\-,\/]+(\d{4})$/);
              if (match) {
                const [, day, monthStr, year] = match;
                const monthIndex = new Date(`${monthStr} 1`).getMonth();
                const date = new Date(parseInt(year), monthIndex, parseInt(day));
                if (!Number.isNaN(date.getTime())) return date;
              }
              return null;
            },
            () => {
              const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
              if (match) {
                const [, day, month, year] = match;
                const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                if (!Number.isNaN(date.getTime())) return date;
              }
              return null;
            },
          ];
          for (const tryFormat of formats) {
            const result = tryFormat();
            if (result && !Number.isNaN(result.getTime())) return result;
          }
          return null;
        };

        const parsedNextEligible = parseNextEligibleDate(nextEligibleTime);
        const now = new Date();

        // Determine availability: only available if they have donor consent, a recorded next eligible date, and that date has passed
        const availability = donorConsent && parsedNextEligible && parsedNextEligible <= now ? "Available" : "Unavailable";
        const publicVisible = Boolean(id && rawStatus === "VERIFIED" && donorConsent === true && bloodGroup && publicVisibility?.toUpperCase() === "YES");
        const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() || "?";
        const lastDonationAt = lastDonationTime?.trim() || (donationDates.length > 0 ? donationDates[donationDates.length - 1] : null);

        parsedRecords.push({
          id: id || null, name, dateOfBirth: dob || "Not recorded", age: isNaN(age) ? 0 : age, gender, mobile, email,
          group: bloodGroup, location: city, area,
          status: isPending ? "Pending" as const : "Verified" as const,
          consent: consentStatus === "Yes", consentStatus, availability, donorConsent,
          submitted: registrationTime || "Recently", registeredAt, verifiedAt,
          donationCount: parseInt(donationCount, 10) || 0, donationDates, donationEligibleDates, nextEligibleAt: (parsedNextEligible && !Number.isNaN(parsedNextEligible.getTime())) ? parsedNextEligible.toISOString() : null,
          publicVisible, initials, lastDonationAt,
        });
      }
      setRecords(parsedRecords);
      setLastSyncedAt(new Date());
    } catch (e) {
      console.error("Failed to fetch CSV data:", e);
      toast.error("Failed to load data. Please refresh the page.");
    }
  };

  // Initial data fetch - try API first, fall back to CSV
  useEffect(() => {
    // Fall back to CSV if: still loading after timeout, API returned error, or API returned empty data
    if (!profilesQuery.isLoading) {
      const hasData = profilesQuery.data?.success &&
                      Array.isArray(profilesQuery.data.data) &&
                      profilesQuery.data.data.length > 0;
      if (!hasData) {
        fetchCsvData();
      }
    }
  }, [profilesQuery.isLoading, profilesQuery.data]);

  // Sync indicator
  useEffect(() => {
    if (profilesQuery.isFetching || profilesQuery.isLoading) {
      setIsSyncing(true);
    } else {
      setIsSyncing(false);
    }
  }, [profilesQuery.isFetching, profilesQuery.isLoading]);

  // Manual sync
  useEffect(() => {
    if (syncRequested > 0) {
      profilesQuery.refetch().then(result => {
        if (!result.isSuccess) fetchCsvData();
      });
    }
  }, [syncRequested]);

  // Verify profile mutation
  const verifyMutation = trpc.hrs.verifyProfile.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Profile verified successfully!");
        profilesQuery.refetch();
      } else {
        toast.error(result.error || "Failed to verify profile");
      }
    },
    onError: (error) => {
      toast.error(`Verification failed: ${error.message}`);
    },
  });

  // Record donation mutation
  const recordDonationMutation = trpc.hrs.recordDonation.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Donation recorded successfully!");
        profilesQuery.refetch();
      } else {
        toast.error(result.error || "Failed to record donation");
      }
    },
    onError: (error) => {
      toast.error(`Recording failed: ${error.message}`);
    },
  });

  const pending = records.filter(record => record.status === "Pending");
  const donors = records.filter(record => record.donorConsent);
  const addedPeriodLabels = {
    today: "today",
    week: "this week",
    month: "this month",
  } as const;
  const now = new Date();
  const todayKey = indiaDateKey(now);
  const addedPeriodCount = records.filter(record => {
    if (!record.registeredAt) return false;
    const registeredAt = new Date(record.registeredAt);
    if (Number.isNaN(registeredAt.getTime()) || registeredAt > now) return false;
    if (addedPeriod === "today") return indiaDateKey(registeredAt) === todayKey;
    if (addedPeriod === "month") {
      return indiaDateKey(registeredAt).slice(0, 7) === todayKey.slice(0, 7);
    }
    return now.getTime() - registeredAt.getTime() <= 7 * 24 * 60 * 60 * 1000;
  }).length;
  const locationOptions = useMemo(
    () => ["All", ...Array.from(new Set(records.map(record => record.location))).sort()],
    [records]
  );
  const areaOptions = useMemo(
    () => ["All", ...Array.from(new Set(records.map(record => record.area))).sort()],
    [records]
  );
  const genderOptions = useMemo(
    () => ["All", ...Array.from(new Set(records.map(record => record.gender))).sort()],
    [records]
  );
  const currentViewRecords = useMemo(() => {
    const searchTerm = query.trim().toLowerCase();

    return records.filter(record => {
      const matchesSearch =
        !searchTerm ||
        record.name.toLowerCase().includes(searchTerm) ||
        (record.id ?? "").toLowerCase().includes(searchTerm);
      if (!matchesSearch) return false;
      if (recordTab === "pending" && record.status !== "Pending") return false;
      if (recordTab === "donors" && !record.donorConsent) return false;
      if (recordTab === "available" && record.availability !== "Available")
        return false;
      if (
        recordTab === "unavailable" &&
        (record.availability !== "Unavailable" || record.status === "Pending")
      )
        return false;
      if (filterGroup !== "All" && record.group !== filterGroup) return false;
      if (filterLocation !== "All" && record.location !== filterLocation)
        return false;
      if (filterArea !== "All" && record.area !== filterArea) return false;
      if (filterGender !== "All" && record.gender !== filterGender) return false;
      if (filterDonorConsent === "Yes" && !record.donorConsent) return false;
      if (filterDonorConsent === "No" && record.donorConsent) return false;
      if (
        filterAvailability !== "All" &&
        record.availability !== filterAvailability
      )
        return false;
      return true;
    });
  }, [
    records,
    query,
    recordTab,
    filterGroup,
    filterLocation,
    filterArea,
    filterGender,
    filterDonorConsent,
    filterAvailability,
  ]);
  const locationRows = useMemo(() => {
    const map = new Map<
      string,
      { location: string; areas: string[]; count: number }
    >();
    for (const record of records) {
      const existing = map.get(record.location);
      if (existing) {
        existing.count += 1;
        if (!existing.areas.includes(record.area)) existing.areas.push(record.area);
      } else {
        map.set(record.location, {
          location: record.location,
          areas: [record.area],
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [records]);
  const goToView = (view: AdminView, tab: RecordTab = "all") => {
    setActiveView(view);
    setMobileNav(false);
    if (view === "records") setRecordTab(tab);
  };
  const totalPages = Math.ceil(currentViewRecords.length / 30);
  const paginatedRecords = currentViewRecords.slice(
    (currentPage - 1) * 30,
    currentPage * 30
  );

  if (!loggedIn)
    return (
      <Login
        onLogin={username => {
          saveAdminSession(username);
          setLoggedIn(true);
          toast.success("Welcome to the HRS staff workspace.");
        }}
      />
    );

  const saveRecord = async (record: AdminRecord, group: string, donationConsent: boolean | null, onSuccess?: (id: string) => void) => {
    if (!group || group === "—") {
      toast.error("Enter a blood group before saving.");
      return;
    }
    if (donationConsent === null) {
      toast.error("Record blood donation consent as Yes or No before verifying.");
      return;
    }
    if (!record.id) {
      toast.error("Profile HRS ID is missing. Cannot verify.");
      return;
    }

    try {
      await verifyMutation.mutateAsync({
        hrsId: record.id,
        bloodGroup: group,
        donorConsent: donationConsent ? "YES" : "NO",
      });
      // After successful verification, refetch profiles
      await profilesQuery.refetch();
      toast.success(`${record.id} verified successfully!`);
      onSuccess?.(record.id);
    } catch (error) {
      console.error("Verification error:", error);
    }
  };

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${mobileNav ? "open" : ""}`}>
        <div className="admin-sidebar-head">
          <a className="brand" href="/">
            <div className="logo-mark">
              <img src="/hrs-logo.png" alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "inherit" }} />
            </div>
            <span>
              <strong>HRS</strong>
              <small>Staff workspace</small>
            </span>
          </a>
          <button
            className="mobile-close-sidebar"
            onClick={() => setMobileNav(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div className="admin-location admin-sync-status">
          <span className="status-dot" />
          <span>{formatIndiaSyncTime(lastSyncedAt)}</span>
        </div>
        <nav className="admin-nav">
          <span className="admin-nav-label">OVERVIEW</span>
          <button
            className={activeView === "overview" ? "active" : ""}
            onClick={() => goToView("overview")}
          >
            <LayoutDashboard size={17} /> Dashboard
          </button>
          <button
            className={activeView === "statistics" ? "active" : ""}
            onClick={() => goToView("statistics")}
          >
            <BarChart3 size={17} /> Statistics
          </button>
          <span className="admin-nav-label">DIRECTORY</span>
          <button
            className={activeView === "records" ? "active" : ""}
            onClick={() => goToView("records")}
          >
            <Users size={17} /> Records
          </button>
          <button
            className={activeView === "donations" ? "active" : ""}
            onClick={() => goToView("donations")}
          >
            <Heart size={17} /> Donations
          </button>
          <span className="admin-nav-label">MANAGEMENT</span>
          <button
            className={activeView === "locations" ? "active" : ""}
            onClick={() => goToView("locations")}
          >
            <MapPin size={17} /> Locations
          </button>
          <span className="admin-nav-label">SYSTEM</span>
          <button
            className={activeView === "staff" ? "active" : ""}
            onClick={() => goToView("staff")}
          >
            <KeyRound size={17} /> Staff & Access
          </button>
          <button
            className={activeView === "audit" ? "active" : ""}
            onClick={() => goToView("audit")}
          >
            <History size={17} /> Audit Log
          </button>
          <button
            className={activeView === "sync" ? "active" : ""}
            onClick={() => goToView("sync")}
          >
            <FileSpreadsheet size={17} /> Sync & Data
          </button>
          <button
            className={activeView === "settings" ? "active" : ""}
            onClick={() => goToView("settings")}
          >
            <Settings2 size={17} /> Settings
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="staff-profile">
            <div className="staff-avatar">
              <UserRound size={16} />
            </div>
            <div className="staff-info">
              <strong>Admin</strong>
              <span>Administrator</span>
            </div>
            <button
              onClick={() => {
                setLoggedIn(false);
                toast.success("Signed out securely.");
              }}
              aria-label="Sign out"
              className="signout-button"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <button
            className="mobile-admin-menu"
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="admin-breadcrumb">
            <span>HRS workspace</span>
            <ArrowRight size={14} />
            <strong>{VIEW_LABELS[activeView]}</strong>
          </div>
          <div className="admin-top-actions">
            <span className="top-clock">
              <span className="top-sync-time"></span>
              <span className="top-sync-date"></span>
            </span>
          </div>
        </header>
        <main className={`admin-content ${activeView === "statistics" ? "statistics-content" : ""}`}>
          {activeView === "statistics" ? (
            <Statistics records={records} />
          ) : activeView === "overview" ? (
            <>
              <div className="admin-page-heading">
                <div>
                  <span className="eyebrow dark-eyebrow">
                    THURSDAY, 04 SEP 2026
                  </span>
                  <h1>Good morning, Admin.</h1>
                  <p>Here’s what needs your attention today.</p>
                </div>
                <button
                  className="record-sync-button dashboard-sync-button"
                  type="button"
                  onClick={() => setSyncRequested(value => value + 1)}
                  disabled={isSyncing}
                  title="Sync records from Google Sheets"
                >
                  <RefreshCw size={14} className={isSyncing ? "syncing-icon" : ""} />
                  {isSyncing ? "Syncing..." : "Sync"}
                </button>
              </div>
              {isSyncing && records.length === 0 ? (
                <DashboardLoading />
              ) : <><div className="metric-grid">
                <div className="metric-card">
                  <div className="metric-card-head">
                    <span>Total records</span>
                    <Users size={17} />
                  </div>
                  <strong>{records.length}</strong>
                  <small>
                    <span className="metric-up">+12</span> this month
                  </small>
                </div>
                <div className="metric-card">
                  <div className="metric-card-head">
                    <span>Verified groups</span>
                    <BadgeCheck size={17} />
                  </div>
                  <strong>
                    {
                      records.filter(record => record.status === "Verified")
                        .length
                    }
                  </strong>
                  <small>Ready for public search</small>
                </div>
                <div className="metric-card warning">
                  <div className="metric-card-head">
                    <span>Pending entry</span>
                    <Clock3 size={17} />
                  </div>
                  <strong>{pending.length}</strong>
                  <small>Needs your review</small>
                </div>
                <div className="metric-card">
                  <div className="metric-card-head">
                    <div
                      className={`metric-period-select${addedPeriodOpen ? " open" : ""}`}
                      ref={addedPeriodMenuRef}
                    >
                      <span>Added</span>
                      <div className="metric-period-menu-wrap">
                        <button
                          type="button"
                          className="metric-period-trigger"
                          onClick={() => setAddedPeriodOpen(open => !open)}
                          aria-haspopup="listbox"
                          aria-expanded={addedPeriodOpen}
                        >
                          {addedPeriod === "today"
                            ? "Today"
                            : addedPeriod === "week"
                              ? "This week"
                              : "This month"}
                          <ChevronDown size={13} />
                        </button>
                        <div
                          className={`metric-period-menu${addedPeriodOpen ? " open" : ""}`}
                          role="listbox"
                          aria-label="Added records period"
                        >
                          {(["today", "week", "month"] as const).map(period => (
                            <button
                              key={period}
                              type="button"
                              role="option"
                              aria-selected={addedPeriod === period}
                              className={addedPeriod === period ? "selected" : ""}
                              onClick={() => {
                                setAddedPeriod(period);
                                setAddedPeriodOpen(false);
                              }}
                            >
                              {period === "today"
                                ? "Today"
                                : period === "week"
                                  ? "This week"
                                  : "This month"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <Plus size={17} />
                  </div>
                  <strong>{addedPeriodCount}</strong>
                  <small>
                    Records added {addedPeriodLabels[addedPeriod]}
                  </small>
                </div>
              </div>
              <div className="admin-two-col dashboard-records">
                <section className="admin-card records-table-card dashboard-record-section">
                  <div className="admin-card-heading">
                    <div>
                      <h2>Needs your attention</h2>
                      <p>Records waiting for blood group entry</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => goToView("records", "pending")}
                    >
                      View all <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="records-table-head">
                    <span>Person</span>
                    <span>Blood group</span>
                    <span>Location</span>
                    <span>Status</span>
                  </div>
                  {pending.slice(0, 4).map(record => (
                    <RecordRow key={record.id ?? record.name} record={record} onEdit={origin => openRecord(record, origin)} showSubmitted={false} />
                  ))}
                  {pending.length === 0 && (
                    <div className="small-empty">
                      <Check size={17} /> All records are up to date
                    </div>
                  )}
                </section>
                <section className="admin-card records-table-card dashboard-record-section">
                  <div className="admin-card-heading">
                    <div>
                      <h2>Recent additions</h2>
                      <p>Latest records from the network</p>
                    </div>
                    <button
                      className="icon-ghost"
                      onClick={() => goToView("records")}
                      aria-label="View all records"
                    >
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  <div className="records-table-head">
                    <span>Person</span>
                    <span>Blood group</span>
                    <span>Location</span>
                    <span>Status</span>
                  </div>
                  {records
                    .filter(record => record.status === "Verified")
                    .slice(0, 4)
                    .map(record => (
                      <RecordRow key={record.id ?? record.name} record={record} onEdit={origin => openRecord(record, origin)} showSubmitted={false} />
                    ))}
                </section>
              </div></>}
            </>
          ) : activeView === "records" ? (
            <>
              <div className="admin-page-heading compact-heading">
                <div>
                  <span className="eyebrow dark-eyebrow">DIRECTORY</span>
                  <h1>Records</h1>
                  <p>Search, edit, and manage every HRS donor record.</p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus size={17} /> Add Person
                </button>
              </div>
              <div className="record-tabs">
                {RECORD_TABS.map(tab => (
                  <button
                    key={tab.id}
                    className={`record-tab${recordTab === tab.id ? " active" : ""}`}
                    onClick={() => { resetFilters(); setRecordTab(tab.id); }}
                  >
                    {tab.label}
                  </button>
                ))}
                <button
                  className="record-sync-button"
                  type="button"
                  onClick={() => setSyncRequested(value => value + 1)}
                  disabled={isSyncing}
                  title="Sync records from Google Sheets"
                >
                  <RefreshCw size={14} className={isSyncing ? "syncing-icon" : ""} />
                  {isSyncing ? "Syncing..." : "Sync"}
                </button>
              </div>
              <div className="record-toolbar">
                <div className="admin-search">
                  <Search size={17} />
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search by person name or ID"
                  />
                </div>
                <button
                  className="filter-button"
                  onClick={() => setFiltersOpen(open => !open)}
                >
                  <Settings2 size={16} /> Filters
                </button>
              </div>
              {filtersOpen && (
                <div className="record-filters">
                  <Field label="Blood group">
                    <div className="blood-group-grid admin-blood-group-grid">
                      {["All", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(group => (
                        <button
                          key={group}
                          type="button"
                          className={`blood-group-btn${filterGroup === group ? " active" : ""}`}
                          onClick={() => setFilterGroup(group)}
                        >
                          {group}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Location" className="admin-location-field">
                    <Select
                      value={filterLocation}
                      onChange={setFilterLocation}
                      options={locationOptions}
                    />
                  </Field>
                  <Field label="Area" className="admin-area-field">
                    <Select
                      value={filterArea}
                      onChange={setFilterArea}
                      options={areaOptions}
                    />
                  </Field>
                  <Field label="Gender">
                    <Select
                      value={filterGender}
                      onChange={setFilterGender}
                      options={genderOptions}
                    />
                  </Field>
                  <Field label="Donor consent">
                    <Select
                      value={filterDonorConsent}
                      onChange={setFilterDonorConsent}
                      options={["All", "Yes", "No"]}
                    />
                  </Field>
                  <Field label="Availability">
                    <Select
                      value={filterAvailability}
                      onChange={setFilterAvailability}
                      options={["All", "Available", "Unavailable"]}
                    />
                  </Field>
                </div>
              )}
              <div className="record-results-heading">
                <h2 aria-live="polite">
                  {currentViewRecords.length > 0
                    ? `${currentViewRecords.length} matching record${currentViewRecords.length === 1 ? "" : "s"}`
                    : "No matching records"}
                </h2>
              </div>
              <section className="admin-card records-table-card">
                <div className="records-table-head">
                  <span>Person</span>
                  <span>Blood group</span>
                  <span>Location</span>
                  <span>Status</span>
                  <span>Submitted</span>
                </div>
                {paginatedRecords.map((record, index) => (
                  <RecordRow
                    key={`${record.id ?? record.name}-${index}`}
                    record={record}
                    onEdit={origin => openRecord(record, origin)}
                  />
                ))}
                {currentViewRecords.length === 0 && (
                  <div className="admin-empty">
                    <ClipboardList size={23} />
                    <h3>No records found</h3>
                    <p>Try a different search term.</p>
                  </div>
                )}
                {totalPages > 1 && (
                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      justifyContent: "center",
                      padding: "20px",
                    }}
                  >
                    <button
                      className="secondary-button"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        fontSize: "12px",
                        color: "#666",
                      }}
                    >
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      className="secondary-button"
                      disabled={currentPage === totalPages}
                      onClick={() =>
                        setCurrentPage(p => Math.min(totalPages, p + 1))
                      }
                    >
                      Next
                    </button>
                  </div>
                )}
              </section>
            </>
          ) : (
            <WorkspaceView
              view={activeView}
              records={records}
              donors={donors}
              pending={pending}
              locationRows={locationRows}
              lastSyncedAt={lastSyncedAt}
              donationPage={donationPage}
              setDonationPage={setDonationPage}
              setFilterLocation={setFilterLocation}
              setFilterArea={setFilterArea}
              goToView={goToView}
            />
          )}
        </main>
      </div>
      {selected && (
        <RecordModal
          record={selected}
          origin={selectedOrigin}
          onClose={() => { setSelected(null); setSelectedOrigin(null); }}
          onSave={saveRecord}
          setRecordingDonation={setRecordingDonation}
          setDonationDateTime={setDonationDateTime}
        />
      )}
      {donationDetailOpen && selectedDonation && (
        <DonationDetailModal
          record={selectedDonation}
          onClose={() => { setDonationDetailOpen(false); setSelectedDonation(null); }}
        />
      )}
      {recordingDonation && (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setRecordingDonation(null)}>
          <div className="modal-card donation-record-modal">
            <div className="donation-record-header">
              <h2>Record Donation</h2>
              <button className="modal-close" onClick={() => setRecordingDonation(null)}><X size={18} /></button>
            </div>
            <div className="donation-record-content">
              <div className="donation-record-donor">
                <div className="donor-avatar">{recordingDonation.initials}</div>
                <div>
                  <strong>{recordingDonation.name}</strong>
                  <span>{recordingDonation.id} · {recordingDonation.group}</span>
                </div>
              </div>
              <div className="donation-record-form">
                <label className="admin-field">
                  <span>Donation Date & Time</span>
                  <input
                    type="datetime-local"
                    className="plain-input"
                    value={donationDateTime}
                    onChange={e => setDonationDateTime(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="donation-record-actions">
              <button className="secondary-button" onClick={() => setRecordingDonation(null)}>Cancel</button>
              <button
                className="primary-button"
                disabled={!donationDateTime || !recordingDonation.id || recordDonationMutation.isPending}
                onClick={async () => {
                  if (!recordingDonation.id || !donationDateTime) return;
                  try {
                    await recordDonationMutation.mutateAsync({
                      hrsId: recordingDonation.id,
                      donationTime: new Date(donationDateTime).toISOString(),
                    });
                    await profilesQuery.refetch();
                    setRecordingDonation(null);
                    setSelected(null);
                    setSelectedOrigin(null);
                  } catch (error) {
                    console.error("Failed to record donation:", error);
                  }
                }}
              >
                {recordDonationMutation.isPending ? "Recording..." : "Record Donation"}
              </button>
            </div>
          </div>
        </div>
      )}
      {addOpen && (
        <AddPersonModal
          onClose={() => setAddOpen(false)}
          onSave={record => {
            setRecords(current => [
              {
                ...record,
                id: null,
                status: "Pending",
                consent: true,
                consentStatus: "Yes",
                availability: "Unavailable",
                donorConsent: null,
                lastDonationAt: null,
              },
              ...current,
            ]);
            setAddOpen(false);
            toast.success("Person added to pending entry.");
          }}
        />
      )}
    </div>
  );
}

function WorkspaceView({
  view,
  records,
  donors,
  pending,
  locationRows,
  lastSyncedAt,
  donationPage,
  setDonationPage,
  setFilterLocation,
  setFilterArea,
  goToView,
}: {
  view: AdminView;
  records: AdminRecord[];
  donors: AdminRecord[];
  pending: AdminRecord[];
  locationRows: { location: string; areas: string[]; count: number }[];
  lastSyncedAt: Date | null;
  donationPage: number;
  setDonationPage: React.Dispatch<React.SetStateAction<number>>;
  setFilterLocation: (location: string) => void;
  setFilterArea: (area: string) => void;
  goToView: (view: AdminView, tab?: RecordTab) => void;
}) {
  if (view === "donations") {
    // Get donors with at least one donation, sorted by most recent
    const donorsWithDonations = donors
      .filter(record => record.donationCount > 0)
      .sort((a, b) => {
        const aDate = a.lastDonationAt ? new Date(a.lastDonationAt).getTime() : 0;
        const bDate = b.lastDonationAt ? new Date(b.lastDonationAt).getTime() : 0;
        return bDate - aDate;
      });

    const itemsPerPage = 20;
    const totalPages = Math.ceil(donorsWithDonations.length / itemsPerPage);
    const paginatedDonations = donorsWithDonations.slice((donationPage - 1) * itemsPerPage, donationPage * itemsPerPage);

    return (
      <AdminSection
        eyebrow="DIRECTORY"
        title="Donations"
        description={`${donorsWithDonations.length} total donations recorded.`}
      >
        <section className="admin-card records-table-card">
          <div className="records-table-head">
            <span>Donor</span>
            <span>Blood group</span>
            <span>Location</span>
            <span>Donations</span>
            <span>Last donation</span>
          </div>
          {paginatedDonations.map(record => (
            <div
              className="records-table-row records-table-row-clickable"
              key={record.id || record.name}
              onClick={() => {
                const event = new CustomEvent('openDonationDetail', { detail: record });
                window.dispatchEvent(event);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  const event = new CustomEvent('openDonationDetail', { detail: record });
                  window.dispatchEvent(event);
                }
              }}
            >
              <div className="table-person">
                <div className="mini-avatar">{record.initials}</div>
                <div>
                  <strong>{record.name}</strong>
                  <span>{record.id ?? "ID pending"}</span>
                </div>
              </div>
              <span className="table-blood">{record.group}</span>
              <div>
                <strong>{record.location}</strong>
                <span>{record.area}</span>
              </div>
              <span className="table-donation-count">{record.donationCount}</span>
              <span className="table-date">{record.lastDonationAt ? formatShortDate(record.lastDonationAt) : "—"}</span>
            </div>
          ))}
          {donorsWithDonations.length === 0 && (
            <div className="admin-empty">
              <Heart size={23} />
              <h3>No donations recorded</h3>
              <p>Donations from verified donors will appear here.</p>
            </div>
          )}
        </section>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="donations-pagination">
            <span className="donations-pagination-info">
              Showing {(donationPage - 1) * itemsPerPage + 1}–{Math.min(donationPage * itemsPerPage, donorsWithDonations.length)} of {donorsWithDonations.length}
            </span>
            <div className="donations-pagination-controls">
              <button
                className="secondary-button"
                disabled={donationPage === 1}
                onClick={() => setDonationPage(p => Math.max(1, p - 1))}
              >
                <ArrowLeft size={14} /> Previous
              </button>
              <span className="donations-pagination-page">
                Page {donationPage} of {totalPages}
              </span>
              <button
                className="secondary-button"
                disabled={donationPage === totalPages}
                onClick={() => setDonationPage(p => Math.min(totalPages, p + 1))}
              >
                Next <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}
      </AdminSection>
    );
  }

  if (view === "locations") {
    // Compute detailed location stats
    const locationStats = useMemo(() => {
      const map = new Map<string, {
        location: string;
        areas: string[];
        totalRecords: number;
        verified: number;
        pending: number;
        available: number;
        unavailable: number;
        donors: number;
      }>();
      for (const record of records) {
        const existing = map.get(record.location);
        if (existing) {
          existing.totalRecords += 1;
          if (record.status === "Verified") existing.verified += 1;
          else existing.pending += 1;
          if (record.availability === "Available") existing.available += 1;
          else existing.unavailable += 1;
          if (record.donorConsent) existing.donors += 1;
          if (!existing.areas.includes(record.area)) existing.areas.push(record.area);
        } else {
          map.set(record.location, {
            location: record.location,
            areas: [record.area],
            totalRecords: 1,
            verified: record.status === "Verified" ? 1 : 0,
            pending: record.status === "Pending" ? 1 : 0,
            available: record.availability === "Available" ? 1 : 0,
            unavailable: record.availability === "Unavailable" ? 1 : 0,
            donors: record.donorConsent ? 1 : 0,
          });
        }
      }
      return Array.from(map.values()).sort((a, b) => b.totalRecords - a.totalRecords);
    }, [records]);

    const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
    const [locationSearch, setLocationSearch] = useState("");
    const filteredLocations = locationStats.filter(loc =>
      loc.location.toLowerCase().includes(locationSearch.toLowerCase())
    );

    return (
      <AdminSection
        eyebrow="MANAGEMENT"
        title="Locations"
        description="Manage and view all locations, areas, and donor statistics."
      >
        <div className="location-header">
          <div className="admin-search">
            <Search size={17} />
            <input
              value={locationSearch}
              onChange={e => setLocationSearch(e.target.value)}
              placeholder="Search locations..."
            />
          </div>
          <div className="location-stats-summary">
            <div className="location-stat-chip">
              <MapPin size={14} />
              <span>{locationStats.length} Locations</span>
            </div>
            <div className="location-stat-chip">
              <Users size={14} />
              <span>{records.length} Total Records</span>
            </div>
            <div className="location-stat-chip available">
              <Check size={14} />
              <span>{records.filter(r => r.availability === "Available").length} Available</span>
            </div>
            <div className="location-stat-chip donors">
              <Heart size={14} />
              <span>{records.filter(r => r.donorConsent).length} Donors</span>
            </div>
          </div>
        </div>

        <section className="admin-card locations-card">
          {filteredLocations.map(loc => (
            <div className="location-item" key={loc.location}>
              <div className="location-item-header" onClick={() => setExpandedLocation(expandedLocation === loc.location ? null : loc.location)}>
                <div className="location-info">
                  <div className="mini-avatar">
                    <MapPin size={16} />
                  </div>
                  <div>
                    <strong>{loc.location}</strong>
                    <span>{loc.areas.length} area{loc.areas.length === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <div className="location-quick-stats">
                  <span className="stat-badge">{loc.totalRecords} records</span>
                  <span className="stat-badge verified">{loc.verified} verified</span>
                  <span className="stat-badge available">{loc.available} available</span>
                </div>
                <ChevronDown size={18} className={`location-chevron ${expandedLocation === loc.location ? "expanded" : ""}`} />
              </div>
              {expandedLocation === loc.location && (
                <div className="location-item-details">
                  <div className="location-stats-grid">
                    <div className="location-stat-box">
                      <strong>{loc.totalRecords}</strong>
                      <span>Total Records</span>
                    </div>
                    <div className="location-stat-box verified">
                      <strong>{loc.verified}</strong>
                      <span>Verified</span>
                    </div>
                    <div className="location-stat-box pending">
                      <strong>{loc.pending}</strong>
                      <span>Pending</span>
                    </div>
                    <div className="location-stat-box available">
                      <strong>{loc.available}</strong>
                      <span>Available</span>
                    </div>
                    <div className="location-stat-box unavailable">
                      <strong>{loc.unavailable}</strong>
                      <span>Unavailable</span>
                    </div>
                    <div className="location-stat-box donors">
                      <strong>{loc.donors}</strong>
                      <span>Donors</span>
                    </div>
                  </div>
                  <div className="location-areas">
                    <h4>Areas in {loc.location}</h4>
                    <div className="area-tags">
                      {loc.areas.sort().map(area => {
                        const areaCount = records.filter(r => r.location === loc.location && r.area === area).length;
                        return (
                          <span key={area} className="area-tag" onClick={() => { setFilterLocation(loc.location); setFilterArea(area); goToView("records"); }}>
                            {area} <small>({areaCount})</small>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {filteredLocations.length === 0 && (
            <div className="no-locations">
              <MapPin size={32} />
              <p>No locations found</p>
            </div>
          )}
        </section>
      </AdminSection>
    );
  }

  if (view === "staff") {
    return (
      <AdminSection
        eyebrow="SYSTEM"
        title="Staff & Access"
        description="Authorized HRS staff and workspace permissions."
      >
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h2>Authorized directory</h2>
              <p>Staff permissions are managed in the authorized HRS directory.</p>
            </div>
          </div>
          <div className="recent-list">
            <div className="recent-row">
              <div className="mini-avatar">
                <UserRound size={14} />
              </div>
              <div>
                <strong>Admin</strong>
                <span>Administrator · full workspace access</span>
              </div>
              <small>Active</small>
            </div>
          </div>
        </section>
      </AdminSection>
    );
  }

  if (view === "audit") {
    return (
      <AdminSection
        eyebrow="SYSTEM"
        title="Audit Log"
        description="Recent staff activity and directory changes."
      >
        <section className="admin-card">
          <div className="recent-list" style={{ marginTop: 0 }}>
            <div className="recent-row">
              <div className="mini-avatar">
                <FileSpreadsheet size={14} />
              </div>
              <div>
                <strong>Google Sheets sync</strong>
                <span>{formatIndiaSyncTime(lastSyncedAt)}</span>
              </div>
              <small>System</small>
            </div>
            <div className="recent-row">
              <div className="mini-avatar">
                <Users size={14} />
              </div>
              <div>
                <strong>{records.length} records in directory</strong>
                <span>{pending.length} pending · {donors.length} verified</span>
              </div>
              <small>Live</small>
            </div>
          </div>
        </section>
      </AdminSection>
    );
  }

  if (view === "sync") {
    return (
      <AdminSection
        eyebrow="SYSTEM"
        title="Sync & Data"
        description="Google Sheets connection and directory refresh status."
      >
        <section className="admin-card">
          <div className="sheet-sync" style={{ background: "#f4f6f3", color: "#5c665c" }}>
            <FileSpreadsheet size={18} />
            <span>
              <strong>Google Sheets</strong>
              <small>{formatIndiaSyncTime(lastSyncedAt)}</small>
            </span>
            <span className="sync-dot" />
          </div>
          <p style={{ marginTop: 16, color: "#7d897d", fontSize: 13 }}>
            The directory refreshes automatically every 30 seconds from the published HRS sheet.
          </p>
        </section>
      </AdminSection>
    );
  }

  return (
    <AdminSection
      eyebrow="SYSTEM"
      title="Settings"
      description="Workspace preferences for the HRS staff portal."
    >
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h2>Workspace</h2>
            <p>Timezone is fixed to India Standard Time for live sync and greetings.</p>
          </div>
        </div>
        <div className="add-form" style={{ maxWidth: 420 }}>
          <Field label="Display name">
            <input className="plain-input" defaultValue="Admin" readOnly />
          </Field>
          <Field label="Role">
            <input className="plain-input" defaultValue="Administrator" readOnly />
          </Field>
        </div>
      </section>
    </AdminSection>
  );
}

function AdminSection({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="admin-page-heading compact-heading">
        <div>
          <span className="eyebrow dark-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action}
      </div>
      {children}
    </>
  );
}

function CompositionRow({ label, segments, total }: { label: string; segments: { label: string; value: number; tone: string }[]; total: number }) {
  return <div className="composition-row"><span>{label}</span><div className="composition-bar">{segments.map(segment => <div key={segment.label} className={`composition-segment ${segment.tone}`} style={{ width: `${total ? segment.value / total * 100 : 0}%` }}><b>{segment.value}</b><small>{segment.label}</small></div>)}</div></div>;
}

function Statistics({ records }: { records: AdminRecord[] }) {
  const isVerified = (record: AdminRecord) => Boolean(
    record.id && record.verifiedAt && record.group !== "—" && record.donorConsent !== null,
  );
  const verified = records.filter(isVerified);
  const pending = records.filter(record => !isVerified(record));
  // Storage consent is mandatory at registration; donation consent is recorded only on verification.
  const dataStorageConsent = records.length;
  const voluntaryDonors = verified.filter(record => record.donorConsent === true);
  const notParticipating = verified.filter(record => record.donorConsent === false);
  const availableDonors = voluntaryDonors.filter(record => record.availability === "Available");
  const unavailableDonors = voluntaryDonors.filter(record => record.availability !== "Available");
  const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
  const bloodGroupData = bloodGroups.map(group => ({
    name: group,
    value: verified.filter(record => record.group === group).length,
  }));
  const recordedGroups = verified.length;
  const pendingProfiles = pending.length;
  const donorParticipation = records.length ? Math.round((voluntaryDonors.length / records.length) * 100) : 0;
  const locationData = Array.from(new Set(records.map(record => record.location).filter(location => location && location !== "Unknown")))
    .map(location => ({ name: location, records: records.filter(record => record.location === location).length }))
    .sort((a, b) => b.records - a.records);
  const locationColors = ["#8f1426", "#d24b43", "#d8943d", "#507d9f", "#796092"];
  const ageBuckets = [
    { name: "18–20", min: 18, max: 20 }, { name: "21–25", min: 21, max: 25 }, { name: "26–30", min: 26, max: 30 },
    { name: "31–40", min: 31, max: 40 }, { name: "41–50", min: 41, max: 50 }, { name: "50+", min: 51, max: 120 },
  ].map(bucket => ({ name: bucket.name, records: records.filter(record => record.age >= bucket.min && record.age <= bucket.max).length }));
  const ageColors = ["#d65b54", "#e28c47", "#d9b344", "#7b9a72", "#4d88a8", "#77629b"];
  const genderData = ["Male", "Female", "Other"].map(gender => ({
    name: gender,
    value: gender === "Other"
      ? records.filter(record => record.gender !== "Male" && record.gender !== "Female").length
      : records.filter(record => record.gender === gender).length,
  }));
  const averageAge = records.length ? Math.round(records.reduce((sum, record) => sum + record.age, 0) / records.length) : 0;
  const largestAgeGroup = ageBuckets.reduce((largest, bucket) => bucket.records > largest.records ? bucket : largest, ageBuckets[0] ?? { name: "—", records: 0 });
  const areaData = Array.from(new Set(records.map(record => record.area).filter(area => area && area !== "Unknown")))
    .map(area => ({
      name: area,
      records: records.filter(record => record.area === area).length,
    }))
    .sort((a, b) => b.records - a.records)
    .slice(0, 6);
  const areaColors = ["#c5162d", "#e36b5d", "#d89a3c", "#778b72", "#4d7da8", "#9a5f9f"];
  const largestArea = areaData[0] ?? { name: "—", records: 0 };
  const lowestArea = areaData.length ? [...areaData].sort((a, b) => a.records - b.records)[0] : { name: "—", records: 0 };
  const coverageMatrix: Array<Record<string, string | number>> = areaData.slice(0, 5).map(area => ({ name: area.name, ...Object.fromEntries(bloodGroups.map(group => [group, verified.filter(record => record.area === area.name && record.group === group).length])) }));
  const primaryLocation = locationData.find(location => location.name.toLowerCase() === "tumkur") ?? { name: "Tumkur", records: 0 };
  const outsidePrimary = locationData.filter(location => location.name !== "Tumkur").reduce((sum, location) => sum + location.records, 0);
  const recordDate = (record: AdminRecord) => {
    if (!record.registeredAt) return null;
    const date = new Date(record.registeredAt);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const weekLabel = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
  const currentWeek = new Date();
  currentWeek.setHours(0, 0, 0, 0);
  currentWeek.setDate(currentWeek.getDate() - ((currentWeek.getDay() + 6) % 7));
  const trendData = Array.from({ length: 8 }, (_, index) => {
    const weekStart = new Date(currentWeek);
    weekStart.setDate(currentWeek.getDate() - ((7 - index) * 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const slice = records.filter(record => {
      const date = recordDate(record);
      return date && date < weekEnd;
    });
    return {
      period: weekLabel.format(weekStart),
      records: slice.length,
      verified: slice.filter(record => isVerified(record) && record.verifiedAt && new Date(record.verifiedAt) < weekEnd).length,
      donors: slice.filter(record => isVerified(record) && record.donorConsent === true && record.verifiedAt && new Date(record.verifiedAt) < weekEnd).length,
    };
  });
  const now = new Date();
  const activity = records.filter(record => {
    const date = recordDate(record);
    return date && date <= now;
  });
  const newToday = activity.filter(record => {
    const date = recordDate(record)!;
    return date.toDateString() === now.toDateString();
  }).length;
  const newThisWeek = activity.filter(record => { const elapsed = now.getTime() - recordDate(record)!.getTime(); return elapsed >= 0 && elapsed <= 7 * 24 * 60 * 60 * 1000; }).length;
  const newThisMonth = activity.filter(record => {
    const date = recordDate(record)!;
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;
  const lastMonth = activity.filter(record => {
    const date = recordDate(record)!;
    const prior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return date.getMonth() === prior.getMonth() && date.getFullYear() === prior.getFullYear();
  }).length;
  const monthlyChange = lastMonth ? Math.round(((newThisMonth - lastMonth) / lastMonth) * 100) : 0;
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const verifiedThisWeek = verified.filter(record => record.verifiedAt && new Date(record.verifiedAt) >= weekStart).length;
  const donorOptInsThisWeek = voluntaryDonors.filter(record => record.verifiedAt && new Date(record.verifiedAt) >= weekStart).length;
  const totalDonations = voluntaryDonors.reduce((total, record) => total + record.donationCount, 0);
  const donorsWhoDonated = voluntaryDonors.filter(record => record.donationCount > 0).length;
  const donorsWithNoDonations = voluntaryDonors.length - donorsWhoDonated;
  const donationDates = voluntaryDonors.flatMap(record => record.donationDates)
    .map(value => new Date(value)).filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  const mostRecentDonation = donationDates[0] ?? null;
  const completionRate = records.length
    ? Math.round((verified.length / records.length) * 100)
    : 0;

  return (
    <>
      <div className="admin-page-heading statistics-heading">
        <div>
          <span className="eyebrow dark-eyebrow">NETWORK INTELLIGENCE</span>
          <h1>Statistics</h1>
          <p>A live overview of the HRS blood group network, verification progress, donor participation and community reach.</p>
        </div>
        <div className="statistics-period"><span className="statistics-live-dot" /> Live data from the HRS directory</div>
      </div>
      <div className="statistics-kpis">
        <div className="statistics-kpi">
          <span>Total Records</span>
          <strong>{records.length}</strong>
          <small>All registered profiles</small>
        </div>
        <div className="statistics-kpi">
          <span>Verified Profiles</span>
          <strong>{verified.length}</strong>
          <small>
            {records.length
              ? Math.round((verified.length / records.length) * 100)
              : 0}
            % of records
          </small>
        </div>
        <div className="statistics-kpi">
          <span>Pending Verification</span>
          <strong>{pendingProfiles}</strong>
          <small>Awaiting blood group and donor consent</small>
        </div>
        <div className="statistics-kpi">
          <span>Voluntary Donors</span>
          <strong>{voluntaryDonors.length}</strong>
          <small>{donorParticipation}% of all records</small>
        </div>
        <div className="statistics-kpi">
          <span>Available Now</span>
          <strong>{availableDonors.length}</strong>
          <small>Ready for donor coordination</small>
        </div>
        <div className="statistics-kpi">
          <span>Temporarily Unavailable</span>
          <strong>{unavailableDonors.length}</strong>
          <small>Awaiting next eligible time</small>
        </div>
      </div>
      <section className="statistics-composition" aria-label="Directory composition">
        <div className="statistics-composition-heading"><span>Directory composition</span><p>How records progress from registration to donor availability.</p></div>
        <div className="composition-rows">
          <CompositionRow label={`${records.length} Total Records`} segments={[{ label: "Verified Profiles", value: verified.length, tone: "verified" }, { label: "Pending Verification", value: pendingProfiles, tone: "pending" }]} total={records.length} />
          <CompositionRow label={`${verified.length} Verified Profiles`} segments={[{ label: "Voluntary Donors", value: voluntaryDonors.length, tone: "donor" }, { label: "Not Participating", value: notParticipating.length, tone: "neutral" }]} total={verified.length} />
          <CompositionRow label={`${voluntaryDonors.length} Voluntary Donors`} segments={[{ label: "Available Now", value: availableDonors.length, tone: "available" }, { label: "Temporarily Unavailable", value: unavailableDonors.length, tone: "unavailable" }]} total={voluntaryDonors.length} />
        </div>
      </section>
      <div className="statistics-grid">
        <section className="statistics-card statistics-trend-card">
          <div className="statistics-card-heading">
            <div>
              <span>Weekly growth · registration and verification</span>
              <h2>Network growth over time</h2>
              <p className="statistics-card-description">Weekly growth based on registration and verification timestamps.</p>
            </div>
            <span className="statistics-legend">
              <i className="legend-deep" /> Directory <i className="legend-red" /> Verified <i className="legend-soft" /> Voluntary donors
            </span>
          </div>
          <div className="statistics-chart statistics-chart-tall">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={trendData}
                margin={{ top: 12, right: 8, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="recordsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c92f3b" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="#c92f3b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#edf0ed" />
                <XAxis
                  dataKey="period"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#8a938a" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#8a938a" }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    border: "1px solid #dfe4df",
                    borderRadius: 8,
                    fontSize: 11,
                    boxShadow: "0 6px 18px rgba(28,39,31,.08)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="records"
                  stroke="#980e23"
                  strokeWidth={3}
                  fill="url(#recordsFill)"
                />
                <Area
                  type="monotone"
                  dataKey="verified"
                  stroke="#e5253a"
                  strokeWidth={2.5}
                  fill="none"
                />
                <Area
                  type="monotone"
                  dataKey="donors"
                  stroke="#fca5a5"
                  strokeWidth={2.5}
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="statistics-week-summary"><span>This week</span><b>+{newThisWeek} records</b><b>+{verifiedThisWeek} verified</b><b>+{donorOptInsThisWeek} donor opt-ins</b></div>
        </section>
        <section className="statistics-card statistics-blood-card">
          <div className="statistics-card-heading">
            <div>
              <span>Rh & ABO profile matrix</span>
              <h2>Blood group distribution</h2>
              <p className="statistics-card-description">Verified laboratory-recorded groups across the live directory.</p>
            </div>
          </div>
          <div className="statistics-chart statistics-chart-blood">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bloodGroupData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="#f0e4de" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#9a8981" }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#4a0710", fontWeight: 700 }} width={34} />
                <Tooltip contentStyle={{ border: "1px solid #ebdfd9", borderRadius: 10, fontSize: 11 }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
                  {bloodGroupData.map((entry, index) => (
                    <Cell key={entry.name} fill={index < 4 ? "#980e23" : index < 6 ? "#c5162d" : "#f98080"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="statistics-blood-strip">
            {bloodGroupData.map((item, index) => (
              <span key={item.name}>
                <i
                  style={{
                    background: index < 4 ? "#980e23" : index < 6 ? "#c5162d" : "#f98080",
                  }}
                />
                {item.name}
                <b>{item.value}</b>
              </span>
            ))}
          </div>
          <div className="statistics-blood-meta"><span><b>Blood Groups Recorded</b>{recordedGroups} / {records.length}</span><span><b>Not Yet Recorded</b>{pendingProfiles}</span></div>
        </section>
        <section className="statistics-card statistics-area-card">
          <div className="statistics-card-heading">
            <div>
              <span>Local reach</span>
              <h2>Records by area</h2>
            </div>
          </div>
          <div className="statistics-chart statistics-chart-medium">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={areaData}
                layout="vertical"
                margin={{ top: 0, right: 10, left: 8, bottom: 0 }}
              >
                <CartesianGrid horizontal={false} stroke="#edf0ed" />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#8a938a" }}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#596359" }}
                  width={90}
                />
                <Tooltip
                  cursor={{ fill: "#f5f7f4" }}
                  contentStyle={{
                    border: "1px solid #dfe4df",
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                />
                <Bar dataKey="records" radius={[0, 7, 7, 0]} barSize={20}>
                  {areaData.map((area, index) => (
                    <Cell key={area.name} fill={areaColors[index % areaColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="statistics-area-insights"><span><small>Largest represented area</small><b>{largestArea.name}</b><em>{largestArea.records} records</em></span><span><small>Lowest represented area</small><b>{lowestArea.name}</b><em>{lowestArea.records} records</em></span></div>
        </section>
        <section className="statistics-card statistics-wide-card">
          <div className="statistics-card-heading"><div><span>Verification and consent</span><h2>Registration approval and blood donation participation are separate stages.</h2><p className="statistics-card-description">A verified profile has both a recorded blood group and a recorded Blood Donation Consent decision.</p></div></div>
          <div className="statistics-consent-analysis">
            <div className="statistics-consent-track">
              <div className="statistics-consent-label"><span>1. Data Storage Consent</span><b>100%</b></div>
              <div className="statistics-consent-bar"><i style={{ width: "100%" }} /></div>
              <small>{dataStorageConsent} / {records.length} · Required during registration</small>
            </div>
            <div className="statistics-consent-track">
              <div className="statistics-consent-label"><span>2. Verification Completed</span><b>{completionRate}%</b></div>
              <div className="statistics-consent-bar donor"><i style={{ width: `${completionRate}%` }} /></div>
              <small>{verified.length} / {records.length} · Blood group and donation consent recorded</small>
            </div>
          </div>
          <div className="statistics-outcome-grid"><span><b>{voluntaryDonors.length} / {verified.length || 0}</b>Voluntary Donors</span><span><b>{notParticipating.length} / {verified.length || 0}</b>Not Participating</span><span><b>{pendingProfiles} / {records.length}</b>Awaiting Verification</span></div>
          <div className="statistics-consent-note"><strong>Important:</strong> consent to store directory information does not automatically enroll a person as a blood donor.</div>
        </section>
        <section className="statistics-card statistics-wide-card">
          <div className="statistics-card-heading"><div><span>Profile completeness</span><h2>How complete is the directory?</h2></div></div>
          <div className="statistics-progress-grid"><div><span>Verified Profiles <b>{verified.length} / {records.length}</b></span><i><em style={{ width: `${completionRate}%` }} /></i></div><div><span>Pending Verification <b>{pendingProfiles} / {records.length}</b></span><i><em style={{ width: `${records.length ? pendingProfiles / records.length * 100 : 0}%` }} /></i></div><div><span>Blood Groups Recorded <b>{recordedGroups} / {records.length}</b></span><i><em style={{ width: `${completionRate}%` }} /></i></div><div><span>Verification Time Recorded <b>{verified.filter(record => record.verifiedAt).length} / {records.length}</b></span><i><em style={{ width: `${completionRate}%` }} /></i></div><div><span>HRS IDs Generated <b>{verified.filter(record => record.id).length} / {records.length}</b></span><i><em style={{ width: `${completionRate}%` }} /></i></div></div>
        </section>
        <section className="statistics-card statistics-wide-card"><div className="statistics-card-heading"><div><span>City / geographic distribution</span><h2>Tumkur and beyond.</h2></div></div><div className="statistics-location-layout"><div className="statistics-location-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={locationData} margin={{ top: 4, right: 12, left: -22, bottom: 0 }}><CartesianGrid vertical={false} stroke="#edf0ed" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#697369" }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8a938a" }} allowDecimals={false} /><Tooltip contentStyle={{ border: "1px solid #dfe4df", borderRadius: 8, fontSize: 11 }} /><Bar dataKey="records" radius={[7, 7, 0, 0]} barSize={30}>{locationData.map((location, index) => <Cell key={location.name} fill={locationColors[index % locationColors.length]} />)}</Bar></BarChart></ResponsiveContainer></div><div className="statistics-insight-stack"><div><span>Primary network location</span><strong>{primaryLocation.name}</strong><small>{primaryLocation.records} records</small></div><div><span>Outside Tumkur</span><strong>{outsidePrimary}</strong><small>records across other cities</small></div></div></div></section>
        <section className="statistics-card statistics-availability-card"><div className="statistics-card-heading"><div><span>Donor Availability</span><h2>Who can be coordinated now?</h2><p className="statistics-card-description">Availability is based on the donor's latest recorded donation and next eligible date/time.</p></div></div><div className="availability-total"><strong>{voluntaryDonors.length}</strong><span>Active Voluntary Donors</span></div><div className="availability-bars"><div><span>Available Now <b>{availableDonors.length}</b></span><i><em style={{ width: `${voluntaryDonors.length ? availableDonors.length / voluntaryDonors.length * 100 : 0}%` }} /></i></div><div><span>Temporarily Unavailable <b>{unavailableDonors.length}</b></span><i><em style={{ width: `${voluntaryDonors.length ? unavailableDonors.length / voluntaryDonors.length * 100 : 0}%` }} /></i></div></div><p className="availability-rate">Eligibility rate <b>{availableDonors.length} / {voluntaryDonors.length}</b> · {voluntaryDonors.length ? (availableDonors.length / voluntaryDonors.length * 100).toFixed(1) : "0.0"}% currently available</p></section>
        <section className="statistics-card statistics-donations-card"><div className="statistics-card-heading"><div><span>Blood Donation Activity</span><h2>Donation history</h2></div></div>{totalDonations > 0 ? <><div className="donation-summary"><div><b>{totalDonations}</b><span>Total donations</span></div><div><b>{donorsWhoDonated}</b><span>Donors who have donated</span></div><div><b>{voluntaryDonors.length ? (totalDonations / voluntaryDonors.length).toFixed(1) : "0.0"}</b><span>Average per donor</span></div></div><p className="donation-latest">Most recent donation <b>{mostRecentDonation ? mostRecentDonation.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not yet recorded"}</b></p></> : <div className="donation-empty"><Heart size={18} /><p>No blood donations have been recorded yet.</p><small>{donorsWithNoDonations} voluntary donors have no donations recorded.</small></div>}</section>
        <section className="statistics-card"><div className="statistics-card-heading"><div><span>Network demographics</span><h2>Age distribution</h2></div></div><div className="statistics-mini-stat"><strong>{averageAge}</strong><span>average age · largest group {largestAgeGroup.name}</span></div><div className="statistics-chart statistics-chart-short"><ResponsiveContainer width="100%" height="100%"><BarChart data={ageBuckets} margin={{ top: 4, right: 2, left: -24, bottom: 0 }}><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#697369" }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#8a938a" }} allowDecimals={false} /><Tooltip contentStyle={{ border: "1px solid #dfe4df", borderRadius: 8, fontSize: 11 }} /><Bar dataKey="records" radius={[5, 5, 0, 0]} barSize={25}>{ageBuckets.map((bucket, index) => <Cell key={bucket.name} fill={ageColors[index]} />)}</Bar></BarChart></ResponsiveContainer></div></section>
        <section className="statistics-card"><div className="statistics-card-heading"><div><span>Representation</span><h2>Gender distribution</h2></div></div><div className="statistics-chart statistics-chart-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={genderData} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="79%" paddingAngle={3} stroke="none">{genderData.map((item, index) => <Cell key={item.name} fill={["#8fa493", "#c92f3b", "#d8b36d"][index % 3]} />)}</Pie><Tooltip contentStyle={{ border: "1px solid #dfe4df", borderRadius: 8, fontSize: 11 }} /></PieChart></ResponsiveContainer><div className="statistics-donut-total"><strong>{records.length}</strong><span>people</span></div></div><div className="statistics-status-list">{genderData.map((item, index) => <span key={item.name}><i style={{ background: ["#8fa493", "#c92f3b", "#d8b36d"][index] }} />{item.name}<b>{item.value} · {records.length ? Math.round(item.value / records.length * 100) : 0}%</b></span>)}</div></section>
        <section className="statistics-card statistics-wide-card"><div className="statistics-card-heading"><div><span>Blood group × area</span><h2>Coverage matrix</h2></div></div><div className="statistics-matrix-wrap"><table className="statistics-matrix"><thead><tr><th>Area</th>{bloodGroups.map(group => <th key={group}>{group}</th>)}</tr></thead><tbody>{coverageMatrix.map(area => <tr key={area.name}><th>{area.name}</th>{bloodGroups.map(group => <td key={group} className={Number(area[group]) > 0 ? "has-coverage" : ""}>{String(area[group] ?? 0)}</td>)}</tr>)}</tbody></table></div></section>
        <section className="statistics-card statistics-wide-card"><div className="statistics-card-heading"><div><span>Data collection activity</span><h2>Recent registration activity</h2></div></div><div className="statistics-activity-grid"><div><strong>{newToday}</strong><span>New records today</span></div><div><strong>{newThisWeek}</strong><span>New records this week</span></div><div><strong>{newThisMonth}</strong><span>New records this month</span></div><div><strong>{monthlyChange > 0 ? "+" : ""}{monthlyChange}%</strong><span>Month-over-month change</span></div><div><strong>{verifiedThisWeek}</strong><span>Verifications this week</span></div><div><strong>{donorOptInsThisWeek}</strong><span>New donor opt-ins this week</span></div></div></section>
        <section className="statistics-card statistics-wide-card statistics-health-card"><div className="statistics-card-heading"><div><span>Directory status</span><h2>Current network health</h2></div></div><div className="statistics-health-list"><span><b>Total Records</b><strong>{records.length}</strong></span><span><b>Verified Profiles</b><strong>{verified.length}</strong></span><span><b>Pending Verification</b><strong>{pendingProfiles}</strong></span><span><b>Active Voluntary Donors</b><strong>{voluntaryDonors.length}</strong></span><span><b>Not Participating</b><strong>{notParticipating.length}</strong></span><span><b>Currently Available</b><strong>{availableDonors.length}</strong></span><span><b>Temporarily Unavailable</b><strong>{unavailableDonors.length}</strong></span><span><b>Blood Groups Recorded</b><strong>{recordedGroups}</strong></span><span><b>HRS IDs Generated</b><strong>{verified.filter(record => record.id).length}</strong></span></div></section>
      </div>
    </>
  );
}

function DashboardLoading() {
  return (
    <div className="dashboard-loading" role="status" aria-live="polite" aria-label="Loading dashboard data">
      <div className="dashboard-loading-banner">
        <div className="dashboard-loading-orbit"><RefreshCw size={19} /></div>
        <div>
          <strong>Connecting to the HRS directory</strong>
          <span>Loading the latest registrations and donor readiness data...</span>
        </div>
      </div>
      <div className="dashboard-loading-metrics">
        {["Total records", "Verified groups", "Pending entry", "Added"].map(label => (
          <div className="dashboard-loading-card" key={label}>
            <span>{label}</span>
            <i />
            <em />
          </div>
        ))}
      </div>
      <div className="dashboard-loading-panels">
        <div className="dashboard-loading-panel"><i /><i /><i /><i /></div>
        <div className="dashboard-loading-panel"><i /><i /><i /><i /></div>
      </div>
    </div>
  );
}

function PendingRow({
  record,
  onOpen,
}: {
  record: AdminRecord;
  onOpen: () => void;
}) {
  return (
    <div className="pending-row">
      <div className="pending-record-person">
        <div className="mini-avatar pending-avatar">{record.initials}</div>
        <div className="pending-person">
          <strong>{record.name}</strong>
          <span>
            {record.area}, {record.location} · Added {record.submitted}
          </span>
        </div>
      </div>
      <span className="pending-pill">Group needed</span>
      <button className="review-button" onClick={onOpen}>
        Review <ArrowRight size={14} />
      </button>
    </div>
  );
}

function RecordRow({
  record,
  onEdit,
  showSubmitted = true,
}: {
  record: AdminRecord;
  onEdit: (origin?: ModalOrigin) => void;
  showSubmitted?: boolean;
}) {
  return (
    <div className="records-table-row profile-row-clickable" onClick={event => onEdit({ x: event.clientX, y: event.clientY })} role="button" tabIndex={0} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") onEdit(); }}>
      <div className="table-person">
        <div className="mini-avatar">{record.initials}</div>
        <div>
          <strong>{record.name}</strong>
          <span>{record.id ?? "ID generated on save"}</span>
        </div>
      </div>
      <div>
        {record.group === "—" ? (
          <span className="not-entered">Not entered</span>
        ) : (
          <span className="table-blood">{record.group}</span>
        )}
      </div>
      <div>
        <strong>{record.area}</strong>
        <span>{record.location}</span>
      </div>
      <div>
        <span className={`table-status ${record.status.toLowerCase()}`}>
          <span className="status-dot" /> {record.status}
        </span>
      </div>
      {showSubmitted && <div className="table-date">{record.submitted}</div>}
    </div>
  );
}

function RecordModal({
  record,
  origin,
  onClose,
  onSave,
  setRecordingDonation,
  setDonationDateTime,
}: {
  record: AdminRecord;
  origin: ModalOrigin | null;
  onClose: () => void;
  onSave: (record: AdminRecord, group: string, donationConsent: boolean | null, onSuccess?: (id: string) => void) => void;
  setRecordingDonation: (record: AdminRecord | null) => void;
  setDonationDateTime: (dateTime: string) => void;
}) {
  const profileWindowRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  useLayoutEffect(() => {
    if (!origin || !profileWindowRef.current) return;
    const rect = profileWindowRef.current.getBoundingClientRect();
    profileWindowRef.current.style.setProperty("--profile-origin-x", `${origin.x - rect.left}px`);
    profileWindowRef.current.style.setProperty("--profile-origin-y", `${origin.y - rect.top}px`);
  }, [origin]);

  const isPending = record.status === "Pending";
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [saveState, setSaveState] = useState<"idle" | "success" | "error">("idle");
  const [savedId, setSavedId] = useState(record.id);
  const [group, setGroup] = useState(record.group === "—" ? "" : record.group);
  const [donationConsent, setDonationConsent] = useState<boolean | null>(record.donorConsent);
  const [storageConfirmed, setStorageConfirmed] = useState(record.consent);
  // Edit mode state variables
  const [editName, setEditName] = useState(record.name);
  const [editDateOfBirth, setEditDateOfBirth] = useState(record.dateOfBirth);
  const [editGender, setEditGender] = useState(record.gender);
  const [editMobile, setEditMobile] = useState(record.mobile);
  const [editEmail, setEditEmail] = useState(record.email);
  const [editArea, setEditArea] = useState(record.area);
  const [editLocation, setEditLocation] = useState(record.location);
  const [activityOpen, setActivityOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasDonationHistory = record.donationCount > 0 && record.donationDates.length > 0;
  const lastDonation = record.donationDates.at(-1);
  const statusLabel = record.availability === "Available" ? "Eligible to donate" : record.nextEligibleAt ? "Temporarily unavailable" : "Eligibility unknown";
  const activityEvents = [
    record.registeredAt ? { date: record.registeredAt, label: "Registration submitted" } : null,
    record.status === "Verified" && record.verifiedAt ? { date: record.verifiedAt, label: `Blood group ${record.group} recorded` } : null,
    record.status === "Verified" && record.verifiedAt ? { date: record.verifiedAt, label: `Blood donation consent recorded — ${record.donorConsent ? "Yes" : "No"}` } : null,
    record.status === "Verified" && record.verifiedAt ? { date: record.verifiedAt, label: "Profile verified" } : null,
    record.id && record.verifiedAt ? { date: record.verifiedAt, label: `HRS ID generated — ${record.id}` } : null,
    ...record.donationDates.map((date, index) => ({ date, label: `${index + 1}${index === 0 ? "st" : index === 1 ? "nd" : "rd"} blood donation recorded` })),
  ].filter((event): event is { date: string; label: string } => Boolean(event));
  return (
    <div
      className="modal-backdrop"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section ref={profileWindowRef} className="admin-modal profile-modal" role="dialog" aria-modal="true">
        {saveState === "success" ? (
          <div className="profile-save-success">
            <div className="profile-success-icon"><Check size={24} /></div>
            <span className="profile-section-kicker">Changes saved</span>
            <h2>Profile updated</h2>
            <p>All changes have been saved successfully.</p>
            <button className="primary-button" onClick={onClose}>Back to Records <ArrowRight size={16} /></button>
          </div>
        ) : (
          <>
            <div className="profile-topline">
              <button className="profile-back-button" onClick={onClose}><ArrowLeft size={15} /> Back to Records</button>
              {!isPending && <button className="secondary-button profile-top-edit" onClick={() => { setMode("edit"); setSaveState("idle"); setEditName(record.name); setEditDateOfBirth(record.dateOfBirth); setEditGender(record.gender); setEditMobile(record.mobile); setEditEmail(record.email); setEditArea(record.area); setEditLocation(record.location); }}><Edit3 size={14} /> Edit</button>}
            </div>
            <header className="profile-header">
              <div className="profile-id-block">
                <div className={`profile-id-value${isPending ? " pending" : ""}`}>{record.id || "ID will be generated after verification"}</div>
              </div>
          <div className="profile-identity">
            <div className="profile-avatar">{record.initials}<span className={`profile-avatar-status ${record.status.toLowerCase()}`}>{record.status === "Verified" ? <Check size={10} /> : <Clock3 size={10} />}</span></div>
            <div>
              <h2>{record.name}</h2>
              <div className="profile-badges">
                <span className={`profile-status ${record.status.toLowerCase()}`}>● {record.status.toUpperCase()}</span>
                {record.donorConsent === true && <span className="profile-status consented">DONOR CONSENTED</span>}
                {record.donorConsent === false && <span className="profile-status private">NOT PUBLIC</span>}
              </div>
            </div>
          </div>
          <div className="profile-blood-block">
            <div className="profile-blood-badge">{record.group === "—" ? "—" : record.group}<small>{record.group === "—" ? "Pending" : "Blood group"}</small></div>
          </div>
        </header>
        <div className="profile-overview-strip">
          <div><span><Clock3 size={13} /> Registered</span><strong>{formatRecordDate(record.registeredAt)}</strong></div>
          <div><span><BadgeCheck size={13} /> Verified</span><strong>{isPending ? "Not verified yet" : formatRecordDate(record.verifiedAt)}</strong></div>
          <div className={`profile-overview-status ${isPending || record.availability === "Unavailable" || record.donorConsent === false ? "attention" : ""}`}><span><Heart size={13} /> Donation status</span><strong>{isPending ? "Awaiting verification" : record.donorConsent === false ? "Not participating" : record.availability === "Available" ? "Eligible to donate" : "Temporarily unavailable"}</strong></div>
        </div>

        <div className="profile-detail-section profile-personal-section"><h3><UserRound size={15} /> Personal information</h3><div className="profile-detail-grid">
          <div className="profile-detail-row profile-detail-top-row">
            <div><span>Full name</span>{mode === "edit" ? <input className="plain-input" value={editName} onChange={e => setEditName(e.target.value)} /> : <strong>{record.name}</strong>}</div>
            <div><span>Date of birth</span><strong>{formatShortDate(record.dateOfBirth)} · {formatAge(record.dateOfBirth)}</strong></div>
            <div><span>Gender</span>{mode === "edit" ? <select className="plain-input" value={editGender} onChange={e => setEditGender(e.target.value)}><option value="Male">Male</option><option value="Female">Female</option><option value="Prefer not to say">Prefer not to say</option></select> : <strong>{record.gender}</strong>}</div>
            <div><span>Mobile number</span>{mode === "edit" ? <input className="plain-input" type="tel" value={editMobile} onChange={e => setEditMobile(e.target.value)} /> : <strong>{record.mobile}</strong>}</div>
          </div>
          <div className="profile-detail-row profile-detail-bottom-row">
            <div className="profile-email-field"><span>Email</span>{mode === "edit" ? <input className="plain-input" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} /> : <strong>{record.email}</strong>}</div>
            <div><span>Address / area</span>{mode === "edit" ? <input className="plain-input" value={editArea} onChange={e => setEditArea(e.target.value)} /> : <strong>{record.area}</strong>}</div>
            <div><span>City</span>{mode === "edit" ? <select className="plain-input" value={editLocation} onChange={e => setEditLocation(e.target.value)}><option value="Tumkur">Tumkur</option><option value="Hassan">Hassan</option><option value="Bangalore">Bangalore</option></select> : <strong>{record.location}</strong>}</div>
          </div>
        </div>

        <div className={`profile-detail-section profile-consent-section${isPending ? " profile-consent-pending" : ""}`}><h3><ShieldCheck size={15} /> Consent</h3><div className="profile-consent-layout"><div className="profile-consent-row"><b className="profile-consent-icon">✓</b><span><small>Data storage consent</small><strong>Given</strong><em>Consent to store registration information</em></span></div><div className="profile-consent-row"><b className={`profile-consent-icon ${record.donorConsent === true ? "" : "muted"}`}>{record.donorConsent === null ? "−" : record.donorConsent ? "✓" : "×"}</b><span><small>Blood donation consent</small><strong>{record.donorConsent === null ? "Not yet recorded" : record.donorConsent ? "Yes · willing to donate" : "No · not participating"}</strong><em>{record.donorConsent === null ? "Will be collected during verification" : record.donorConsent ? "Can participate in blood donation" : "Not available for donation or public listing"}</em></span></div></div></div>

        {isPending ? <div className="profile-verification-section">
          <div className="profile-verification-heading"><div><span className="profile-section-kicker">Complete verification</span><h3>Record blood group and donation consent</h3></div><span className="profile-required">2 required fields</span></div>
          <div className="profile-verification-fields">
            <div><span className="profile-field-label">Blood group · Required</span><div className="profile-blood-choice-grid">{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(bloodGroup => <button type="button" key={bloodGroup} className={group === bloodGroup ? "selected" : ""} onClick={() => setGroup(bloodGroup)}>{bloodGroup}</button>)}</div></div>
            <div><span className="profile-field-label">Blood donation consent · Required</span><div className="profile-choice-group"><button type="button" className={donationConsent === true ? "selected yes" : ""} onClick={() => setDonationConsent(true)}>Yes</button><button type="button" className={donationConsent === false ? "selected no" : ""} onClick={() => setDonationConsent(false)}>No</button></div><button type="button" className={`profile-storage-toggle${storageConfirmed ? " active" : ""}`} role="switch" aria-checked={storageConfirmed} onClick={() => setStorageConfirmed(value => !value)}><span className="toggle-track"><i /></span><span>Data storage consent confirmed</span></button></div>
          </div>
          <p className="profile-helper">{!group ? "Add a blood group to generate an ID." : !storageConfirmed ? "Confirm the required storage consent to continue." : "Save to record the verification time and generate the HRS ID."}</p>
          <div className="profile-edit-actions-row">
            <button className="primary-button profile-verify-button" disabled={!group || donationConsent === null || !storageConfirmed} onClick={() => { onSave(record, group, donationConsent, id => { setSavedId(id); setSaveState("success"); }); }}>Verify & generate HRS ID <ArrowRight size={16} /></button>
          </div>
        </div> : null}

        {!isPending && mode === "edit" ? (
          <div className="profile-verification-section">
            <div className="profile-verification-heading">
              <div>
                <span className="profile-section-kicker">Edit profile</span>
                <h3>Update blood group</h3>
              </div>
            </div>
            <div className="profile-verification-fields">
              <div>
                <span className="profile-field-label">Blood group</span>
                <div className="profile-blood-choice-grid">
                  {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(bg => (
                    <button type="button" key={bg} className={group === bg ? "selected" : ""} onClick={() => setGroup(bg)}>
                      {bg}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : !isPending && record.donorConsent === false ? (
          <div className="profile-detail-section profile-disabled-section">
            <h3>Donation status</h3>
            <div className="profile-disabled-grid">
              <div><span>Blood donation consent</span><strong>No</strong></div>
              <div><span>Public donor visibility</span><strong>Hidden</strong></div>
              <div><span>Donation tracking</span><strong>Disabled</strong></div>
              <div><span>Blood donation count</span><strong>Not applicable</strong></div>
            </div>
          </div>
        ) : !isPending ? (
          <>
            <div className="profile-detail-section profile-donation-section">
              <h3><Droplets size={15} /> Donation summary</h3>
              <div className="profile-donation-summary">
                <div className="profile-summary-stat"><span>Total donations</span><strong>{record.donationCount}</strong></div>
                <div className="profile-summary-stat"><span>Last donation</span><strong>{hasDonationHistory ? formatShortDate(lastDonation) : "Not yet donated"}</strong></div>
                <div className="profile-summary-stat"><span>Next eligible</span><strong>{record.nextEligibleAt ? formatShortDate(record.nextEligibleAt) : "Not recorded"}</strong></div>
                <div className={`profile-readiness ${record.availability === "Unavailable" ? "unavailable" : ""}`}>
                  <span>{record.availability === "Available" ? <Check size={18} /> : <Clock3 size={18} />}</span>
                  <div>
                    <strong>{statusLabel}</strong>
                  </div>
                </div>
              </div>
              <div className="profile-public-status">● {record.publicVisible ? "Visible publicly" : "Not visible publicly"}</div>
            </div>
            <div className={`profile-history-section${historyOpen ? " open" : " collapsed"}`}>
              <div className="profile-history-heading">
                <h3><Droplets size={15} /> Donation history</h3>
                <button type="button" className="profile-history-toggle" onClick={() => setHistoryOpen(open => !open)} aria-expanded={historyOpen}>
                  {historyOpen ? "Hide" : "View"}
                  <ChevronDown size={15} />
                </button>
              </div>
              <div className="profile-history-panel">
                {record.donationDates.length ? (
                  <div className="profile-history-inner">
                    <div className="profile-history-head">
                      <span>Donation</span>
                      <b>Donated on</b>
                      <b>Eligible date</b>
                      <b>Status</b>
                    </div>
                    {record.donationDates.map((date, index) => {
                      const eligibleDate = record.donationEligibleDates[index];
                      const isLast = index === record.donationDates.length - 1;
                      const nextEligibleDate = eligibleDate ? new Date(eligibleDate) : null;
                      const isFuture = nextEligibleDate ? nextEligibleDate > new Date() : false;
                      return (
                        <div key={`${date}-${index}`}>
                          <span>Donation #{index + 1}</span>
                          <b>{formatShortDate(date)}</b>
                          <b>{eligibleDate ? formatShortDate(eligibleDate) : "—"}</b>
                          <small className="profile-history-status">
                            {isLast ? (
                              isFuture ? (
                                <div className="eligible-icon eligible-icon-amber" title={`Eligible on ${formatShortDate(eligibleDate)}`}><Clock3 size={16} strokeWidth={2.4} /></div>
                              ) : (
                                <div className="eligible-icon eligible-icon-green" title="Eligible now"><BadgeCheck size={16} strokeWidth={2.4} /></div>
                              )
                            ) : (
                              <div className="eligible-icon eligible-icon-green" title="Eligible since this donation"><BadgeCheck size={16} strokeWidth={2.4} /></div>
                            )}
                          </small>
                        </div>
                      );
                    })}
                    <div className="profile-history-footer">
                      <button className="secondary-button profile-donation-button" disabled={record.availability !== "Available"} title={record.availability === "Available" ? "Record a new donation" : `New donation can be recorded after ${formatShortDate(record.nextEligibleAt)}`} onClick={() => { setRecordingDonation(record); setDonationDateTime(new Date().toISOString().slice(0, 16)); }}>
                        <Plus size={15} className="profile-donation-button-icon" /> Record new donation
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="profile-history-inner">
                    <p className="profile-empty">No blood donations have been recorded yet.</p>
                    <div className="profile-history-footer">
                      <button className="secondary-button profile-donation-button" disabled={record.availability !== "Available"} title={record.availability === "Available" ? "Record a new donation" : `New donation can be recorded after ${formatShortDate(record.nextEligibleAt)}`} onClick={() => { setRecordingDonation(record); setDonationDateTime(new Date().toISOString().slice(0, 16)); }}>
                        <Plus size={15} className="profile-donation-button-icon" /> Record new donation
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {!isPending && mode === "view" && (
              <div className={`profile-activity-section${activityOpen ? " open" : " collapsed"}`}>
                <div className="profile-activity-heading">
                  <div>
                    <h3><History size={15} /> Activity timeline</h3>
                    <span>{activityEvents.length} recorded events</span>
                  </div>
                  <button type="button" className="profile-activity-toggle" onClick={() => setActivityOpen(open => !open)} aria-expanded={activityOpen} aria-controls={`activity-${record.id || record.name}`}>
                    {activityOpen ? "Hide activity" : "View activity"}
                    <ChevronDown size={15} />
                  </button>
                </div>
                <div className="profile-activity-panel" id={`activity-${record.id || record.name}`} aria-hidden={!activityOpen}>
                  <div className="profile-activity-timeline">
                    {activityEvents.map((event, index) => (
                      <div key={`${event.date}-${event.label}-${index}`}>
                        <span className="profile-activity-dot" />
                        <div>
                          <b>{formatShortDate(event.date)}</b>
                          <span>{event.label}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}

function AddPersonModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (record: AdminRecord) => void;
}) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [area, setArea] = useState("Tumkur City");
  return (
    <div
      className="modal-backdrop"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section className="admin-modal" role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="modal-kicker">
          <Plus size={15} /> New registration
        </div>
        <h2>Add a person</h2>
        <p className="modal-copy">
          Phone and email are optional. Records without them can still be
          verified by staff.
        </p>
        <div className="add-form">
          <Field label="Full name">
            <input
              className="plain-input"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="e.g. Lakshmi R."
            />
          </Field>
          <div className="form-two-col">
            <Field label="Age">
              <input
                className="plain-input"
                value={age}
                onChange={event => setAge(event.target.value)}
                placeholder="Years"
                inputMode="numeric"
              />
            </Field>
            <Field label="Gender">
              <Select
                value="Female"
                onChange={() => {}}
                options={["Female", "Male", "Other"]}
              />
            </Field>
          </div>
          <Field label="Area">
            <input
              className="plain-input"
              value={area}
              onChange={event => setArea(event.target.value)}
              placeholder="e.g. SIT"
            />
          </Field>
          <div className="optional-fields">
            <span>
              Contact details <small>optional</small>
            </span>
            <div className="form-two-col">
              <input className="plain-input" placeholder="Mobile number" />
              <input className="plain-input" placeholder="Email address" />
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => {
              if (!name.trim()) {
                toast.error("Add the person's name first.");
                return;
              }
              onSave({
                id: null,
                name,
                dateOfBirth: "Not recorded",
                age: Number(age) || 0,
                gender: "Female",
                mobile: "Not provided",
                email: "Not provided",
                group: "—",
                location: "Tumkur",
                area,
                status: "Pending",
                consent: false,
                consentStatus: "Pending",
                availability: "Unavailable",
                donorConsent: null,
                submitted: "Just now",
                registeredAt: new Date().toISOString(),
                verifiedAt: null,
                donationCount: 0,
                donationDates: [],
                donationEligibleDates: [],
                nextEligibleAt: null,
                publicVisible: false,
                initials: name
                  .split(" ")
                  .map(part => part[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase(),
                lastDonationAt: null,
              });
            }}
          >
            Add to pending <ArrowRight size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}

function DonationDetailModal({
  record,
  onClose,
}: {
  record: AdminRecord;
  onClose: () => void;
}) {
  const hasDonationHistory = record.donationCount > 0 && record.donationDates.length > 0;
  const lastDonation = record.donationDates.at(-1);
  const statusLabel = record.availability === "Available" ? "Eligible to donate" : record.nextEligibleAt ? "Temporarily unavailable" : "Eligibility unknown";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className="admin-modal profile-modal" role="dialog" aria-modal="true">
        <div className="profile-topline">
          <button className="profile-back-button" onClick={onClose}>
            <ArrowLeft size={15} /> Back to Donations
          </button>
        </div>

        <header className="profile-header">
          <div className="profile-id-block">
            <div className="profile-id-value">{record.id || "—"}</div>
          </div>
          <div className="profile-identity">
            <div className="profile-avatar">{record.initials}<span className={`profile-avatar-status ${record.status.toLowerCase()}`}>{record.status === "Verified" ? <Check size={10} /> : <Clock3 size={10} />}</span></div>
            <div>
              <h2>{record.name}</h2>
              <div className="profile-badges">
                <span className={`profile-status ${record.status.toLowerCase()}`}>● {record.status.toUpperCase()}</span>
                {record.donorConsent === true && <span className="profile-status consented">DONOR CONSENTED</span>}
                {record.donorConsent === false && <span className="profile-status private">NOT PUBLIC</span>}
              </div>
            </div>
          </div>
          <div className="profile-blood-block">
            <div className="profile-blood-badge">{record.group}<small>Blood group</small></div>
          </div>
        </header>

        <div className="profile-detail-section profile-donation-section"><h3><Droplets size={15} /> Donation summary</h3><div className="profile-donation-summary"><div className="profile-summary-stat"><span>Total donations</span><strong>{record.donationCount}</strong></div><div className="profile-summary-stat"><span>Last donation</span><strong>{hasDonationHistory ? formatShortDate(lastDonation) : "Not yet donated"}</strong></div><div className="profile-summary-stat"><span>Next eligible</span><strong>{record.nextEligibleAt ? formatShortDate(record.nextEligibleAt) : "Eligible now"}</strong></div><div className={`profile-readiness ${record.availability === "Unavailable" ? "unavailable" : ""}`}><span>{record.availability === "Available" ? <Check size={18} /> : <Clock3 size={18} />}</span><div><strong>{statusLabel}</strong><em></em></div></div></div><div className="profile-public-status">● {record.publicVisible ? "Visible publicly" : "Not visible publicly"}</div></div>

        <div className="profile-history-section open"><div className="profile-history-heading"><h3><Droplets size={15} /> Donation history</h3></div><div className="profile-history-panel"><div className="profile-history-inner">{record.donationDates.length ? <div className="profile-history">
          <div className="profile-history-head">
            <span>Donation</span>
            <b>Donated on</b>
            <b>Eligible date</b>
            <b>Status</b>
          </div>
          {record.donationDates.map((date, index) => {
            const eligibleDate = record.donationEligibleDates[index];
            const isLast = index === record.donationDates.length - 1;
            const nextEligibleDate = eligibleDate ? new Date(eligibleDate) : null;
            const isFuture = nextEligibleDate ? nextEligibleDate > new Date() : false;
            return (
              <div key={`${date}-${index}`}>
                <span>Donation #{index + 1}</span>
                <b>{formatShortDate(date)}</b>
                <b>{eligibleDate ? formatShortDate(eligibleDate) : "—"}</b>
                <small className="profile-history-status">
                  {isLast ? (
                    isFuture ? (
                      <div className="eligible-icon eligible-icon-amber" title={`Eligible on ${formatShortDate(eligibleDate)}`}><Clock3 size={16} strokeWidth={2.4} /></div>
                    ) : (
                      <div className="eligible-icon eligible-icon-green" title="Eligible now"><BadgeCheck size={16} strokeWidth={2.4} /></div>
                    )
                  ) : (
                    <div className="eligible-icon eligible-icon-green" title="Eligible since this donation"><BadgeCheck size={16} strokeWidth={2.4} /></div>
                  )}
                </small>
              </div>
            );
          })}
        </div> : <div className="profile-history-inner"><p className="profile-empty">No blood donations have been recorded yet.</p></div>}</div></div></div>
      </section>
    </div>
  );
}
