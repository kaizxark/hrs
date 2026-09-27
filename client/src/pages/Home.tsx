import { FormEvent, useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { toast } from "sonner";
import SiteFooter from "@/components/SiteFooter";
import { usePublicProfiles, Profile } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BellRing,
  Check,
  ChevronDown,
  Clock3,
  House,
  Info,
  LockKeyhole,
  MapPin,
  MessageCircle,
  PhoneCall,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
  HeartHandshake,
} from "lucide-react";
import {
  KA_DISTRICTS,
  kaAreasForDistrict,
  kaNormalizeDistrict,
  kaNormalizeArea,
} from "@shared/kaDistricts";

type Donor = {
  id: string;
  name: string;
  age: number;
  gender: string;
  bloodGroup: string;
  city: string;
  area: string;
  status: "Available" | "Recently contacted";
  verified: string;
  initials: string;
  tone: string;
  donationsCount: number;
};

const bloodGroups = [
  "All Groups",
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
];

function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <label className="field-label" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="field-wrap">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="select-shell">
        <select
          id={id}
          value={value}
          onChange={event => onChange(event.target.value)}
        >
          {options.map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown size={17} aria-hidden="true" />
      </div>
    </div>
  );
}

function DonorCard({
  donor,
  index,
  onClick,
}: {
  donor: Donor;
  index: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <article
      className={`donor-card donor-card-${Math.min(index + 1, 8)}`}
      onClick={onClick}
      style={{ cursor: "pointer" }}
    >
      <div className="donor-card-top">
        <div className={`avatar avatar-${donor.tone}`}>{donor.initials}</div>
        <div className="donor-identity">
          <div className="donor-name-row">
            <h3 style={{ fontSize: "17px" }}>{donor.name}</h3>
            <BadgeCheck
              size={18}
              className="verified-icon"
              aria-label="Verified donor"
            />
          </div>
          <p style={{ fontSize: "13px" }}>
            {donor.age} years · {donor.gender}
          </p>
        </div>
        <div
          className="blood-chip"
          style={{ fontSize: "15px", padding: "10px 12px" }}
          aria-label={`Blood group ${donor.bloodGroup}`}
        >
          {donor.bloodGroup}
        </div>
      </div>
      <div
        className="donor-card-meta"
        style={{
          fontSize: "13px",
          paddingTop: "18px",
          marginTop: "18px",
          borderBottom: "none",
          paddingBottom: 0,
        }}
      >
        <span>
          <MapPin size={16} /> {donor.area}, {donor.city}
        </span>
      </div>
    </article>
  );
}

// Emergency volunteer contacts — fetched live from the Volunteer sheet cache.
// Falls back to an empty array while loading; the popup shows a loading state.
type EmergencyContact = { name: string; phone: string };

