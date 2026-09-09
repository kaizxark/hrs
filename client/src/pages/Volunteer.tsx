import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { toast } from "sonner";
import SiteFooter from "@/components/SiteFooter";
import { StaffLogin } from "@/components/StaffLogin";
import { trpc } from "@/lib/trpc";
import { useStaffAuth } from "@/lib/staffAuth";
import {
  BadgeCheck,
  CalendarClock,
  ChevronDown,
  Clock3,
  Droplets,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  MessageCircle,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types & Constants                                                         */
/* -------------------------------------------------------------------------- */

type VolunteerRecord = {
  id: string | null;
  name: string;
  age: number;
  gender: string;
  mobile: string;
  email: string;
  group: string;
  location: string;
  area: string;
  status: "Verified" | "Pending";
  consent: boolean;
  donorConsent: boolean | null;
  donationCount: number;
  lastDonationAt: string | null;
  nextEligibleAt: string | null;
  initials: string;
};

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
const AVATAR_TONES = ["coral", "plum", "blue", "sage", "sand", "rose", "gold", "lavender"] as const;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toneFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function fmtDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function phoneClean(raw: string) {
  return raw.replace(/\s+/g, "");
}

/* -------------------------------------------------------------------------- */
/*  Tiny shared sub-components                                                 */
/* -------------------------------------------------------------------------- */

function HeroStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="vol-hero-stat">
      <span className="vol-hero-stat-icon">{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: VolunteerRecord["status"] }) {
  return status === "Verified" ? (
    <span className="vol-pill vol-pill-verified">
      <BadgeCheck size={13} /> Verified
    </span>
  ) : (
    <span className="vol-pill vol-pill-pending">
      <Clock3 size={13} /> Pending
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Volunteer Card                                                             */
/* -------------------------------------------------------------------------- */

function VolunteerCard({
  donor,
  index,
  onClick,
}: {
  donor: VolunteerRecord;
  index: number;
  onClick: () => void;
}) {
  const hasPhone = donor.mobile && donor.mobile.trim().length >= 8;
  const tone = toneFor(donor.name);

  return (
    <article
      className={`vol-card vol-tone-${tone}`}
      style={{ animationDelay: `${index * 40}ms` }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      aria-label={`View profile of ${donor.name}`}
    >
      <div className="vol-card-top">
        <div className="vol-card-avatar">
          {donor.initials || donor.name.charAt(0)}
        </div>
        <div className="vol-card-identity">
          <h3 className="vol-card-name">{donor.name}</h3>
          <span className="vol-card-sub">
            {donor.age} · {donor.gender} · {donor.group || "—"}
          </span>
        </div>
        <StatusPill status={donor.status} />
      </div>

      <div className="vol-card-body">
        {(donor.location || donor.area) && (
          <div className="vol-card-row">
            <MapPin size={14} className="vol-card-row-ic" />
            <span>
              {donor.area ? `${donor.area}, ` : ""}
              {donor.location}
            </span>
          </div>
        )}
        {hasPhone && (
          <div className="vol-card-row">
            <PhoneCall size={14} className="vol-card-row-ic" />
            <span>{donor.mobile}</span>
          </div>
        )}
        <div className="vol-card-row">
          <CalendarClock size={14} className="vol-card-row-ic" />
          <span>
            {donor.donationCount > 0
              ? `${donor.donationCount} donation${donor.donationCount === 1 ? "" : "s"}`
              : "No donations yet"}
          </span>
        </div>
      </div>

      <div className="vol-card-footer">
        {donor.nextEligibleAt && (
          <span className="vol-card-eligible">
            Next eligible: {fmtDate(donor.nextEligibleAt)}
          </span>
        )}
        <span className="vol-card-action">View details →</span>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/*  Skeleton Card (loading placeholder)                                        */
/* -------------------------------------------------------------------------- */

function SkeletonCard({ index }: { index: number }) {
  return (
    <div
      className="vol-card vol-card-skeleton"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="vol-card-top">
        <div className="vol-card-avatar skeleton-shimmer" />
        <div className="vol-card-identity">
          <div className="skeleton-line skeleton-line-name" />
          <div className="skeleton-line skeleton-line-sub" />
        </div>
      </div>
      <div className="vol-card-body">
        <div className="skeleton-line skeleton-line-row" />
        <div className="skeleton-line skeleton-line-row" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Profile Modal                                                              */
/* -------------------------------------------------------------------------- */

function ProfileModal({
  profile,
  onClose,
  onSendVerification,
  sendingVerification,
}: {
  profile: VolunteerRecord;
  onClose: () => void;
  onSendVerification: () => void;
  sendingVerification: boolean;
}) {
  const canCall = profile.mobile && profile.mobile.trim().length >= 8;
  const canEmail = profile.email && profile.email.trim().includes("@");

  return createPortal(
    <>
      <div className="vol-modal-backdrop" onClick={onClose} />
      <div className="vol-modal" role="dialog" aria-label={`Profile: ${profile.name}`}>
        <button className="vol-modal-close" onClick={onClose} aria-label="Close profile">
          <X size={20} />
        </button>

        <div className="vol-modal-header">
          <div className={`vol-modal-avatar vol-tone-${toneFor(profile.name)}`}>
            {profile.initials || profile.name.charAt(0)}
          </div>
          <div>
            <h2 className="vol-modal-name">{profile.name}</h2>
            <span className="vol-modal-sub">
              {profile.age} · {profile.gender} · {profile.group || "—"}
            </span>
            <div className="vol-modal-pills">
              <StatusPill status={profile.status} />
              {profile.consent && (
                <span className="vol-pill vol-pill-consent">
                  <ShieldCheck size={13} /> Consent
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="vol-modal-body">
          {(profile.location || profile.area) && (
            <div className="vol-modal-row">
              <MapPin size={16} />
              <span>
                {profile.area ? `${profile.area}, ` : ""}
                {profile.location}
              </span>
            </div>
          )}
          {canCall && (
            <div className="vol-modal-row">
              <PhoneCall size={16} />
              <a href={`tel:${phoneClean(profile.mobile)}`}>{profile.mobile}</a>
              <button
                className="vol-modal-copy"
                onClick={() => {
                  navigator.clipboard.writeText(phoneClean(profile.mobile));
                  toast.success("Phone copied.");
                }}
                aria-label="Copy phone number"
              >
                Copy
              </button>
            </div>
          )}
          {canEmail && (
            <div className="vol-modal-row">
              <Mail size={16} />
              <a href={`mailto:${profile.email}`}>{profile.email}</a>
              <button
                className="vol-modal-copy"
                onClick={() => {
                  navigator.clipboard.writeText(profile.email);
                  toast.success("Email copied.");
                }}
                aria-label="Copy email address"
              >
                Copy
              </button>
            </div>
          )}

          <div className="vol-modal-stats-grid">
            <div className="vol-modal-stat-box">
              <CalendarClock size={16} />
              <div>
                <strong>
                  {profile.donationCount > 0
                    ? `${profile.donationCount}`
                    : "0"}
                </strong>
                <small>Donations</small>
              </div>
            </div>
            {profile.lastDonationAt && (
              <div className="vol-modal-stat-box">
                <Clock3 size={16} />
                <div>
                  <strong>{fmtDate(profile.lastDonationAt)}</strong>
                  <small>Last donation</small>
                </div>
              </div>
            )}
            {profile.nextEligibleAt && (
              <div className="vol-modal-stat-box">
                <BadgeCheck size={16} />
                <div>
                  <strong>{fmtDate(profile.nextEligibleAt)}</strong>
                  <small>Next eligible</small>
                </div>
              </div>
            )}
          </div>

          <div className="vol-modal-actions">
            {canCall && (
              <a href={`tel:${phoneClean(profile.mobile)}`} className="primary-button">
                <PhoneCall size={16} /> Call now
              </a>
            )}
            {canCall && (
              <a
                href={`https://wa.me/${phoneClean(profile.mobile)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="primary-button vol-btn-whatsapp"
              >
                <MessageCircle size={16} /> WhatsApp
              </a>
            )}
            {canEmail && (
              <a href={`mailto:${profile.email}`} className="secondary-button">
                <Mail size={16} /> Email
              </a>
            )}
            <button
              className="secondary-button"
              onClick={onSendVerification}
              disabled={sendingVerification}
            >
              {sendingVerification ? (
                <><Loader2 size={16} className="vol-spin" /> Sending…</>
              ) : (
                <><Mail size={16} /> Send verification email</>
              )}
            </button>
          </div>

          <div className="vol-modal-notes">
            <div className="vol-note vol-note-consent">
              <ShieldCheck size={16} className="vol-note-ic" />
              <span>
                <strong>Data with consent.</strong> Profile recorded with consent.
                Donor consent:{" "}
                {profile.donorConsent === true
                  ? "Yes"
                  : profile.donorConsent === false
                    ? "No"
                    : "Not set"}
                .
              </span>
            </div>
            <div className="vol-note vol-note-privacy">
              <LockKeyhole size={16} className="vol-note-ic" />
              <span>
                <strong>Volunteer-only access.</strong> Do not share donor details outside
                HRS blood coordination.
              </span>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ========================================================================== */
/*  VolunteerDirectory — standalone directory view                              */
/*  Used inside Home.tsx when the logged-in user is a volunteer.               */
/* ========================================================================== */

export type VolunteerDirectoryProps = {
  staff: { username: string; displayName: string; role: "volunteer" | "admin" };
  onLogout: () => void;
  isLoggingOut: boolean;
};

export function VolunteerDirectory({ staff, onLogout, isLoggingOut }: VolunteerDirectoryProps) {
  const [filterGroup, setFilterGroup] = useState("All Groups");
  const [filterLocation, setFilterLocation] = useState("All Locations");
  const [filterText, setFilterText] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<VolunteerRecord | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const { data, isLoading, isFetching, refetch } = trpc.hrs.volunteerProfiles.useQuery(
    undefined,
    { retry: false, refetchInterval: 15_000, enabled: true },
  );

  const sendVerification = trpc.hrs.sendVerificationEmail.useMutation({
    onSuccess: (res) => {
      if (res?.success) {
        toast.success("Verification email sent to the donor.");
        refetch();
      } else {
        toast.error((res as { error?: string })?.error || "Could not send the email. Try again.");
      }
    },
    onError: (err) => toast.error(err.message || "Could not send the email."),
  });

  /* ---- Map records ---- */
  const records: VolunteerRecord[] = useMemo(() => {
    if (!data || !data.success || !data.data) return [];
    return data.data.records.map((r) => ({
      id: r.id,
      name: r.name,
      age: r.age,
      gender: r.gender,
      mobile: r.mobile,
      email: r.email,
      group: r.group,
      location: r.location,
      area: r.area,
      status: r.status,
      consent: r.consent,
      donorConsent: r.donorConsent,
      donationCount: r.donationCount,
      lastDonationAt: r.lastDonationAt,
      nextEligibleAt: r.nextEligibleAt,
      initials: r.initials,
    }));
  }, [data]);

  /* ---- Derived data ---- */
  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) if (r.location) set.add(r.location);
    return ["All Locations", ...Array.from(set).sort()];
  }, [records]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { "All Groups": records.length };
    for (const g of BLOOD_GROUPS) counts[g] = 0;
    for (const r of records) {
      if (r.group) counts[r.group] = (counts[r.group] ?? 0) + 1;
    }
    return counts;
  }, [records]);

  const stats = useMemo(() => {
    const verified = records.filter((r) => r.status === "Verified").length;
    const groups = new Set(records.map((r) => r.group).filter(Boolean)).size;
    return { total: records.length, verified, pending: records.length - verified, groups };
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return records
      .filter((r) => {
        const mGroup = filterGroup === "All Groups" || r.group === filterGroup;
        const mLocation = filterLocation === "All Locations" || r.location === filterLocation;
        const mQuery =
          q === "" ||
          r.name.toLowerCase().includes(q) ||
          (r.area || "").toLowerCase().includes(q) ||
          (r.mobile || "").toLowerCase().includes(q);
        return mGroup && mLocation && mQuery;
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "Verified" ? -1 : 1;
        return (b.donationCount ?? 0) - (a.donationCount ?? 0);
      });
  }, [records, filterGroup, filterLocation, filterText]);

  /* ---- Pagination (20 per page) ---- */
  const PAGE_SIZE = 20;
  const totalPages = Math.ceil(filteredRecords.length / PAGE_SIZE);
  const paginatedRecords = filteredRecords.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const hasActiveFilters =
    filterGroup !== "All Groups" ||
    filterLocation !== "All Locations" ||
    filterText.trim() !== "";

  function clearFilters() {
    setFilterGroup("All Groups");
    setFilterLocation("All Locations");
    setFilterText("");
    setCurrentPage(1);
  }

  function handleRefresh() {
    refetch();
    toast.success("Directory refreshed.");
  }

  function handleVerify(profile: VolunteerRecord) {
    if (!profile.id) return;
    sendVerification.mutate({ hrsId: profile.id });
  }

  /* Reset page when filters change */
  const filterKey = `${filterGroup}|${filterLocation}|${filterText}`;
  useMemo(() => { setCurrentPage(1); }, [filterKey]);

  return (
    <section className="volunteer-directory-wrapper">
      {/* Session bar */}
      <div className="vol-session-bar">
        <div className="vol-session-user">
          <span className="vol-session-avatar">
            {staff.displayName
              ? staff.displayName
                  .split(/\s+/)
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
              : staff.username?.slice(0, 2).toUpperCase() || "SU"}
          </span>
          <span className="vol-session-meta">
            <strong>{staff.displayName || staff.username}</strong>
            <small>
              Signed in as {staff.role === "volunteer" ? "volunteer" : "admin"}
            </small>
          </span>
        </div>
        <Link className="vol-session-home" href="/">
          Public portal
        </Link>
        <button
          className="vol-session-logout"
          onClick={onLogout}
          disabled={isLoggingOut}
        >
          <LogOut size={15} />
          {isLoggingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>

      {/* Hero */}
      <section className="vol-hero">
        <div className="vol-hero-blob vol-hero-blob-a" aria-hidden="true" />
        <div className="vol-hero-blob vol-hero-blob-b" aria-hidden="true" />
        <div className="vol-hero-inner">
          <div className="vol-hero-copy">
            <div className="eyebrow vol-hero-kicker">
              <span className="pulse-dot" /> Volunteer Network · HRS
            </div>
            <h1>
              Find the donor.
              <br />
              <em>Make the call.</em>
            </h1>
            <p>
              The volunteer directory shows every HRS donor record — verified and
              pending — with the contact details you need for coordination.
              Refreshes automatically every 15 seconds.
            </p>
            <div className="vol-hero-cta">
              <a href="#directory" className="primary-button">
                <Search size={17} /> Search the directory
              </a>
            </div>
          </div>

          <aside className="vol-hero-panel">
            <div className="vol-hero-panel-head">
              <UsersRound size={16} />
              <span>Directory at a glance</span>
            </div>
            <div className="vol-hero-stats">
              <HeroStat
                icon={<UsersRound size={18} />}
                value={stats.total}
                label="Total records"
              />
              <HeroStat
                icon={<BadgeCheck size={18} />}
                value={stats.verified}
                label="Verified donors"
              />
              <HeroStat
                icon={<Clock3 size={18} />}
                value={stats.pending}
                label="Awaiting verification"
              />
              <HeroStat
                icon={<Droplets size={18} />}
                value={stats.groups}
                label="Blood groups covered"
              />
            </div>
            <div className="vol-hero-note">
              <ShieldCheck size={15} /> Use contact details only for HRS blood
              coordination.
            </div>
          </aside>
        </div>
      </section>

      {/* Directory */}
      <section className="vol-directory" id="directory">
        {/* Toolbar */}
        <div className="vol-toolbar">
          <div className="vol-search">
            <Search size={17} />
            <input
              type="text"
              placeholder="Search by name, area or phone…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              aria-label="Search donors"
            />
            {filterText && (
              <button
                className="vol-search-clear"
                onClick={() => setFilterText("")}
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <div className="vol-select">
            <MapPin size={16} />
            <select
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              aria-label="Filter by location"
            >
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="vol-select-chevron" />
          </div>

          <button
            className="vol-refresh"
            onClick={handleRefresh}
            disabled={isFetching}
            aria-label="Refresh directory"
          >
            <RefreshCw size={16} className={isFetching ? "vol-spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Blood group chips */}
        <div className="vol-chips-row">
          <span className="vol-chips-label">Blood group</span>
          <div className="vol-chips">
            <button
              className={`vol-chip${filterGroup === "All Groups" ? " vol-chip-active" : ""}`}
              onClick={() => setFilterGroup("All Groups")}
            >
              All <small>{groupCounts["All Groups"]}</small>
            </button>
            {BLOOD_GROUPS.map((g) => {
              const count = groupCounts[g] ?? 0;
              return (
                <button
                  key={g}
                  className={`vol-chip${filterGroup === g ? " vol-chip-active" : ""}`}
                  onClick={() => setFilterGroup(filterGroup === g ? "All Groups" : g)}
                  disabled={count === 0}
                >
                  {g} <small>{count}</small>
                </button>
              );
            })}
          </div>
        </div>

        {/* Results bar */}
        <div className="vol-results-bar">
          <p>
            Showing <strong>{filteredRecords.length}</strong> of {records.length}{" "}
            donors
            {filterGroup !== "All Groups" && <> · Blood group {filterGroup}</>}
            {filterLocation !== "All Locations" && <> · {filterLocation}</>}
          </p>
          {hasActiveFilters && (
            <button className="text-button" onClick={clearFilters}>
              Clear all filters
            </button>
          )}
        </div>

        {/* Grid / Loading / Empty */}
        {isLoading ? (
          <div className="vol-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="vol-empty">
            <span className="vol-empty-icon">
              <Search size={22} />
            </span>
            <h3>No donors match your filters</h3>
            <p>Try a different blood group, location, or search term.</p>
            <button className="secondary-button" onClick={clearFilters}>
              Clear all filters
            </button>
          </div>
        ) : (
          <>
            <div className="vol-grid">
              {paginatedRecords.map((record, index) => (
                <VolunteerCard
                  key={record.id ?? `${record.name}-${index}`}
                  donor={record}
                  index={index}
                  onClick={() => setSelectedProfile(record)}
                />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="vol-pagination">
                <button
                  className="vol-page-btn"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  ← Prev
                </button>
                <span className="vol-page-info">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="vol-page-btn"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}

        {/* Footnote */}
        <div className="vol-footnote">
          <ShieldCheck size={16} />
          <span>
            Records refresh automatically every 15 seconds. Volunteer access only
            — never share donor details outside HRS coordination.
          </span>
        </div>
      </section>

      {/* Profile modal (portal) */}
      {selectedProfile && (
        <ProfileModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
          onSendVerification={() => handleVerify(selectedProfile)}
          sendingVerification={sendVerification.isPending}
        />
      )}
    </section>
  );
}

/* ========================================================================== */
/*  Standalone Volunteer Page (legacy / fallback)                               */
/* ========================================================================== */

export default function Volunteer() {
  const { staff, isLoading: staffLoading, logout, isLoggingOut } = useStaffAuth();

  if (staffLoading) {
    return (
      <div className="vol-page vol-auth-loading">
        <Loader2 size={26} className="vol-spin" />
        <p>Checking session…</p>
      </div>
    );
  }

  if (!staff || !staff.active) {
    return <StaffLogin />;
  }

  return (
    <div className="vol-page">
      <main>
        <VolunteerDirectory
          staff={staff}
          onLogout={() => logout()}
          isLoggingOut={isLoggingOut}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
