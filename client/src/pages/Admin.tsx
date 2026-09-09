import { FormEvent, useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useStaffAuth } from "@/lib/staffAuth";
import type { StaffSession } from "@/lib/staffAuth";
import { Field, StaffLogin } from "@/components/StaffLogin";
import type { LocationStats } from "@/lib/api";
import LocationsView from "./LocationsView";
import AuditLog from "@/components/AuditLog";
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
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BadgeCheck,
  Bell,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  ClipboardList,
  Clock,
  Clock3,
  Activity,
  Database,
  Download,
  Droplets,
  Edit3,
  FileSpreadsheet,
  Heart,
  History,
  Info,
  KeyRound,
  Layout,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  MapPin,
  Menu,
  PhoneCall,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  Table,
  Trash2,
  User,
  UserRound,
  Users,
  Wifi,
  WifiOff,
  X,
  XCircle,
  Zap,
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
  locations: "Tumkur",
  staff: "Staff & Access",
  audit: "Audit Log",
  sync: "Settings",
  settings: "Settings",
};

const RECORD_TABS: { id: RecordTab; label: string }[] = [
  { id: "all", label: "All Records" },
  { id: "pending", label: "Pending" },
];

export type AdminRecord = {
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
  if (!dateOfBirth || dateOfBirth === "Not recorded") return "";
  const date = new Date(dateOfBirth);
  if (Number.isNaN(date.getTime())) return "";
  const age = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return age > 0 ? `(${age})` : "";
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

const ADMIN_RECORDS_CACHE_KEY = "hrs-admin-records-cache-v1";
const ADMIN_SETTINGS_KEY = "hrs-admin-settings-v1";

type AdminSettings = {
  defaultView: AdminView;
  recordsPerPage: number;
  timeFormat: "12h" | "24h";
  lowSupplyThresholds: Record<string, number>;
  displayName: string;
};

const DEFAULT_SETTINGS: AdminSettings = {
  defaultView: "overview",
  recordsPerPage: 30,
  timeFormat: "12h",
  lowSupplyThresholds: {},
  displayName: "",
};

function loadAdminSettings(): AdminSettings {
  try {
    const raw = localStorage.getItem(ADMIN_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}
function saveAdminSettings(s: AdminSettings) {
  try { localStorage.setItem(ADMIN_SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function parseCsv(text: string) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(row => row.trim())
    .map(parseCsvLine);
}

function parseSheetDate(value: string | undefined) {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(" ", "T");
  const withIndiaOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized)
    ? normalized
    : `${normalized}+05:30`;
  const date = new Date(withIndiaOffset);
  return Number.isNaN(date.getTime()) ? null : date;
}

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

/** Staff & Access management view — CRUD for volunteer/admin accounts. */
function StaffAccessView() {
  const { data: staffList, isLoading, refetch } = trpc.staff.list.useQuery();
  const createMutation = trpc.staff.create.useMutation({
    onSuccess: () => {
      toast.success("Volunteer account created.");
      refetch();
    },
    onError: error => {
      const msg = (error as unknown as Error).message || "Failed to create account.";
      toast.error(msg);
    },
  });
  const deleteMutation = trpc.staff.delete.useMutation({
    onSuccess: () => {
      toast.success("Account deleted.");
      refetch();
    },
    onError: error => {
      const msg = (error as unknown as Error).message || "Failed to delete account.";
      toast.error(msg);
    },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!newUsername.trim() || !newDisplayName.trim() || !newPassword.trim()) {
      toast.error("Fill in all fields.");
      return;
    }
    setCreating(true);
    try {
      await createMutation.mutateAsync({
        username: newUsername.trim(),
        displayName: newDisplayName.trim(),
        password: newPassword,
      });
      setShowCreate(false);
      setNewUsername("");
      setNewDisplayName("");
      setNewPassword("");
    } catch {
      // Mutation error handled by onError
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (id: number, displayName: string) => {
    if (!window.confirm(`Delete "${displayName}"? This cannot be undone.`)) return;
    deleteMutation.mutate({ id });
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "#636c63" }}>
        Loading staff directory...
      </div>
    );
  }

  const members = staffList ?? [];

  return (
    <AdminSection
      eyebrow="SYSTEM"
      title="Staff & Access"
      description="Manage authorized HRS staff accounts."
    >
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h2>Authorized directory</h2>
            <p>
              {members.length} staff account{members.length !== 1 ? "s" : ""}.
              Create new volunteer accounts below.
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => setShowCreate(true)}
            disabled={createMutation.isPending}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Plus size={16} /> Add Volunteer
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <form onSubmit={handleCreate} className="login-form" style={{ marginBottom: "20px", maxWidth: "400px" }}>
            <Field label="Username">
              <div className="admin-input">
                <UserRound size={17} />
                <input
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  placeholder="e.g. volunteer-john"
                  required
                  disabled={creating}
                  style={{ textTransform: "lowercase" }}
                />
              </div>
            </Field>
            <Field label="Display Name">
              <div className="admin-input">
                <UserRound size={17} />
                <input
                  value={newDisplayName}
                  onChange={e => setNewDisplayName(e.target.value)}
                  placeholder="e.g. John Doe"
                  required
                  disabled={creating}
                />
              </div>
            </Field>
            <Field label="Password">
              <div className="admin-input">
                <KeyRound size={17} />
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  required
                  disabled={creating}
                />
              </div>
            </Field>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="submit"
                className="primary-button"
                disabled={creating}
              >
                {creating ? "Creating..." : "Create Account"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowCreate(false)}
                disabled={creating}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Staff list */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {members.map(member => (
            <div
              key={member.id}
              className="recent-row"
              style={{
                padding: "12px 16px",
                borderRadius: "8px",
                background: member.role === "admin" ? "#fef3e2" : "#f8f9f8",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div className="mini-avatar">
                <UserRound size={14} />
              </div>
              <div style={{ flex: 1 }}>
                <strong>{member.displayName}</strong>
                <span>
                  {" "}
                  {member.username} · {member.role === "admin" ? "Administrator" : "Volunteer"}{" "}
                  ·{" "}
                  {member.role === "admin"
                    ? "Full workspace access"
                    : "Can view and contact donors"}
                </span>
              </div>
              <small style={{ color: member.active ? "#4c7652" : "#c92a37" }}>
                {member.active ? "Active" : "Inactive"}
              </small>
              {member.role === "volunteer" && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => handleDelete(member.id, member.displayName)}
                  disabled={deleteMutation.isPending}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "12px",
                    padding: "4px 10px",
                  }}
                >
                  <Trash2 size={12} /> Remove
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </AdminSection>
  );
}

export default function Admin() {
  const { staff, isLoading: staffLoading, logout } = useStaffAuth();
  const [, navigate] = useLocation() as [string, (to: string) => void];
  // The session cookie is httpOnly — document.cookie cannot see it. The
  // server's staff.me query is the ONLY source of truth for auth state.
  const loggedIn = !!staff && staff.active;
  const isVolunteer = staff?.role === "volunteer";

  const [activeView, setActiveView] = useState<AdminView>(isVolunteer ? "statistics" : loadAdminSettings().defaultView);
  const [recordTab, setRecordTab] = useState<RecordTab>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterGroup, setFilterGroup] = useState("All");
  const [filterLocation, setFilterLocation] = useState("All");
  const [filterArea, setFilterArea] = useState("All");
  const [filterGender, setFilterGender] = useState("All");
  const [filterDonorConsent, setFilterDonorConsent] = useState("All");
  const [filterAvailability, setFilterAvailability] = useState("All");
  const [records, setRecords] = useState<AdminRecord[]>([]);
  // Flag to track if we've loaded initial data from the server.
  // Once set, the profilesQuery.data → records sync will stop overwriting
  // optimistic updates (the SSE still triggers refetches for background sync).
  const hasLoadedInitialRecords = useRef(false);
  const [addedPeriod, setAddedPeriod] = useState<"today" | "week" | "month">("week");
  const [addedPeriodOpen, setAddedPeriodOpen] = useState(false);
  const addedPeriodMenuRef = useRef<HTMLDivElement>(null);
  const [selectedDonation, setSelectedDonation] = useState<AdminRecord | null>(null);
  const [donationDetailOpen, setDonationDetailOpen] = useState(false);
  const [donationPage, setDonationPage] = useState(1);
  const [recordingDonation, setRecordingDonation] = useState<AdminRecord | null>(null);
  const [donationDateTime, setDonationDateTime] = useState("");

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

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      if (profileMenuRef.current?.contains(event.target as Node)) return;
      if (topProfileMenuRef.current?.contains(event.target as Node)) return;
      setProfileMenuOpen(false);
      setTopProfileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
        setTopProfileMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminRecord | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<ModalOrigin | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [topProfileMenuOpen, setTopProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const topProfileMenuRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [indiaTime, setIndiaTime] = useState("");
  const [indiaDate, setIndiaDate] = useState("");
  const [greeting, setGreeting] = useState("Good morning");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [adminSettings, setAdminSettings] = useState<AdminSettings>(loadAdminSettings());
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const openRecord = (record: AdminRecord, origin?: ModalOrigin) => {
    // Volunteers may view the profile; edit/save actions are hidden inside the modal.
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
    // Always keep localStorage displayName in sync with the server-provided
    // staff name (from Google Sheets Name column).  This ensures stale values
    // (e.g. a username accidentally stored here) are corrected, and the name
    // from the sheet is always the source of truth.
    if (staff?.displayName && staff.displayName !== adminSettings.displayName) {
      setAdminSettings(prev => {
        const next = { ...prev, displayName: staff.displayName };
        saveAdminSettings(next);
        return next;
      });
    }
  }, [staff?.displayName]);

  useEffect(() => {
    // If staff session expires (not logged in), redirect to public page
    if (!loggedIn && staffLoading === false) {
      // No-op: redirect handled by component logic
    }
  }, [loggedIn, staffLoading]);

  const handleLogout = async () => {
    setProfileMenuOpen(false);
    setTopProfileMenuOpen(false);
    try {
      await logout();
    } catch {}
    try {
      sessionStorage.removeItem("manus-cookie");
    } catch {}
    toast.success("Signed out securely.");
  };

  useEffect(() => {
    // Reset delete selection when the records list changes
    setSelectedForDelete(new Set());
  }, [records]);

  useEffect(() => {
    const updateIndiaTime = () => {
      const now = new Date();
      const time = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: adminSettings.timeFormat === "12h",
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
      setIndiaDate(date);
      setGreeting(greeting);
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

  // Fetch profiles — server keeps its memory cache fresh via a background poll.
  // Client subscribes to SSE so it refetches instantly the moment the cache updates
  // (same as clicking the Sync button, but automatic and silent). The 15s
  // refetchInterval is the fallback for serverless (Vercel), where SSE only
  // broadcasts to clients connected to the same function instance.
  const profilesQuery = trpc.hrs.profiles.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    refetchInterval: 15_000,
    retry: 2,
  });

  // Tumkur locations — auto-detects new areas from Google Sheets
  const locationsQuery = trpc.hrs.locations.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    refetchInterval: 15_000,
    retry: 2,
  });

  const lok = locationsQuery.data?.data;
  const locationStats = lok?.locations ?? [];
  const totalAreas = lok?.totalAreas ?? 0;
  const totalDonors = lok?.totalDonors ?? 0;
  const totalAvailable = lok?.totalAvailable ?? 0;
  const newThisSync = lok?.newThisSync ?? [];
  const outsideTumkur = lok?.outsideTumkur ?? 0;

  // Subscribe to /api/sync-events — server pushes a notification on every cache update
  useEffect(() => {
    if (!loggedIn) return;
    const es = new EventSource("/api/sync-events");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "cache-update") {
          profilesQuery.refetch();
          locationsQuery.refetch();
        }
      } catch {
        /* heartbeat, ignore */
      }
    };
    return () => es.close();
  }, [loggedIn, profilesQuery, locationsQuery]);

  // Helper: apply a verified record transformation optimistically
  function applyVerifiedRecord(
    rec: AdminRecord,
    hrsId: string,
    group: string,
    donationConsent: boolean
  ): AdminRecord {
    const now = new Date().toISOString();
    const isDonor = donationConsent;
    const nextEligibleAt = isDonor
      ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    return {
      ...rec,
      id: hrsId,
      status: "Verified",
      group,
      donorConsent: donationConsent,
      consent: true,
      consentStatus: "Yes",
      verifiedAt: now,
      availability: isDonor ? "Available" : "Unavailable",
      nextEligibleAt,
      publicVisible: isDonor && group !== "—",
    };
  }

  // Helper: apply a donation record transformation optimistically
  function applyDonation(
    rec: AdminRecord,
    donationTime: string
  ): AdminRecord {
    const parsedTime = donationTime.includes("T") ? donationTime : `${donationTime.replace(" ", "T")}+05:30`;
    const donationDate = new Date(parsedTime).toISOString();
    const nextEligibleAt = new Date(Date.parse(parsedTime) + 90 * 24 * 60 * 60 * 1000).toISOString();
    const newDonationDates = [...rec.donationDates, donationDate];
    return {
      ...rec,
      donationCount: rec.donationCount + 1,
      donationDates: newDonationDates,
      lastDonationAt: donationDate,
      nextEligibleAt,
      availability: "Unavailable",
      publicVisible: true,
    };
  }

  // Refs to capture mutation-specific context at call-time (avoids closure staleness)
  const pendingVerificationRef = useRef<{ rec: AdminRecord; hrsId: string; group: string; donationConsent: boolean } | null>(null);
  const pendingDonationRef = useRef<{ recordId: string; donationTime: string } | null>(null);
  const pendingUpdateRef = useRef<{ updatedRecord: AdminRecord; originalId: string } | null>(null);
  // Stores records snapshot before an optimistic update — used for rollback on server failure.
  const previousRecordsRef = useRef<AdminRecord[] | null>(null);

  const verifyMutation = trpc.hrs.verifyProfile.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        // Optimistic update was already applied in the click handler.
        previousRecordsRef.current = null;
        pendingVerificationRef.current = null;
      } else {
        // Server returned an error result — roll back optimistic update.
        if (previousRecordsRef.current) {
          setRecords(previousRecordsRef.current);
          previousRecordsRef.current = null;
        }
        pendingVerificationRef.current = null;
        toast.error(result.error || "Failed to verify profile");
      }
    },
    onError: () => {
      // Roll back optimistic update on network/failure
      if (previousRecordsRef.current) {
        setRecords(previousRecordsRef.current);
        previousRecordsRef.current = null;
      }
      pendingVerificationRef.current = null;
      toast.error(`Verification failed`);
    },
  });

  const recordDonationMutation = trpc.hrs.recordDonation.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        // Optimistic update was already applied in the click handler.
        previousRecordsRef.current = null;
        pendingDonationRef.current = null;
      } else {
        // Server returned an error result — roll back optimistic update.
        if (previousRecordsRef.current) {
          setRecords(previousRecordsRef.current);
          previousRecordsRef.current = null;
        }
        pendingDonationRef.current = null;
        toast.error(result.error || "Failed to record donation");
      }
    },
    onError: () => {
      // Roll back optimistic update on network/failure
      if (previousRecordsRef.current) {
        setRecords(previousRecordsRef.current);
        previousRecordsRef.current = null;
      }
      pendingDonationRef.current = null;
      toast.error(`Recording failed`);
    },
  });

  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [syncIntervalMs, setSyncIntervalMs] = useState(10000);

  const syncProfilesMutation = trpc.hrs.syncProfiles.useMutation({
    onSuccess: () => {
      setLastSyncedAt(new Date());
      // Force-refetch so the latest data flows into records/locations/stats
      profilesQuery.refetch();
    },
    onError: (error) => {
      // syncProfiles is only ever invoked by the manual "Sync Now" button
      // (auto-sync lives server-side), so every failure is worth surfacing.
      toast.error(`Sync failed: ${error.message}`);
    },
  });

  // Use a ref to hold a stable sync trigger so the manual Sync button doesn't
  // recreate the tRPC mutation object on every render.
  const triggerSyncRef = useRef<(manual: boolean) => void>(() => {});
  triggerSyncRef.current = (manual: boolean) => {
    if (syncProfilesMutation.isPending) return;
    syncProfilesMutation.mutate();
  };
  const triggerSync = useCallback(
    (manual: boolean) => triggerSyncRef.current(manual),
    []
  );

  // Hard auto-sync timer: call mutation directly every interval
  useEffect(() => {
    const timer = window.setInterval(() => {
      triggerSync(true);
    }, syncIntervalMs);
    return () => window.clearInterval(timer);
  }, [syncIntervalMs, triggerSync]);

  // Auto-sync is now driven by the SERVER-side poller (googleSheetsApi.ts),
  // controlled from the Settings panel via trpc.hrs.setAutoSync. The server
  // polls Google Sheets on its own interval and pushes `/api/sync-events`
  // SSE notifications on every cache update, so the client here refetches
  // profiles/locations automatically (see the sync-events subscription above).
  // No client-side timer is needed — a second timer would double-poll the CSV
  // and corrupt the sync counters shown in the panel.

  const updateProfileMutation = trpc.hrs.updateProfile.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        // Optimistic update was already applied in the click handler.
        previousRecordsRef.current = null;
        pendingUpdateRef.current = null;
      } else {
        // Server returned an error result — roll back optimistic update.
        if (previousRecordsRef.current) {
          setRecords(previousRecordsRef.current);
          previousRecordsRef.current = null;
        }
        pendingUpdateRef.current = null;
        toast.error(result.error || "Failed to update profile");
      }
    },
    onError: () => {
      // Roll back optimistic update on failure
      if (previousRecordsRef.current) {
        setRecords(previousRecordsRef.current);
        previousRecordsRef.current = null;
      }
      pendingUpdateRef.current = null;
      toast.error(`Update failed`);
    },
  });

  const deleteProfilesMutation = trpc.hrs.deleteProfiles.useMutation({
    onSuccess: (result) => {
      if (result.success && result.data) {
        toast.success(`${result.data.deleted} record${result.data.deleted === 1 ? "" : "s"} deleted.`);
        setSelectedForDelete(new Set());
        setDeleteMode(false);
        profilesQuery.refetch();
        setLastSyncedAt(new Date());
      } else {
        toast.error(result.error || "Failed to delete records");
      }
    },
    onError: (error) => {
      toast.error(`Delete failed: ${error.message}`);
    },
  });

  const sendVerificationEmailMutation = trpc.hrs.sendVerificationEmail.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        if ((result as { skipped?: boolean }).skipped) {
          // No email on file — silent, don't bother the admin
        } else {
          toast.success("Verification email sent!");
        }
      }
    },
    onError: (error) => {
      // Email failure is non-blocking — profile was saved, just email failed
      console.warn("Email send failed:", error.message);
    },
  });

  // The server pre-converts profiles to AdminRecord shape.
  // Only sync on the initial load — after that, mutations apply optimistic
  // updates to local state. The SSE poll will eventually refresh `records`
  // when the Google Sheets CSV reflects the change.
  useEffect(() => {
    if (profilesQuery.data?.success && profilesQuery.data.data?.records) {
      if (!hasLoadedInitialRecords.current) {
        setRecords(profilesQuery.data.data.records);
        hasLoadedInitialRecords.current = true;
      }
      setLastSyncedAt(new Date());
    } else if (profilesQuery.isError) {
      console.error("Failed to fetch from API:", profilesQuery.error);
    }
  }, [profilesQuery.data, profilesQuery.isError]);

  // Sync trigger effect
  useEffect(() => {
    setIsSyncing(
      profilesQuery.isFetching ||
        profilesQuery.isLoading ||
        syncProfilesMutation.isPending
    );
  }, [
    profilesQuery.isFetching,
    profilesQuery.isLoading,
    syncProfilesMutation.isPending,
  ]);

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
  // Compute these once at the top level so they're available to JSX below
  // (the original definitions live inside the Statistics sub-component block).
  const bloodGroupsTop = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
  const isVerifiedTop = (record: AdminRecord) =>
    record.status === "Verified";
  const verifiedTop = records.filter(isVerifiedTop);
  const voluntaryDonorsTop = verifiedTop.filter(
    record => record.donorConsent === true
  );
  const availableDonorsTop = voluntaryDonorsTop.filter(
    record => record.availability === "Available"
  );
  const onUpdateAdminSettings = useCallback((patch: Partial<AdminSettings>) => {
    setAdminSettings(prev => {
      const next = { ...prev, ...patch };
      saveAdminSettings(next);
      return next;
    });
  }, []);

  const goToView = (view: AdminView, tab: RecordTab = "all") => {
    if (isVolunteer && !["statistics", "records", "donations", "locations"].includes(view)) {
      return; // volunteers can only view statistics, records, donations, and locations
    }
    setActiveView(view);
    setMobileNav(false);
    if (view === "records") setRecordTab(tab);
  };
  const totalPages = Math.ceil(currentViewRecords.length / adminSettings.recordsPerPage);
  const paginatedRecords = currentViewRecords.slice(
    (currentPage - 1) * adminSettings.recordsPerPage,
    currentPage * adminSettings.recordsPerPage
  );

  const saveRecord = (
    record: AdminRecord,
    group: string,
    donationConsent: boolean | null,
    onSuccess?: (id: string) => void,
    onError?: () => void
  ) => {
    if (!group || group === "—") {
      toast.error("Enter a blood group before saving.");
      onError?.();
      return;
    }
    if (donationConsent === null) {
      toast.error("Record blood donation consent as Yes or No before verifying.");
      onError?.();
      return;
    }
    const isPending = record.status === "Pending";
    const hrsId = record.id ?? "PENDING";

    // For pending records: require HRS ID (should be assigned by the spreadsheet batch job)
    if (isPending && !record.id) {
      toast.error("This record has no HRS ID. Please run the ID assignment first.");
      onError?.();
      return;
    }

    // Save snapshot for potential rollback on server failure
    previousRecordsRef.current = records;

    if (isPending) {
      // First-time verification: apply optimistic update immediately, then fire mutation.
      const updated = applyVerifiedRecord(record, hrsId, group, donationConsent);
      setRecords(current =>
        current.map(rec => (rec.id === record.id ? updated : rec))
      );
      // Update selected separately (outside the setRecords updater to avoid stale closure).
      setSelected(updated);
      toast.success("Profile verified successfully!");

      // Capture for onSuccess cleanup (no-op here since we already updated)
      pendingVerificationRef.current = null;
      // Fire mutation in background — UI already updated.
      verifyMutation.mutate({
        hrsId,
        bloodGroup: group,
        donorConsent: donationConsent ? "YES" : "NO",
      });
      // Send verification email (non-blocking — fails silently if no email on file)
      sendVerificationEmailMutation.mutate({ hrsId });
      onSuccess?.(hrsId);
    } else {
      // Editing an existing record: apply optimistic update immediately, then fire mutation.
      const updatedRecord: AdminRecord = {
        ...record,
        name: record.name,
        dateOfBirth: record.dateOfBirth,
        gender: record.gender,
        mobile: record.mobile,
        email: record.email,
        group: group,
        location: record.location,
        area: record.area,
        donorConsent: donationConsent,
        consent: donationConsent === true,
        consentStatus: donationConsent === true ? "Yes" : "No",
        availability: donationConsent ? "Available" : "Unavailable",
        publicVisible: donationConsent === true && group !== "—",
      };
      pendingUpdateRef.current = { updatedRecord, originalId: hrsId };
      setRecords(current =>
        current.map(rec =>
          rec.id === hrsId ? updatedRecord : rec
        )
      );
      setSelected(prev => prev?.id === hrsId ? updatedRecord : prev);
      toast.success("Profile updated!");

      // Fire mutation in background — UI already updated.
      updateProfileMutation.mutate({
        hrsId,
        name: record.name,
        dob: record.dateOfBirth,
        gender: record.gender,
        mobile: record.mobile,
        email: record.email,
        city: record.location,
        area: record.area,
        bloodGroup: group,
        donorConsent: donationConsent ? "YES" : "NO",
      });
      onSuccess?.(hrsId);
    }
  };

  return !loggedIn ? <StaffLogin /> : (
    <div className="admin-shell">
      {mobileNav && (
        <div className="sidebar-backdrop" onClick={() => setMobileNav(false)} />
      )}
      <aside className={`admin-sidebar ${mobileNav ? "open" : ""}`}>
        <div className="admin-sidebar-head">
          <a className="brand" href="/">
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
          {!isVolunteer && (
            <>
              <span className="admin-nav-label">OVERVIEW</span>
              <button
                className={activeView === "overview" ? "active" : ""}
                onClick={() => goToView("overview")}
              >
                <LayoutDashboard size={17} /> Dashboard
              </button>
            </>
          )}
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
          <button
            className={activeView === "locations" ? "active" : ""}
            onClick={() => goToView("locations")}
          >
            <MapPin size={17} /> Tumkur Zones
          </button>
          {!isVolunteer && (
            <>
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
                <FileSpreadsheet size={17} /> Settings
              </button>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="staff-profile-wrap" ref={profileMenuRef}>
            <button
              className={`staff-profile${profileMenuOpen ? " open" : ""}`}
              onClick={() => setProfileMenuOpen(open => !open)}
              aria-label="Account menu"
              aria-expanded={profileMenuOpen}
            >
              <div className="staff-avatar">
                <UserRound size={16} />
              </div>
              <span className="staff-info">
                <strong>{adminSettings.displayName || staff?.displayName || "Admin"}</strong>
                <span>{staff?.role === "admin" ? "Administrator" : "Volunteer"}</span>
              </span>
              <ChevronDown size={16} className="staff-profile-chevron" />
            </button>
            <div className={`profile-menu sidebar-profile-menu${profileMenuOpen ? " open" : ""}`}>
              <div className="profile-menu-head">
                <div className="staff-avatar">
                  <UserRound size={16} />
                </div>
                <span className="staff-info">
                  <strong>{adminSettings.displayName || staff?.displayName || "Admin"}</strong>
                  <span>{staff?.role === "admin" ? "Administrator" : "Volunteer"}</span>
                </span>
              </div>
              <button className="profile-menu-item danger" onClick={handleLogout}>
                <LogOut size={16} /> Logout
              </button>
            </div>
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
              <span className="top-sync-time">{indiaTime}</span>
              <span className="top-sync-date">{indiaDate}</span>
            </span>
            <div className="staff-top-wrap" ref={topProfileMenuRef}>
              <button
                className={`staff-top${topProfileMenuOpen ? " open" : ""}`}
                onClick={() => setTopProfileMenuOpen(open => !open)}
                aria-label="Account menu"
                aria-expanded={topProfileMenuOpen}
              >
                <div className="staff-avatar small">
                  <UserRound size={14} />
                </div>
                <span>{isVolunteer ? "Volunteer" : "Admin"}</span>
                <ChevronDown size={15} />
              </button>
              <div className={`profile-menu top-profile-menu${topProfileMenuOpen ? " open" : ""}`}>
                <div className="profile-menu-head">
                  <div className="staff-avatar small">
                    <UserRound size={14} />
                  </div>
                  <span className="staff-info">
                    <strong>{adminSettings.displayName || staff?.displayName || "Admin"}</strong>
                    <span>{staff?.role === "admin" ? "Administrator" : "Volunteer"}</span>
                  </span>
                </div>
                <button className="profile-menu-item danger" onClick={handleLogout}>
                  <LogOut size={16} /> Logout
                </button>
              </div>
            </div>
          </div>
        </header>
        <main className={`admin-content ${activeView === "statistics" ? "statistics-content" : ""}`}>
          {activeView === "statistics" ? (
            <Statistics records={records} />
          ) : activeView === "overview" ? (
            <>
              <div className="admin-page-heading">
                <div>
                  <span className="eyebrow dark-eyebrow" id="overview-date">{indiaDate}</span>
                  <h1>{greeting}, {adminSettings.displayName || staff?.displayName || "Admin"}.</h1>
                  <p>Here’s what needs your attention today.</p>
                </div>
                {!isVolunteer && (
                  <button
                    className="record-sync-button dashboard-sync-button"
                    type="button"
                    onClick={() => triggerSync(true)}
                    disabled={isSyncing}
                    title="Sync records from Google Sheets"
                  >
                    <RefreshCw size={14} className={isSyncing ? "syncing-icon" : ""} />
                    {isSyncing ? "Syncing..." : "Sync"}
                  </button>
                )}
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
                  <p>{isVolunteer ? "Search and view every HRS donor record." : "Search, edit, and manage every HRS donor record."}</p>
                </div>
                {!isVolunteer && (
                  <button
                    className="primary-button"
                    onClick={() => setAddOpen(true)}
                  >
                    <Plus size={17} /> Add Person
                  </button>
                )}
              </div>
              <div className="record-tabs">
                {RECORD_TABS.map(tab => (
                  <button
                    key={tab.id}
                    className={`record-tab${recordTab === tab.id ? " active" : ""}`}
                    onClick={() => setRecordTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
                {!isVolunteer && (
                  <>
                    <button
                      className="record-sync-button"
                      type="button"
                      onClick={() => triggerSync(true)}
                      disabled={isSyncing}
                      title="Sync records from Google Sheets"
                    >
                      <RefreshCw size={14} className={isSyncing ? "syncing-icon" : ""} />
                      {isSyncing ? "Syncing..." : "Sync"}
                    </button>
                    <button
                      className={`record-delete-toggle${deleteMode ? " active" : ""}`}
                      type="button"
                      onClick={() => {
                        setDeleteMode(value => !value);
                        setSelectedForDelete(new Set());
                      }}
                      title={deleteMode ? "Exit delete mode" : "Select records to delete"}
                    >
                      <Trash2 size={14} />
                      {deleteMode ? "Cancel" : "Delete"}
                    </button>
                  </>
                )}
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
                  {deleteMode && (
                    <span>
                      <input
                        type="checkbox"
                        checked={selectedForDelete.size === paginatedRecords.length && paginatedRecords.length > 0}
                        onChange={() => {
                          if (selectedForDelete.size === paginatedRecords.length) {
                            setSelectedForDelete(new Set());
                          } else {
                            setSelectedForDelete(new Set(paginatedRecords.map(r => r.id ?? r.name)));
                          }
                        }}
                        title="Select all on this page"
                      />
                    </span>
                  )}
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
                    deleteMode={deleteMode}
                    selectedForDelete={selectedForDelete}
                    onToggleDelete={(id) => {
                      setSelectedForDelete(prev => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                    }}
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
                  <div className="records-pagination">
                    <button
                      className="secondary-button"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <span className="records-pagination-info">
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
              {deleteMode && selectedForDelete.size > 0 && (
                <div className="delete-selection-bar">
                  <div className="delete-selection-info">
                    <Trash2 size={16} />
                    <span>
                      <strong>{selectedForDelete.size}</strong> record{selectedForDelete.size === 1 ? "" : "s"} selected
                    </span>
                  </div>
                  <div className="delete-selection-actions">
                    <button
                      className="secondary-button"
                      onClick={() => setSelectedForDelete(new Set())}
                    >
                      Clear
                    </button>
                    <button
                      className="primary-button danger-button"
                      onClick={() => setConfirmDeleteOpen(true)}
                      disabled={deleteProfilesMutation.isPending}
                    >
                      <Trash2 size={15} />
                      {deleteProfilesMutation.isPending
                        ? "Deleting..."
                        : `Delete ${selectedForDelete.size} record${selectedForDelete.size === 1 ? "" : "s"}`}
                    </button>
                  </div>
                </div>
              )}
              {confirmDeleteOpen && (
                <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setConfirmDeleteOpen(false)}>
                  <div className="modal-card confirm-delete-modal">
                    <div className="modal-card-header">
                      <h2>Delete {selectedForDelete.size} record{selectedForDelete.size === 1 ? "" : "s"}?</h2>
                      <button className="modal-close" onClick={() => setConfirmDeleteOpen(false)}><X size={18} /></button>
                    </div>
                    <div className="modal-card-body">
                      <p>
                        This will permanently remove {selectedForDelete.size} record{selectedForDelete.size === 1 ? "" : "s"} from the HRS Google Sheet. This action cannot be undone.
                      </p>
                      <div className="confirm-delete-list">
                        {Array.from(selectedForDelete).slice(0, 5).map(id => {
                          const r = records.find(rec => (rec.id ?? rec.name) === id);
                          return r ? (
                            <div key={id} className="confirm-delete-item">
                              <div className="mini-avatar small">{r.initials}</div>
                              <div>
                                <strong>{r.name}</strong>
                                <span>{r.id} · {r.location}</span>
                              </div>
                            </div>
                          ) : null;
                        })}
                        {selectedForDelete.size > 5 && (
                          <div className="confirm-delete-more">+ {selectedForDelete.size - 5} more</div>
                        )}
                      </div>
                    </div>
                    <div className="modal-card-footer">
                      <button className="secondary-button" onClick={() => setConfirmDeleteOpen(false)}>Cancel</button>
                      <button
                        className="primary-button danger-button"
                        onClick={() => {
                          const ids = Array.from(selectedForDelete);
                          deleteProfilesMutation.mutate({ hrsIds: ids });
                          setConfirmDeleteOpen(false);
                        }}
                        disabled={deleteProfilesMutation.isPending}
                      >
                        {deleteProfilesMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        {deleteProfilesMutation.isPending ? "Deleting..." : "Delete permanently"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <WorkspaceView
              view={activeView}
              records={records}
              donors={donors}
              pending={pending}
              locationRows={locationRows}
              lastSyncedAt={lastSyncedAt}
              bloodGroups={bloodGroupsTop}
              availableDonors={availableDonorsTop}
              locationStats={locationStats}
              totalAreas={totalAreas}
              totalDonors={totalDonors}
              totalAvailable={totalAvailable}
              newThisSync={newThisSync}
              outsideTumkur={outsideTumkur}
              isSyncing={isSyncing}
              onSync={() => triggerSync(true)}
              autoSyncEnabled={autoSyncEnabled}
              setAutoSyncEnabled={setAutoSyncEnabled}
              syncIntervalMs={syncIntervalMs}
              setSyncIntervalMs={setSyncIntervalMs}
              adminSettings={adminSettings}
              onUpdateAdminSettings={onUpdateAdminSettings}
              staff={staff}
              loggedIn={loggedIn}
              handleLogout={handleLogout}
              isVolunteer={isVolunteer}
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
          isVolunteer={isVolunteer}
        />
      )}
      {addOpen && !isVolunteer && (
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
      {donationDetailOpen && selectedDonation && (
        <DonationDetailModal
          record={selectedDonation}
          onClose={() => { setDonationDetailOpen(false); setSelectedDonation(null); }}
          setRecordingDonation={setRecordingDonation}
          setDonationDateTime={setDonationDateTime}
          isVolunteer={isVolunteer}
        />
      )}
      {recordingDonation && !isVolunteer && (
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
                  <span>Donation Date &amp; Time</span>
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
                onClick={() => {
                  if (!recordingDonation.id || !donationDateTime) return;
                  const donationTimeISO = new Date(donationDateTime).toISOString();
                  const recordId = recordingDonation.id;
                  // Apply optimistic update immediately, then close the modal.
                  previousRecordsRef.current = records;
                  setRecords(current =>
                    current.map(rec =>
                      rec.id === recordId ? applyDonation(rec, donationTimeISO) : rec
                    )
                  );
                  setSelected(prev =>
                    prev?.id === recordId ? applyDonation(prev, donationTimeISO) : prev
                  );
                  setRecordingDonation(null);
                  toast.success("Donation recorded!");

                  // Fire mutation in background — UI already updated.
                  recordDonationMutation.mutate({
                    hrsId: recordId,
                    donationTime: donationTimeISO,
                  });
                }}
              >
                {recordDonationMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Recording...</> : "Record Donation"}
              </button>
            </div>
          </div>
        </div>
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
  bloodGroups,
  availableDonors,
  locationStats,
  totalAreas,
  totalDonors,
  totalAvailable,
  newThisSync,
  outsideTumkur,
  isSyncing,
  onSync,
  autoSyncEnabled,
  setAutoSyncEnabled,
  syncIntervalMs,
  setSyncIntervalMs,
  adminSettings,
  onUpdateAdminSettings,
  staff,
  loggedIn,
  handleLogout,
  isVolunteer,
}: {
  view: AdminView;
  records: AdminRecord[];
  donors: AdminRecord[];
  pending: AdminRecord[];
  locationRows: { location: string; areas: string[]; count: number }[];
  lastSyncedAt: Date | null;
  bloodGroups: string[];
  availableDonors: AdminRecord[];
  locationStats: LocationStats[];
  totalAreas: number;
  totalDonors: number;
  totalAvailable: number;
  newThisSync: LocationStats[];
  outsideTumkur: number;
  isSyncing: boolean;
  onSync: () => void;
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (v: boolean) => void;
  syncIntervalMs: number;
  setSyncIntervalMs: (v: number) => void;
  adminSettings: AdminSettings;
  onUpdateAdminSettings: (patch: Partial<AdminSettings>) => void;
  staff: StaffSession | null;
  loggedIn: boolean;
  handleLogout: () => void;
  isVolunteer: boolean;
}) {
  // ── Donation pagination ────────────────────────────────────────
  const [donationPage, setDonationPage] = useState(1);

  // ── Settings hooks ──────────────────────────────────────────────
  const syncStatusQuery = trpc.hrs.syncStatus.useQuery(undefined, {
    refetchInterval: 6000,
    enabled: view === "sync" || view === "settings",
  });
  const syncDiagMutation = trpc.hrs.syncDiagnostics.useMutation();

  // Mutation that actually controls the server-side poller.
  const setAutoSyncMutation = trpc.hrs.setAutoSync.useMutation();
  const prevAutoSyncEnabledRef = useRef(autoSyncEnabled);
  const prevSyncIntervalRef = useRef(syncIntervalMs);

  // Push toggle changes to the server poller.
  useEffect(() => {
    if (prevAutoSyncEnabledRef.current !== autoSyncEnabled) {
      prevAutoSyncEnabledRef.current = autoSyncEnabled;
      setAutoSyncMutation.mutate({ enabled: autoSyncEnabled });
    }
  }, [autoSyncEnabled]);

  // Push interval changes to the server poller.
  useEffect(() => {
    if (prevSyncIntervalRef.current !== syncIntervalMs) {
      prevSyncIntervalRef.current = syncIntervalMs;
      setAutoSyncMutation.mutate({ enabled: autoSyncEnabled, intervalMs: syncIntervalMs });
    }
  }, [syncIntervalMs]);

  // Reconcile the local controls with the server poller's ACTUAL state once,
  // the first time syncStatus arrives (e.g. after a page reload the poller may
  // be paused or running at a different interval than the UI defaults). We
  // update the prev refs first so the effects above don't echo the change back.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    const st = syncStatusQuery.data;
    if (!st) return;
    reconciledRef.current = true;
    if (st.running !== autoSyncEnabled) {
      prevAutoSyncEnabledRef.current = st.running;
      setAutoSyncEnabled(st.running);
    }
    if (st.currentIntervalMs != null && st.currentIntervalMs !== syncIntervalMs) {
      prevSyncIntervalRef.current = st.currentIntervalMs;
      setSyncIntervalMs(st.currentIntervalMs);
    }
  }, [syncStatusQuery.data]);

  const exportCsvQuery = trpc.hrs.exportCsv.useQuery(undefined, {
    enabled: false, // only fetch on explicit click
  });
  const csvDownloadedRef = useRef(false);

  const triggerExportCsv = useCallback(() => {
    csvDownloadedRef.current = false;
    exportCsvQuery.refetch();
  }, [exportCsvQuery]);

  useEffect(() => {
    if (!csvDownloadedRef.current && exportCsvQuery.data && "filename" in exportCsvQuery.data && exportCsvQuery.data.filename) {
      csvDownloadedRef.current = true;
      // Server returns base64-encoded XLSX bytes.
      const binaryStr = atob(exportCsvQuery.data.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportCsvQuery.data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [exportCsvQuery.data]);

  if (view === "donations") {
    const DONATIONS_PER_PAGE = 30;
    const donationTotalPages = Math.ceil(donors.length / DONATIONS_PER_PAGE);
    const donationStart = (donationPage - 1) * DONATIONS_PER_PAGE;
    const paginatedDonors = donors.slice(
      donationStart,
      donationStart + DONATIONS_PER_PAGE,
    );
    return (
      <AdminSection
        eyebrow="DIRECTORY"
        title="Donations"
        description="Verified donor availability across the HRS network."
      >
        <section className="admin-card records-table-card">
          <div className="records-table-head">
            <span>Donor</span>
            <span>Blood group</span>
            <span>Location</span>
            <span>Status</span>
            <span>Recorded</span>
          </div>
          {paginatedDonors.map(record => (
            <div
              className="records-table-row records-table-row-clickable"
              key={record.name}
              role="button"
              tabIndex={0}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("openDonationDetail", { detail: record }),
                )
              }
              onKeyDown={(event: React.KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  window.dispatchEvent(
                    new CustomEvent("openDonationDetail", { detail: record }),
                  );
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
              <span
                className={`table-status ${
                  record.availability === "Available" ? "verified" : "pending"
                }`}
              >
                <span className="status-dot" /> {record.availability}
              </span>
              <span className="table-date">{record.submitted}</span>
            </div>
          ))}
          {donors.length === 0 && (
            <div className="admin-empty">
              <Heart size={23} />
              <h3>No donations listed</h3>
              <p>Verified donors will appear here.</p>
            </div>
          )}
        </section>
        {donors.length > DONATIONS_PER_PAGE && (
          <div className="donations-pagination">
            <span className="donations-pagination-info">
              Showing {donationStart + 1}–
              {Math.min(donationStart + DONATIONS_PER_PAGE, donors.length)} of{" "}
              {donors.length} donors
            </span>
            <div className="donations-pagination-controls">
              <button
                className="secondary-button"
                disabled={donationPage <= 1}
                onClick={() => setDonationPage(p => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <span className="donations-pagination-page">
                Page {donationPage} of {donationTotalPages}
              </span>
              <button
                className="secondary-button"
                disabled={donationPage >= donationTotalPages}
                onClick={() =>
                  setDonationPage(p => Math.min(donationTotalPages, p + 1))
                }
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </AdminSection>
    );
  }

  if (view === "locations") {
    return (
      <AdminSection
        eyebrow="NETWORK INTELLIGENCE"
        title="Tumkur Zones"
        description="Every area across Tumkur, auto-registered the moment it appears in the donor sheet."
        action={
          !isVolunteer ? (
            <button
              className="record-sync-button"
              type="button"
              onClick={onSync}
              disabled={isSyncing}
              title="Sync records from Google Sheets"
            >
              <RefreshCw size={14} className={isSyncing ? "syncing-icon" : ""} />
              {isSyncing ? "Syncing..." : "Sync"}
            </button>
          ) : undefined
        }
      >
        <LocationsView
          locations={locationStats}
          totalAreas={totalAreas}
          totalDonors={totalDonors}
          totalAvailable={totalAvailable}
          newThisSync={newThisSync}
          outsideTumkur={outsideTumkur}
          records={records}
          donors={donors}
          availableDonors={availableDonors}
          pending={pending}
          lastSyncedAt={lastSyncedAt}
          bloodGroups={bloodGroups}
          isSyncing={isSyncing}
          onSync={onSync}
        />
      </AdminSection>
    );
  }

  if (view === "staff") {
    // Real staff CRUD view using tRPC staff router
    return <StaffAccessView />;
  }

  if (view === "audit") {
    return (
      <AdminSection
        eyebrow="SYSTEM"
        title="Audit Log"
        description="Every action performed in the admin panel, recorded with actor, timestamp, and outcome."
      >
        <AuditLog />
      </AdminSection>
    );
  }

  if (view === "sync") {
    const sync = syncStatusQuery.data;
    const diag = syncDiagMutation.data;
    const syncOk = sync?.lastStatus === "ok";
    const writeOk = diag?.write?.ok;
    const writeTested = diag?.write != null;
    const readTested = diag?.read != null;
    // A poll landed within the last ~7.5s → pulse the status dot.
    const justSynced =
      sync?.lastAttemptAt != null && Date.now() - sync.lastAttemptAt < 7500;

    const intervalOptions = [
      { label: "5s", value: 5000 },
      { label: "10s", value: 10000 },
      { label: "30s", value: 30000 },
      { label: "1m", value: 60000 },
    ];

    const fmtMs = (ms: number | undefined | null) =>
      ms == null ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

    const fmtRate = (successes: number, attempts: number) =>
      attempts === 0 ? "—" : `${Math.round((successes / attempts) * 100)}%`;

    return (
      <AdminSection
        eyebrow="SYSTEM"
        title="Settings"
        description="Google Sheets connection, auto-sync controls, and data health overview."
        action={
          <button
            className="sync-action-btn"
            type="button"
            onClick={() => syncDiagMutation.mutate()}
            disabled={syncDiagMutation.isPending}
          >
            {syncDiagMutation.isPending
              ? <Loader2 size={14} className="syncing-icon" />
              : <Wifi size={14} />}
            {syncDiagMutation.isPending ? "Running…" : "Run Diagnostics"}
          </button>
        }
      >
        {/* ── Connection Health ──────────────────────────────────────── */}
        <div className="sync-grid">
          <section className={`admin-card sync-health-card ${syncOk ? "sync-ok" : sync?.lastStatus === "error" ? "sync-error" : ""}`}>
            <div className="sync-card-header">
              <div className="sync-card-icon read-icon">
                <FileSpreadsheet size={18} />
              </div>
              <div className="sync-card-badge" data-ok={syncOk}>
                {syncOk
                  ? <><CheckCircle size={13} /> Healthy</>
                  : sync?.lastStatus === "error"
                    ? <><AlertTriangle size={13} /> Error</>
                    : <><Clock size={13} /> Unknown</>}
              </div>
            </div>
            <h3>Google Sheets (Read)</h3>
            <p className="sync-card-desc">CSV polling — directory data source</p>
            <div className="sync-metrics">
              <div className="sync-metric">
                <span className="sync-metric-label">Latency</span>
                <span className="sync-metric-value">{fmtMs(sync?.avgLatencyMs)}</span>
              </div>
              <div className="sync-metric">
                <span className="sync-metric-label">Success rate</span>
                <span className="sync-metric-value">{fmtRate(sync?.successes ?? 0, sync?.attempts ?? 0)}</span>
              </div>
              <div className="sync-metric">
                <span className="sync-metric-label">Records cached</span>
                <span className="sync-metric-value">{sync?.cachedRecordCount ?? "—"}</span>
              </div>
              <div className="sync-metric">
                <span className="sync-metric-label">Poller</span>
                <span className="sync-metric-value sync-metric-small">
                  {sync == null ? "—" : sync.running ? "Running" : "Paused"}
                </span>
              </div>
              <div className="sync-metric">
                <span className="sync-metric-label">Interval</span>
                <span className="sync-metric-value sync-metric-small">{sync?.currentIntervalMs ? `${sync.currentIntervalMs / 1000}s` : "—"}</span>
              </div>
              <div className="sync-metric">
                <span className="sync-metric-label">Last attempt</span>
                <span className="sync-metric-value sync-metric-time">{formatIndiaSyncTime(sync?.lastAttemptAt ? new Date(sync.lastAttemptAt) : null)}</span>
              </div>
            </div>
            {sync?.lastError && (
              <div className="sync-card-error">
                <AlertTriangle size={13} />
                <span>{sync.lastError}</span>
              </div>
            )}
          </section>

          <section className={`admin-card sync-health-card ${writeTested ? (writeOk ? "sync-ok" : "sync-error") : ""}`}>
            <div className="sync-card-header">
              <div className="sync-card-icon write-icon">
                <Zap size={18} />
              </div>
              <div className="sync-card-badge" data-ok={writeOk}>
                {writeTested
                  ? writeOk
                    ? <><CheckCircle size={13} /> Reachable</>
                    : <><XCircle size={13} /> Unreachable</>
                  : <><Clock size={13} /> Not tested</>}
              </div>
            </div>
            <h3>Apps Script (Write)</h3>
            <p className="sync-card-desc">Mutation endpoint — verification, updates, donations</p>
            <div className="sync-metrics">
              <div className="sync-metric">
                <span className="sync-metric-label">Write latency</span>
                <span className="sync-metric-value">{diag?.write ? fmtMs(diag.write.latencyMs) : "—"}</span>
              </div>
              <div className="sync-metric">
                <span className="sync-metric-label">Write path</span>
                <span className="sync-metric-value sync-metric-small">{diag?.write?.ok ? "Active" : "—"}</span>
              </div>
            </div>
            {diag?.write && !diag.write.ok && diag.write.error && (
              <div className="sync-card-error">
                <AlertTriangle size={13} />
                <span>{diag.write.error}</span>
              </div>
            )}
            {diag?.write?.message && (
              <div className="sync-card-note">
                <Info size={12} />
                <span>{diag.write.message}</span>
              </div>
            )}
            {readTested && diag?.read && (
              <div className="sync-card-note">
                <Activity size={12} />
                <span>Read refresh: {fmtMs(diag.read.latencyMs)} — {diag.read.count} records</span>
              </div>
            )}
          </section>
        </div>

        {/* ── Auto-Sync Controls ────────────────────────────────────── */}
        <div className="sync-controls-row">
          <section className="admin-card sync-controls-card">
            <div className="sync-controls-header">
              <div className="sync-controls-label">
                <RefreshCw size={16} className={isSyncing || setAutoSyncMutation.isPending ? "syncing-icon" : ""} />
                <div>
                  <strong>Auto-Sync</strong>
                  <small>Refresh directory data from Google Sheets</small>
                </div>
              </div>
              <label className="sync-toggle" htmlFor="autoSyncToggle">
                <input
                  id="autoSyncToggle"
                  type="checkbox"
                  checked={autoSyncEnabled}
                  onChange={e => setAutoSyncEnabled(e.target.checked)}
                  disabled={setAutoSyncMutation.isPending}
                />
                <span className="sync-toggle-track">
                  <span className="sync-toggle-thumb" />
                </span>
                <span className={`sync-toggle-label ${autoSyncEnabled ? "active" : ""}`}>
                  {autoSyncEnabled ? "On" : "Off"}
                </span>
              </label>
            </div>
            <div className="sync-interval-row">
              <span className="sync-interval-label">Refresh interval</span>
              <div className="sync-interval-pills">
                {intervalOptions.map(opt => (
                  <button
                    key={opt.value}
                    className={`sync-interval-pill ${syncIntervalMs === opt.value ? "active" : ""}`}
                    type="button"
                    onClick={() => setSyncIntervalMs(opt.value)}
                    disabled={!autoSyncEnabled || setAutoSyncMutation.isPending}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sync-status-row">
              <span className="sync-status-text">
                <span className={`sync-dot ${isSyncing || justSynced ? "syncing" : ""}`} />
                {isSyncing
                  ? "Syncing now…"
                  : autoSyncEnabled
                    ? `Polling every ${syncIntervalMs < 1000 ? syncIntervalMs : `${syncIntervalMs / 1000}s`}`
                    : "Auto-sync paused"}
              </span>
              <span className="sync-status-time">
                Last sync: {formatIndiaSyncTime(
                  sync?.lastAttemptAt ? new Date(sync.lastAttemptAt) : lastSyncedAt
                )}
              </span>
            </div>
          </section>

          <section className="admin-card sync-manual-card">
            <h3>Manual Sync</h3>
            <p className="sync-card-desc">Trigger a one-time refresh of the directory cache</p>
            <button
              className="sync-action-btn primary"
              type="button"
              onClick={() => onSync()}
              disabled={isSyncing}
            >
              {isSyncing
                ? <Loader2 size={15} className="syncing-icon" />
                : <RefreshCw size={15} />}
              {isSyncing ? "Syncing…" : "Sync Now"}
            </button>
            <div className="sync-manual-meta">
              <span>Attempted: {sync?.attempts ?? 0}</span>
              <span>Succeeded: {sync?.successes ?? 0}</span>
              <span>Failed: {sync?.failures ?? 0}</span>
            </div>
          </section>
        </div>

                {/* ── Export & Actions ──────────────────────────────────────── */}
        <div className="sync-controls-row">
          <section className="admin-card sync-export-card">
            <h3>
              <Download size={16} />
              Export Directory
            </h3>
            <p className="sync-card-desc">Download the full HRS directory as an Excel spreadsheet</p>
            <button
              className="sync-action-btn"
              type="button"
              onClick={triggerExportCsv}
              disabled={exportCsvQuery.isFetching}
            >
              {exportCsvQuery.isFetching
                ? <Loader2 size={14} className="syncing-icon" />
                : <Download size={14} />}
              {exportCsvQuery.isFetching ? "Preparing…" : "Export Excel"}
            </button>
          </section>

          <section className="admin-card sync-export-card">
            <h3>
              <ShieldCheck size={16} />
              Quick Health Check
            </h3>
            <p className="sync-card-desc">Test both read and write connectivity to Google services</p>
            <button
              className="sync-action-btn"
              type="button"
              onClick={() => syncDiagMutation.mutate()}
              disabled={syncDiagMutation.isPending}
            >
              {syncDiagMutation.isPending
                ? <Loader2 size={14} className="syncing-icon" />
                : <Wifi size={14} />}
              {syncDiagMutation.isPending ? "Testing…" : "Test Connections"}
            </button>
            {diag && (
              <div className={`sync-diag-result ${diag.read?.ok && diag.write?.ok ? "ok" : "error"}`}>
                {diag.read?.ok && diag.write?.ok
                  ? <><CheckCircle size={13} /> Both read and write paths are healthy</>
                  : <><AlertTriangle size={13} /> Issues detected — see connection health above</>}
              </div>
            )}
          </section>
        </div>
      </AdminSection>
    );
  }
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
  deleteMode = false,
  selectedForDelete,
  onToggleDelete,
}: {
  record: AdminRecord;
  onEdit: (origin?: ModalOrigin) => void;
  showSubmitted?: boolean;
  deleteMode?: boolean;
  selectedForDelete?: Set<string>;
  onToggleDelete?: (id: string) => void;
}) {
  const recordKey = record.id ?? record.name;
  const isChecked = selectedForDelete?.has(recordKey) ?? false;

  const handleClick = (event: React.MouseEvent) => {
    if (deleteMode) {
      event.stopPropagation();
      onToggleDelete?.(recordKey);
      return;
    }
    onEdit({ x: event.clientX, y: event.clientY });
  };

  return (
    <div
      className={`records-table-row profile-row-clickable${deleteMode ? " delete-mode" : ""}${isChecked ? " selected-for-delete" : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          if (deleteMode) {
            event.preventDefault();
            onToggleDelete?.(recordKey);
          } else {
            onEdit();
          }
        }
      }}
    >
      {deleteMode && (
        <div className="table-checkbox">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggleDelete?.(recordKey)}
            onClick={event => event.stopPropagation()}
          />
        </div>
      )}
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
  isVolunteer,
}: {
  record: AdminRecord;
  origin: ModalOrigin | null;
  onClose: () => void;
  onSave: (record: AdminRecord, group: string, donationConsent: boolean | null, onSuccess?: (id: string) => void, onError?: () => void) => void;
  setRecordingDonation: (record: AdminRecord | null) => void;
  setDonationDateTime: (dateTime: string) => void;
  isVolunteer: boolean;
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
  const [mode, setMode] = useState<"view" | "edit">(isVolunteer ? "view" : isPending ? "edit" : "view");
  const [saveState, setSaveState] = useState<"idle" | "success" | "error">("idle");
  const [savedId, setSavedId] = useState(record.id);
  const [group, setGroup] = useState(record.group === "—" ? "" : record.group);
  const [donationConsent, setDonationConsent] = useState<boolean | null>(record.donorConsent);
  const [isSaving, setIsSaving] = useState(false);
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
  const [historyOpen, setHistoryOpen] = useState(true);
  const hasDonationHistory = record.donationCount > 0 && record.donationDates.length > 0;
  const lastDonation = record.donationDates.at(-1);
  const statusLabel = record.availability === "Available" ? "Eligible to donate" : "Not yet eligible";
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
        {saveState === "success" ? <div className="profile-save-success"><div className="profile-success-icon"><Check size={24} /></div><span className="profile-section-kicker">{isPending ? "Verification complete" : "Changes saved"}</span><h2>{isPending ? "Profile verified & email sent" : "Profile updated"}</h2><p>{isPending ? <>HRS ID <strong>{savedId}</strong> has been verified and a confirmation email has been sent to the donor.</> : "All changes have been saved successfully."}</p><button className="primary-button" onClick={onClose}>Back to Records <ArrowRight size={16} /></button></div> : <>
        <div className="profile-topline">
          <button className="profile-back-button" onClick={onClose}><ArrowLeft size={15} /> Back to Records</button>
          <div className="profile-topline-actions">
            {record.mobile && record.mobile !== "—" ? <a className="secondary-button profile-call-button" href={`tel:${record.mobile.replace(/[^\d+]/g, "")}`} style={{ marginRight: 8 }}><PhoneCall size={14} /> Call {record.mobile}</a> : null}
            {!isVolunteer && !isPending && <button className="secondary-button profile-top-edit" onClick={() => { setMode("edit"); setSaveState("idle"); setEditName(record.name); setEditDateOfBirth(record.dateOfBirth); setEditGender(record.gender); setEditMobile(record.mobile); setEditEmail(record.email); setEditArea(record.area); setEditLocation(record.location); }}><Edit3 size={14} /> Edit</button>}
          </div>
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
          <div className={`profile-overview-status ${isPending || record.availability === "Unavailable" || record.donorConsent === false ? "attention" : ""}`}><span><Heart size={13} /> Donation status</span><strong>{isPending ? "Verification required" : record.donorConsent === false ? "Not participating" : record.availability === "Available" ? "Eligible to donate" : "Temporarily unavailable"}</strong></div>
        </div>

        <div className="profile-detail-section profile-personal-section"><h3><UserRound size={15} /> Personal information</h3><div className="profile-detail-grid">
          {mode === "edit" ? <div className="profile-detail-row profile-detail-top-row"><div><span>Full name</span><input className="plain-input" value={editName} onChange={e => setEditName(e.target.value)} /></div><div><span>Date of birth</span><input type="date" className="plain-input" value={editDateOfBirth.includes("T") ? editDateOfBirth.slice(0, 10) : editDateOfBirth} onChange={e => setEditDateOfBirth(e.target.value)} /></div><div><span>Gender</span><select className="plain-input" value={editGender} onChange={e => setEditGender(e.target.value)} style={{ appearance: 'none', cursor: 'pointer' }}>{["Male", "Female", "Other"].map(g => <option key={g} value={g}>{g}</option>)}</select></div><div><span>Mobile number</span><input className="plain-input" value={editMobile} onChange={e => setEditMobile(e.target.value)} /></div></div> : <div className="profile-detail-row profile-detail-top-row"><div><span>Full name</span><strong>{record.name}</strong></div><div><span>Date of birth</span><strong>{formatShortDate(record.dateOfBirth)} · {formatAge(record.dateOfBirth)}</strong></div><div><span>Gender</span><strong>{record.gender}</strong></div><div><span>Mobile number</span><strong>{record.mobile}</strong></div></div>}
          {mode === "edit" ? <div className="profile-detail-row profile-detail-bottom-row"><div className="profile-email-field"><span>Email</span><input className="plain-input" value={editEmail} onChange={e => setEditEmail(e.target.value)} /></div><div><span>Address / area</span><select className="plain-input" value={editArea} onChange={e => setEditArea(e.target.value)} style={{ appearance: 'none', cursor: 'pointer' }}>{["Tumkur City", "Ashok Nagar", "SIT", "Kyathsandra", "Gulur", "Gubbi Gate", "SS Puram", "Other"].map(a => <option key={a} value={a}>{a}</option>)}</select></div><div><span>City</span><select className="plain-input" value={editLocation} onChange={e => setEditLocation(e.target.value)} style={{ appearance: 'none', cursor: 'pointer' }}>{["Tumkur", "Bangalore", "Hassan", "Other"].map(c => <option key={c} value={c}>{c}</option>)}</select></div></div> : <div className="profile-detail-row profile-detail-bottom-row"><div className="profile-email-field"><span>Email</span><strong>{record.email}</strong></div><div><span>Address / area</span><strong>{record.area}</strong></div><div><span>City</span><strong>{record.location}</strong></div></div>}
        </div></div>

        <div className={`profile-detail-section profile-consent-section${isPending ? " profile-consent-pending" : ""}`}><h3><ShieldCheck size={15} /> Consent <span className="profile-info-tip" title="Donation consent is recorded during verification and cannot be overridden in edit mode."><Info size={13} /></span></h3><div className="profile-consent-layout"><div className="profile-consent-row"><b className="profile-consent-icon">✓</b><span><small>Data storage consent</small><strong>Given</strong><em>Consent to store registration information</em></span></div><div className="profile-consent-row"><b className={`profile-consent-icon ${record.donorConsent === true ? "" : "muted"}`}>{record.donorConsent === null ? "−" : record.donorConsent ? "✓" : "×"}</b><span><small>Blood donation consent</small><strong>{record.donorConsent === null ? "Not yet recorded" : record.donorConsent ? "Yes · willing to donate" : "No · not participating"}</strong><em>{record.donorConsent === null ? "Will be collected during verification" : record.donorConsent ? "Can participate in blood donation" : "Not available for donation or public listing"}</em></span></div></div></div>

        {!isVolunteer && (isPending || mode === "edit") ? <><div className="profile-verification-section">
          <div className="profile-verification-heading"><div><span className="profile-section-kicker">{isPending ? "Complete verification" : "Edit profile"}</span><h3>{isPending ? "Finish this blood grouping record" : "Update verification details"}</h3></div><span className="profile-required">{isPending ? "2 required fields" : "View mode paused"}</span></div>
          <div className="profile-verification-fields">{isPending ? <div><span className="profile-field-label">Blood group · Required</span><div className="profile-blood-choice-grid">{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(bloodGroup => <button type="button" key={bloodGroup} className={group === bloodGroup ? "selected" : ""} onClick={() => setGroup(bloodGroup)}>{bloodGroup}</button>)}</div></div> : <Field label="Blood group · Required"><Select value={group || "Select blood group"} onChange={value => setGroup(value === "Select blood group" ? "" : value)} options={["Select blood group", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]} /></Field>}{isPending ? <div><span className="profile-field-label">Blood donation consent · Required</span><div className="profile-choice-group"><button type="button" className={donationConsent === true ? "selected yes" : ""} onClick={() => setDonationConsent(true)}>Yes</button><button type="button" className={donationConsent === false ? "selected no" : ""} onClick={() => setDonationConsent(false)}>No</button></div><button type="button" className={`profile-storage-toggle${storageConfirmed ? " active" : ""}`} role="switch" aria-checked={storageConfirmed} onClick={() => setStorageConfirmed(value => !value)}><span className="toggle-track"><i /></span><span>Data storage consent confirmed</span></button></div> : <div className="profile-edit-reference"><strong>{record.donorConsent ? "YES — willing to donate" : "NO — does not consent"}</strong></div>}</div>
          {!isPending && <button type="button" className={`profile-storage-toggle${storageConfirmed ? " active" : ""}`} role="switch" aria-checked={storageConfirmed} onClick={() => setStorageConfirmed(value => !value)}><span className="toggle-track"><i /></span><span>Data storage consent confirmed</span></button>}
          <p className="profile-helper">{!group ? "Add a blood group to generate an ID." : !storageConfirmed ? "Confirm the required storage consent to continue." : "Save to record the verification time and generate the HRS ID."}</p>
          <div className="profile-edit-actions-row">
            <button className="primary-button profile-verify-button" disabled={isSaving || isPending ? !group || donationConsent === null || !storageConfirmed : !editName.trim() || !group || donationConsent === null || !storageConfirmed} onClick={() => {
              if (isPending) {
                setIsSaving(true);
                onSave(record, group, donationConsent, id => { setSavedId(id); setSaveState("success"); setIsSaving(false); }, () => setIsSaving(false));
              } else {
                setIsSaving(true);
                const updatedRecord = {
                  ...record,
                  name: editName,
                  dateOfBirth: editDateOfBirth,
                  gender: editGender,
                  mobile: editMobile,
                  email: editEmail,
                  area: editArea,
                  location: editLocation,
                  group: group || "—",
                  donorConsent: donationConsent,
                  consent: storageConfirmed,
                };
                onSave(updatedRecord, group, donationConsent, id => {
                  setSavedId(id);
                  setSaveState("success");
                  setIsSaving(false);
                  setTimeout(() => setMode("view"), 1000);
                }, () => setIsSaving(false));
              }
            }}>{isSaving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : isPending ? "Save & Email" : "Save changes"} {!isSaving && <ArrowRight size={16} />}</button>
            <div style={{ alignSelf: "stretch", display: "flex", alignItems: "flex-end" }}>{!isPending && <button className="profile-cancel-edit" onClick={() => { setMode("view"); setEditName(record.name); setEditDateOfBirth(record.dateOfBirth); setEditGender(record.gender); setEditMobile(record.mobile); setEditEmail(record.email); setEditArea(record.area); setEditLocation(record.location); }}>Cancel</button>}</div>
          </div>
        </div></> : record.donorConsent === false ? <div className="profile-detail-section profile-disabled-section"><h3>Donation status</h3><div className="profile-disabled-grid"><div><span>Blood donation consent</span><strong>No</strong></div><div><span>Public donor visibility</span><strong>Hidden</strong></div><div><span>Donation tracking</span><strong>Disabled</strong></div><div><span>Blood donation count</span><strong>Not applicable</strong></div></div></div> : <>
          <div className="profile-detail-section profile-donation-section"><h3><Droplets size={15} /> Donation summary</h3><div className="profile-donation-summary"><div className="profile-summary-stat"><span>Total donations</span><strong>{record.donationCount}</strong></div><div className="profile-summary-stat"><span>Last donation</span><strong>{hasDonationHistory ? formatRecordDate(lastDonation) : "Not yet donated"}</strong></div><div className="profile-summary-stat"><span>Next eligible</span><strong>{record.nextEligibleAt ? formatRecordDate(record.nextEligibleAt) : "Eligible now"}</strong></div><div className={`profile-readiness ${record.availability === "Unavailable" ? "unavailable" : ""}`}><span>{record.availability === "Available" ? <Check size={18} /> : <Clock3 size={18} />}</span><div><strong>{statusLabel}</strong></div></div></div><div className="profile-public-status">● {record.publicVisible ? "Visible publicly" : "Not visible publicly"}</div></div>
          <div className={`profile-history-section${historyOpen ? " open" : " collapsed"}`}><div className="profile-history-heading"><h3><Droplets size={15} /> Donation history</h3><button type="button" className="profile-history-toggle" onClick={() => setHistoryOpen(open => !open)} aria-expanded={historyOpen}>{historyOpen ? "Hide" : "View"}<ChevronDown size={15} /></button></div><div className="profile-history-panel"><div className="profile-history-inner">{record.donationDates.length ? <div className="profile-history">
            <div className="profile-history-head">
              <span>Donation</span>
              <b>Donated on</b>
              <b>Eligible date</b>
              <b>Status</b>
            </div>
            {record.donationDates.map((date, index) => {
            const isLast = index === record.donationDates.length - 1;
            const nextEligibleDate = isLast && record.nextEligibleAt ? new Date(record.nextEligibleAt) : null;
            const isFuture = nextEligibleDate ? nextEligibleDate > new Date() : false;
            const eligibleLabel = isLast && record.nextEligibleAt ? formatShortDate(record.nextEligibleAt) : "—";
            return (
              <div key={`${date}-${index}`}>
                <span>Donation #{index + 1}</span>
                <b>{formatShortDate(date)}</b>
                <b>{eligibleLabel}</b>
                <small className="profile-history-status">
                  {isLast ? (
                    isFuture ? (
                      <div className="eligible-icon eligible-icon-amber" title={`Eligible on ${formatShortDate(record.nextEligibleAt)}`}><Clock3 size={16} strokeWidth={2.4} /></div>
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
              {!isVolunteer && <button className="profile-donation-button" disabled={record.availability !== "Available"} title={record.availability === "Available" ? "Record a new donation" : `New donation can be recorded after ${formatRecordDate(record.nextEligibleAt)}`} onClick={() => { setRecordingDonation(record); setDonationDateTime(new Date().toISOString().slice(0, 16)); }}><span className="profile-donation-button-icon"><Plus size={16} strokeWidth={2.5} /></span> Record new donation</button>}
            </div>
            </div> : <div className="profile-history-inner"><p className="profile-empty">No blood donations have been recorded yet.</p><div className="profile-history-footer">{!isVolunteer && <button className="profile-donation-button" disabled={record.availability !== "Available"} title={record.availability === "Available" ? "Record a new donation" : `New donation can be recorded after ${formatRecordDate(record.nextEligibleAt)}`} onClick={() => { setRecordingDonation(record); setDonationDateTime(new Date().toISOString().slice(0, 16)); }}><span className="profile-donation-button-icon"><Plus size={16} strokeWidth={2.5} /></span> Record new donation</button>}</div></div>}</div></div></div>
        </>}
        {!isPending && mode === "view" && <div className={`profile-activity-section${activityOpen ? " open" : " collapsed"}`}><div className="profile-activity-heading"><div><h3><History size={15} /> Activity timeline</h3><span>{activityEvents.length} recorded events</span></div><button type="button" className="profile-activity-toggle" onClick={() => setActivityOpen(open => !open)} aria-expanded={activityOpen} aria-controls={`activity-${record.id || record.name}`}>{activityOpen ? "Hide activity" : "View activity"}<ChevronDown size={15} /></button></div><div className="profile-activity-panel" id={`activity-${record.id || record.name}`} aria-hidden={!activityOpen}><div className="profile-activity-timeline">{activityEvents.map((event, index) => <div key={`${event.date}-${event.label}-${index}`}><span className="profile-activity-dot" /><div><b>{formatShortDate(event.date)}</b><span>{event.label}</span></div></div>)}</div></div></div>}
        </>}
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
                donorConsent: false,
                submitted: "Just now",
                registeredAt: new Date().toISOString(),
                verifiedAt: null,
                donationCount: 0,
                donationDates: [],
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
  setRecordingDonation,
  setDonationDateTime,
  isVolunteer,
}: {
  record: AdminRecord;
  onClose: () => void;
  setRecordingDonation: (record: AdminRecord | null) => void;
  setDonationDateTime: (dateTime: string) => void;
  isVolunteer: boolean;
}) {
  const hasDonationHistory = record.donationCount > 0 && record.donationDates.length > 0;
  const lastDonation = record.donationDates.at(-1);
  const statusLabel = record.availability === "Available" ? "Eligible to donate" : record.nextEligibleAt ? "Temporarily unavailable" : "Eligibility unknown";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className="admin-modal profile-modal donation-detail-modal" role="dialog" aria-modal="true">
        <div className="profile-topline">
          <button className="profile-back-button" onClick={onClose}>
            <ArrowLeft size={15} /> Back to Donations
          </button>
          {record.mobile && record.mobile !== "—" ? <a className="secondary-button profile-call-button" href={`tel:${record.mobile.replace(/[^\d+]/g, "")}`}><PhoneCall size={14} /> Call {record.mobile}</a> : null}
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

        <div className="profile-detail-section profile-personal-section"><h3><UserRound size={15} /> Personal information</h3><div className="profile-detail-grid"><div className="profile-detail-row profile-detail-top-row"><div><span>Full name</span><strong>{record.name}</strong></div><div><span>Date of birth</span><strong>{formatShortDate(record.dateOfBirth)} · {formatAge(record.dateOfBirth)}</strong></div><div><span>Gender</span><strong>{record.gender}</strong></div><div><span>Mobile number</span><strong>{record.mobile}</strong></div></div><div className="profile-detail-row profile-detail-bottom-row"><div className="profile-email-field"><span>Email</span><strong>{record.email}</strong></div><div><span>Address / area</span><strong>{record.area}</strong></div><div><span>City</span><strong>{record.location}</strong></div></div></div></div>

        <div className="profile-detail-section profile-donation-section"><h3><Droplets size={15} /> Donation summary</h3><div className="profile-donation-summary"><div className="profile-summary-stat"><span>Total donations</span><strong>{record.donationCount}</strong></div><div className="profile-summary-stat"><span>Last donation</span><strong>{hasDonationHistory ? formatRecordDate(lastDonation) : "Not yet donated"}</strong></div><div className="profile-summary-stat"><span>Next eligible</span><strong>{record.nextEligibleAt ? formatRecordDate(record.nextEligibleAt) : "Eligible now"}</strong></div><div className={`profile-readiness ${record.availability === "Unavailable" ? "unavailable" : ""}`}><span>{record.availability === "Available" ? <Check size={18} /> : <Clock3 size={18} />}</span><div><strong>{statusLabel}</strong></div></div></div><div className="profile-public-status">● {record.publicVisible ? "Visible publicly" : "Not visible publicly"}</div></div>

        <div className="profile-history-section open"><div className="profile-history-heading"><h3><Droplets size={15} /> Donation history</h3></div><div className="profile-history-panel"><div className="profile-history-inner">{record.donationDates.length ? <div className="profile-history">
          <div className="profile-history-head">
            <span>Donation</span>
            <b>Donated on</b>
            <b>Eligible date</b>
            <b>Status</b>
          </div>
          {record.donationDates.map((date, index) => {
            const isLast = index === record.donationDates.length - 1;
            const nextEligibleDate = isLast && record.nextEligibleAt ? new Date(record.nextEligibleAt) : null;
            const isFuture = nextEligibleDate ? nextEligibleDate > new Date() : false;
            const eligibleLabel = isLast && record.nextEligibleAt ? formatShortDate(record.nextEligibleAt) : "—";
            return (
              <div key={`${date}-${index}`}>
                <span>Donation #{index + 1}</span>
                <b>{formatShortDate(date)}</b>
                <b>{eligibleLabel}</b>
                <small className="profile-history-status">
                  {isLast ? (
                    isFuture ? (
                      <div className="eligible-icon eligible-icon-amber" title={`Eligible on ${formatShortDate(record.nextEligibleAt)}`}><Clock3 size={16} strokeWidth={2.4} /></div>
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
            {!isVolunteer && <button className="profile-donation-button" disabled={record.availability !== "Available"} title={record.availability === "Available" ? "Record a new donation" : `New donation can be recorded after ${formatRecordDate(record.nextEligibleAt)}`} onClick={() => { setRecordingDonation(record); setDonationDateTime(new Date().toISOString().slice(0, 16)); }}><span className="profile-donation-button-icon"><Plus size={16} strokeWidth={2.5} /></span> Record new donation</button>}
          </div>
        </div> : <div className="profile-history-inner"><p className="profile-empty">No blood donations have been recorded yet.</p><div className="profile-history-footer">{!isVolunteer && <button className="profile-donation-button" disabled={record.availability !== "Available"} title={record.availability === "Available" ? "Record a new donation" : `New donation can be recorded after ${formatRecordDate(record.nextEligibleAt)}`} onClick={() => { setRecordingDonation(record); setDonationDateTime(new Date().toISOString().slice(0, 16)); }}><span className="profile-donation-button-icon"><Plus size={16} strokeWidth={2.5} /></span> Record new donation</button>}</div></div>}</div></div></div>
      </section>
    </div>
  );
}