export function EmergencyDropup({
  requestDonor,
  onClose,
  clickPos,
}: {
  requestDonor: Donor | null;
  onClose: () => void;
  clickPos?: { x: number; y: number } | null;
}) {
  // Fetch real emergency volunteers from the Volunteer sheet cache.
  const { data: contactsData, isLoading: contactsLoading } =
    trpc.staff.emergencyContacts.useQuery(undefined, {
      enabled: !requestDonor,
      staleTime: 60_000,
    });
  const emergencyVolunteers: EmergencyContact[] =
    (contactsData as EmergencyContact[] | undefined) ?? [];
  return createPortal(
    <>
      <div
        className="modal-backdrop emergency-modal-backdrop"
        onClick={onClose}
      />
      <div
        className={`modal-card emergency-modal-fixed${requestDonor ? "" : " emergency-modal"}`}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={19} />
        </button>
        {requestDonor ? (
          <>
            <div className="donor-card-top em-donor-top">
              <div className={`avatar avatar-${requestDonor.tone}`}>
                {requestDonor.initials}
              </div>
              <div className="donor-identity">
                <div className="donor-name-row">
                  <h3>{requestDonor.name}</h3>
                  <BadgeCheck
                    size={22}
                    className="verified-icon"
                    aria-label="Verified donor"
                  />
                </div>
                <p>{requestDonor.age} years · {requestDonor.gender}</p>
              </div>
              <div
                className="blood-chip"
                aria-label={`Blood group ${requestDonor.bloodGroup}`}
              >
                {requestDonor.bloodGroup}
              </div>
            </div>

            <div className="em-loc-row">
              <MapPin size={16} /> {requestDonor.area}, {requestDonor.city}
            </div>

            <div className="em-consent-box">
              <div className="em-consent-row">
                <Check size={16} />
                <span>
                  <strong>Data recorded with consent</strong>
                </span>
              </div>
              <div className="em-consent-row">
                <Check size={16} />
                <span>
                  <strong>Voluntary blood donor</strong> – agreed to be
                  contacted by HRS when blood is needed.
                </span>
              </div>
            </div>

            <div className="em-privacy-box">
              <ShieldCheck size={16} />
              <span>
                <strong>Privacy protected.</strong> Contact details are not
                publicly shared. The HRS relief team coordinates all
                communication to ensure safety and privacy.
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="modal-kicker">
              <BellRing size={15} /> Emergency Contacts
            </div>
            <h2>HRS Volunteers</h2>
            <p className="modal-copy">
              Contact our on-call volunteers for immediate assistance.
            </p>
            <div className="emergency-contact-list">
              {contactsLoading && (
                <div style={{ padding: "1rem", textAlign: "center", color: "#9ca3af" }}>
                  Loading volunteers…
                </div>
              )}
              {!contactsLoading && emergencyVolunteers.length === 0 && (
                <div style={{ padding: "1rem", textAlign: "center", color: "#9ca3af" }}>
                  No emergency contacts available right now.
                </div>
              )}
              {emergencyVolunteers.map(volunteer => {
                const number = volunteer.phone;
                const telHref = `tel:${number.replace(/\s+/g, "")}`;
                const whatsappHref = `https://wa.me/${number
                  .replace(/\s+/g, "")
                  .replace("+", "")}`;
                const initials = volunteer.name
                  .split(" ")
                  .map(part => part[0] ?? "")
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <div key={volunteer.phone} className="em-contact-row">
                    {/* Mobile sheet layout — name with calling icons beside it */}
                    <div className="em-contact-mobile">
                      <div className="em-contact-name">{volunteer.name}</div>
                      <div className="em-contact-actions">
                        <a
                          href={telHref}
                          aria-label={`Call volunteer ${volunteer.name}`}
                          className="primary-button em-call-btn"
                        >
                          <PhoneCall size={16} />
                        </a>
                        <a
                          href={whatsappHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Chat on WhatsApp with volunteer ${volunteer.name}`}
                          className="secondary-button em-wa-btn"
                        >
                          <MessageCircle size={16} />
                        </a>
                      </div>
                    </div>
                    {/* Desktop directory layout */}
                    <div className="em-contact-desktop">
                      <div className="em-contact-avatar">{initials}</div>
                      <div className="em-contact-main">
                        <div className="em-contact-name">{volunteer.name}</div>
                        <div className="em-contact-num">{number}</div>
                      </div>
                      <div className="em-contact-actions">
                        <a
                          href={telHref}
                          aria-label={`Call volunteer ${volunteer.name}`}
                          className="em-call-btn"
                        >
                          <PhoneCall size={15} /> Call
                        </a>
                        <a
                          href={whatsappHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Chat on WhatsApp with volunteer ${volunteer.name}`}
                          className="em-wa-btn"
                        >
                          <MessageCircle size={15} /> Message
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>,
    document.body
  );
}

function FloatingScrollbar() {
  const [metrics, setMetrics] = useState({ top: 0, height: 0, visible: false });
  const dragStart = useRef<{ y: number; scrollY: number } | null>(null);

  useEffect(() => {
    const updateScrollbar = () => {
      const viewportHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollableHeight = documentHeight - viewportHeight;

      if (scrollableHeight <= 0) {
        setMetrics({ top: 0, height: 0, visible: false });
        return;
      }

      const height = Math.max(
        42,
        (viewportHeight * viewportHeight) / documentHeight
      );
      const top =
        (window.scrollY / scrollableHeight) * (viewportHeight - height);
      setMetrics({ top, height, visible: true });
    };

    updateScrollbar();
    window.addEventListener("scroll", updateScrollbar, { passive: true });
    window.addEventListener("resize", updateScrollbar);
    return () => {
      window.removeEventListener("scroll", updateScrollbar);
      window.removeEventListener("resize", updateScrollbar);
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = { y: event.clientY, scrollY: window.scrollY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || !metrics.visible) return;
    const scrollableHeight =
      document.documentElement.scrollHeight - window.innerHeight;
    const maxThumbTop = window.innerHeight - metrics.height;
    const nextScrollY =
      dragStart.current.scrollY +
      ((event.clientY - dragStart.current.y) / maxThumbTop) * scrollableHeight;
    window.scrollTo(0, Math.max(0, Math.min(scrollableHeight, nextScrollY)));
  };

  const stopDragging = () => {
    dragStart.current = null;
  };

  if (!metrics.visible) return null;

  return (
    <div className="floating-scrollbar" aria-hidden="true">
      <div
        className="floating-scrollbar-thumb"
        style={{ top: `${metrics.top}px`, height: `${metrics.height}px` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      />
    </div>
  );
}

export default function Home() {
  const [bloodGroup, setBloodGroup] = useState("All Groups");
  const [city, setCity] = useState("Tumakuru");
  const [area, setArea] = useState("All areas");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [bloodGroup, city, area]);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [requestDonor, setRequestDonor] = useState<Donor | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [clickPos, setClickPos] = useState<{ x: number; y: number } | null>(
    null
  );

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;

    if (emergencyOpen) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [emergencyOpen]);

  const publicProfilesQuery = usePublicProfiles();

  // Donor directory comes from the server (single source of truth = the real
  // Google Sheet). The server already filters to VERIFIED + Donor Consent YES +
  // blood group + Public Directory Visibility YES.
  const donors = useMemo<Donor[]>(() => {
    const data = publicProfilesQuery.data;
    const profiles: Profile[] = data?.success ? data.data ?? [] : [];
    const tones = [
      "coral",
      "plum",
      "blue",
      "sage",
      "sand",
      "rose",
      "gold",
      "lavender",
    ];
    return profiles.map((p, index) => {
      const safeName = p["Full Name"] || "Unknown";
      const initials = safeName
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      const tone = tones[index % tones.length];
      const mappedStatus =
        (p["Availability Status"] ?? "").trim().toUpperCase() === "AVAILABLE"
          ? "Available"
          : (p["Availability Status"] ?? "")
                .trim()
                .toUpperCase() === "TEMPORARILY UNAVAILABLE"
            ? "Recently contacted"
            : "Available";
      const parsedDonationCount = Number.parseInt(
        p["Blood Donation Count"] ?? "",
        10
      );

      // The server strips DOB from the public payload and ships a derived
      // `age` instead (exact birthdates are never exposed publicly).
      const serverAge = (p as unknown as { age?: unknown }).age;
      const age = typeof serverAge === "number" ? serverAge : 0;

      return {
        id: p["HRS ID"] || "",
        name: safeName,
        age,
        gender: p["Gender"] || "Unknown",
        bloodGroup: p["Blood Group"] || "",
        city: p["City"] || "Unknown",
        area: p["Area"] || "Unknown",
        status: mappedStatus,
        verified: p["Verification Time"] || "Verified",
        initials: initials || "?",
        tone,
        donationsCount: Number.isNaN(parsedDonationCount)
          ? 0
          : parsedDonationCount,
      };
    });
  }, [publicProfilesQuery.data]);

  const isLoading = publicProfilesQuery.isLoading && donors.length === 0;

  /** Selecting a district invalidates the chosen area in the same stroke —
   *  an area of one district can never linger under another. */
  const selectCity = (next: string) => {
    setCity(next);
    setArea("All areas");
  };

  // City options are the full Karnataka district list; area options come
  // from that district's talukas plus any areas actually present in the
  // records (so legacy localities like "SIT" or "SS Puram" remain filterable).
  const cityOptions = KA_DISTRICTS;

  const areaOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const donor of donors) {
      if (city !== "All cities" && kaNormalizeDistrict(donor.city) !== city)
        continue;
      const a = kaNormalizeArea(donor.area);
      if (a && a !== "Unknown") seen.add(a);
    }
    for (const a of kaAreasForDistrict(city)) seen.add(a);
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [donors, city]);

  const filteredDonors = useMemo(
    () =>
      donors
        .filter(donor => {
          if (donor.status === "Recently contacted") return false;
          const matchesGroup =
            bloodGroup === "All Groups" || donor.bloodGroup === bloodGroup;
          const matchesCity =
            city === "All cities" ||
            kaNormalizeDistrict(donor.city) === city;
          const matchesArea =
            area === "All areas" || kaNormalizeArea(donor.area) === area;
          return matchesGroup && matchesCity && matchesArea;
        })
        .sort((a, b) => b.donationsCount - a.donationsCount),
    [donors, bloodGroup, city, area]
  );

  const totalPages = Math.ceil(filteredDonors.length / 15);
  const paginatedDonors = filteredDonors.slice(
    (currentPage - 1) * 15,
    currentPage * 15
  );

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setHasSearched(true);
    document
      .getElementById("results")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const clearFilters = () => {
    setBloodGroup("All Groups");
    setCity("Tumakuru");
    setArea("All areas");
    setHasSearched(false);
  };

  const openDonorRequest = (donor: Donor, e?: React.MouseEvent) => {
    if (e) setClickPos({ x: e.clientX, y: e.clientY });
    setRequestDonor(donor);
    setEmergencyOpen(true);
  };

  return (
    <div className="portal-shell">
      <main id="top">
        <section className="hero-section motion-section" id="find">
          <div className="hero-grid">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="pulse-dot" /> Verified community network ·
                Tumkur
              </div>
              <h1>
                Find the right
                <br />
                <em>blood donor.</em>
              </h1>
              <p>
                Search verified blood group records by group and location. No
                phone numbers shown — just the help you need, faster.
              </p>
              <div
                className="hero-dropdown-wrapper"
                style={{
                  marginTop: "20px",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <style>{`.hero-dropdown-btn:active { transform: none !important; opacity: 0.85; }`}</style>
                <button
                  className="primary-button hero-dropdown-btn"
                  onClick={event => {
                    setClickPos({ x: event.clientX, y: event.clientY });
                    setRequestDonor(null);
                    setEmergencyOpen(true);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "15px",
                    padding: "14px 22px",
                    fontSize: "15px",
                    background: "#e34747",
                    borderColor: "#cc3f3f",
                    color: "white",
                    boxShadow: "0 4px 14px rgba(227, 71, 71, 0.3)",
                    width: "100%",
                    borderRadius: "12px",
                    transition: "border-radius 0.2s ease",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <BellRing size={20} /> Need blood urgently? Call HRS
                  </div>
                  <ArrowRight size={18} />
                </button>

              </div>
              </div>
            <div
              className="search-panel motion-card"
              aria-label="Find blood donors"
            >
              <div className="search-panel-top">
                <div>
                  <span className="panel-label">DONOR SEARCH</span>
                  <h2>Find Available Donors!</h2>
                </div>
                <div className="panel-icon">
                  <Search size={20} />
                </div>
              </div>
              <form onSubmit={submitSearch}>
                <div className="search-form-layout">
                  <div className="blood-group-selector">
                    <span className="field-label">Select Blood Group</span>
                    <div className="blood-group-grid">
                      {bloodGroups.map(bg => (
                        <button
                          key={bg}
                          type="button"
                          className={`blood-group-btn ${bloodGroup === bg ? "active" : ""}`}
                          onClick={() => setBloodGroup(bg)}
                        >
                          {bg}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="desktop-location-grid">
                    <SelectField
                      id="city"
                      label="City"
                      value={city}
                      onChange={selectCity}
                      options={["All cities", ...cityOptions]}
                    />
                    <SelectField
                      id="area"
                      label="Area"
                      value={area}
                      onChange={setArea}
                      options={["All areas", ...areaOptions]}
                    />
                  </div>
                  </div>
              </form>
              <div className="panel-footnote">
                <span className="sheet-status">
                  <span className="status-dot" /> Live directory
                </span>
              </div>
            </div>
          </div>
        </section>

        <section
          className="results-section motion-section motion-section-delayed"
          id="results"
        >
          <div className="section-heading-row">
            <div>
              <h2>
                {filteredDonors.length > 0
                  ? `${filteredDonors.length} verified donor${filteredDonors.length === 1 ? "" : "s"}`
                  : "No matching donors"}
              </h2>
            </div>
          </div>
          {isLoading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <h3>Finding matching donors</h3>
              <p>Fetching live records from our database...</p>
            </div>
          ) : filteredDonors.length > 0 ? (
            <>
              <div className="donor-grid">
                {paginatedDonors.map((donor, index) => (
                  <DonorCard
                    donor={donor}
                    index={index}
                    key={donor.id}
                    onClick={e => openDonorRequest(donor, e)}
                  />
                ))}
              </div>
              {totalPages > 1 && (
                <div className="results-pagination">
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
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">
                <Search size={22} />
              </div>
              <h3>No matching records found</h3>
              <p>Try changing the blood group or location.</p>
              <button className="secondary-button" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}
        </section>
      </main>

      <SiteFooter />

      <FloatingScrollbar />

      {/* Floating emergency button removed */}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <Link className="nav-slot nav-left" href="/about">
          <Info size={20} />
          <span>About</span>
        </Link>
        <button
          className="nav-slot emergency-tab"
          onClick={() => setEmergencyOpen(true)}
          aria-label="Open emergency help"
        >
          <span className="emergency-tab-icon">
            <PhoneCall size={28} />
          </span>
          <span>Emergency</span>
        </button>
        <Link className="nav-slot nav-right" href="/admin">
          <LockKeyhole size={20} />
          <span>Login</span>
        </Link>
      </nav>

      {emergencyOpen && (
        <EmergencyDropup
          requestDonor={requestDonor}
          onClose={() => {
            setEmergencyOpen(false);
            setRequestDonor(null);
          }}
          clickPos={clickPos}
        />
      )}
    </div>
  );
}
