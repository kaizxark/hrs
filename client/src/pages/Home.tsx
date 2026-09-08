import { FormEvent, useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { toast } from "sonner";
import SiteFooter from "@/components/SiteFooter";
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
  LockKeyhole,
  MapPin,
  MessageCircle,
  PhoneCall,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";

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
const tumkurAreas = [
  "All areas",
  "Tumkur City",
  "Ashok Nagar",
  "SIT",
  "Kyathsandra",
  "Gulur",
  "Gubbi Gate",
  "SS Puram",
];
const cities = ["Tumkur", "Bangalore", "Hassan", "Other"];

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
            ({donor.age}) · {donor.gender}
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

export function EmergencyDropup({
  requestDonor,
  onClose,
  clickPos,
}: {
  requestDonor: Donor | null;
  onClose: () => void;
  clickPos?: { x: number; y: number } | null;
}) {
  const modalStyle = {
    padding: "30px",
    position: "fixed" as const,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 61,
    margin: 0,
  };

  return createPortal(
    <>
      <style>
        {`
          .donor-modal-anim {
            animation: donor-pop 0.15s ease-out forwards !important;
          }
          @keyframes donor-pop {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
            100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
        `}
      </style>
      <div
        className="modal-backdrop emergency-modal-backdrop"
        onClick={onClose}
        style={{ zIndex: 1000, background: "rgba(0,0,0,0.5)" }}
      />
      <div
        className={`modal-card donor-modal-anim${requestDonor ? "" : " emergency-modal"}`}
        style={{ ...modalStyle, zIndex: 1001 }}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={19} />
        </button>
        {requestDonor ? (
          <>
            <div
              className="donor-card-top"
              style={{
                alignItems: "center",
                marginBottom: "20px",
                marginTop: "25px",
              }}
            >
              <div
                className={`avatar avatar-${requestDonor.tone}`}
                style={{ width: "56px", height: "56px", fontSize: "20px" }}
              >
                {requestDonor.initials}
              </div>
              <div className="donor-identity">
                <div className="donor-name-row">
                  <h3 style={{ fontSize: "22px" }}>{requestDonor.name}</h3>
                  <BadgeCheck
                    size={22}
                    className="verified-icon"
                    aria-label="Verified donor"
                  />
                </div>
                <p style={{ fontSize: "14px", marginTop: "4px" }}>
                  ({requestDonor.age}) · {requestDonor.gender}
                </p>
              </div>
              <div
                className="blood-chip"
                style={{ fontSize: "20px", padding: "12px 16px" }}
                aria-label={`Blood group ${requestDonor.bloodGroup}`}
              >
                {requestDonor.bloodGroup}
              </div>
            </div>

            <div
              style={{
                fontSize: "15px",
                paddingBottom: "20px",
                borderBottom: "1px solid #edf0ed",
                marginBottom: "20px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: "#636c63",
              }}
            >
              <MapPin size={18} /> {requestDonor.area}, {requestDonor.city}
            </div>

            <div
              style={{
                background: "#f8fae5",
                border: "1px solid #e4e9b9",
                borderRadius: "10px",
                padding: "14px",
                margin: "20px 0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  marginBottom: "10px",
                  fontSize: "13px",
                  color: "#5a621e",
                }}
              >
                <Check size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
                <span>
                  <strong>Data recorded with consent</strong>
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  fontSize: "13px",
                  color: "#5a621e",
                }}
              >
                <Check size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
                <span>
                  <strong>Voluntary blood donor</strong> – agreed to be
                  contacted by HRS when blood is needed.
                </span>
              </div>
            </div>

            <div
              style={{
                background: "#eef3ed",
                border: "1px solid #dbe6da",
                borderRadius: "10px",
                padding: "14px",
                fontSize: "12px",
                color: "#415343",
                marginBottom: 0,
                display: "flex",
                gap: "10px",
                lineHeight: 1.5,
              }}
            >
              <ShieldCheck
                size={16}
                style={{ flexShrink: 0, marginTop: "2px", color: "#4c7652" }}
              />
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
            <h2 style={{ fontSize: "24px", marginTop: "6px" }}>
              HRS Volunteers
            </h2>
            <p className="modal-copy" style={{ marginBottom: 18 }}>
              Contact our on-call volunteers for immediate assistance.
            </p>
            <div className="emergency-contact-list">
              {Array.from({ length: 15 }, (_, index) => index + 1).map(
                volunteer => {
                  const number = `+91 90000 000${volunteer}`;
                  const telHref = `tel:${number.replace(/\s+/g, "")}`;
                  const whatsappHref = `https://wa.me/${number.replace(/\s+/g, "").replace("+", "")}`;
                  return (
                    <div
                      key={volunteer}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        width: "100%",
                        padding: "8px 0",
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          fontSize: "22px",
                          color: "#2f332f",
                          fontWeight: 800,
                          letterSpacing: "0.02em",
                        }}
                      >
                        {number}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <a
                          href={telHref}
                          aria-label={`Call volunteer ${volunteer}`}
                          className="primary-button"
                          style={{
                            width: "42px",
                            height: "32px",
                            minWidth: "42px",
                            minHeight: "32px",
                            padding: 0,
                            borderRadius: "10px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textDecoration: "none",
                            boxShadow: "0 4px 12px rgba(201,47,59,.18)",
                          }}
                        >
                          <PhoneCall size={16} />
                        </a>
                        <a
                          href={whatsappHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Chat on WhatsApp with volunteer ${volunteer}`}
                          className="secondary-button"
                          style={{
                            width: "42px",
                            height: "32px",
                            minWidth: "42px",
                            minHeight: "32px",
                            padding: 0,
                            borderRadius: "10px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textDecoration: "none",
                            background: "#e4f3e7",
                            color: "#128c7e",
                            borderColor: "#d1e8d6",
                          }}
                        >
                          <MessageCircle size={16} />
                        </a>
                      </div>
                    </div>
                  );
                }
              )}
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
  const [donors, setDonors] = useState<Donor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bloodGroup, setBloodGroup] = useState("All Groups");
  const [city, setCity] = useState("Tumkur");
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

  useEffect(() => {
    let active = true;
    async function fetchData() {
      try {
        const sheetUrl =
          "https://docs.google.com/spreadsheets/d/e/2PACX-1vQlyH9ped9Y7wb_QwvGBPiMkmqew4Ulu_DLjzvyO0V01tzxv1QCQBb6zAoz5kpFbwvFCFhMDSOsNpzy/pub?output=csv";
        const response = await fetch(`${sheetUrl}&t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(`Google Sheets responded with ${response.status}`);
        const text = await response.text();
        const rows = text
          .replace(/^﻿/, "")
          .split(/\r?\n/)
          .filter(row => row.trim());
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
        const parsedDonors: Donor[] = [];

        for (const row of rows) {
          const cols = row
            .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
            .map(c => c.trim().replace(/^"|"$/g, ""));
          if (cols.length < 20) continue;

          const id = cols[0];
          const name = cols[1];
          const dob = cols[2];
          const gender = cols[3];
          const city = cols[6];
          const area = cols[7];
          const bloodGroup = cols[9];
          const donorConsent = cols[12];
          const verificationStatus = cols[13];
          const verifiedTime = cols[14];
          const donationCount = cols[15];
          const availabilityStatus = cols[18];
          const publicVisibility = cols[19];

          if (
            !id ||
            verificationStatus?.trim().toUpperCase() !== "VERIFIED" ||
            donorConsent?.trim().toUpperCase() !== "YES" ||
            !bloodGroup ||
            publicVisibility?.trim().toUpperCase() !== "YES"
          )
            continue;

          const safeName = name || "Unknown";
          const initials = safeName
            .split(" ")
            .map((n: string) => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();
          const tone = tones[parsedDonors.length % tones.length];
          const mappedStatus =
            availabilityStatus?.trim().toUpperCase() === "AVAILABLE"
              ? "Available"
              : availabilityStatus?.trim().toUpperCase() ===
                  "TEMPORARILY UNAVAILABLE"
                ? "Recently contacted"
                : "Available";
          const parsedDonationCount = Number.parseInt(donationCount, 10);

          // Calculate age from DOB
          let age = 0;
          if (dob) {
            const birthDate = new Date(dob);
            if (!Number.isNaN(birthDate.getTime())) {
              age = Math.floor(
                (Date.now() - birthDate.getTime()) /
                  (365.25 * 24 * 60 * 60 * 1000)
              );
            }
          }

          parsedDonors.push({
            id,
            name: safeName,
            age,
            gender: gender || "Unknown",
            bloodGroup,
            city: city || "Unknown",
            area: area || "Unknown",
            status: mappedStatus,
            verified: verifiedTime || "Verified",
            initials: initials || "?",
            tone,
            donationsCount: Number.isNaN(parsedDonationCount)
              ? 0
              : parsedDonationCount,
          });
        }
        if (active) setDonors(parsedDonors);
      } catch (e) {
        console.error("Failed to fetch donor data:", e);
      } finally {
        if (active) setIsLoading(false);
      }
    }

    fetchData();
    const refreshTimer = window.setInterval(fetchData, 30_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  const filteredDonors = useMemo(
    () =>
      donors
        .filter(donor => {
          if (donor.status === "Recently contacted") return false;
          const matchesGroup =
            bloodGroup === "All Groups" || donor.bloodGroup === bloodGroup;
          const matchesCity = donor.city === city;
          const matchesArea =
            city !== "Tumkur" || area === "All areas" || donor.area === area;
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
    setCity("Tumkur");
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
                  width: "fit-content",
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
                    minWidth: "360px",
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
                      onChange={value => {
                        setCity(value);
                        setArea("All areas");
                      }}
                      options={cities}
                    />
                    {city === "Tumkur" ? (
                      <SelectField
                        id="area"
                        label="Area"
                        value={area}
                        onChange={setArea}
                        options={tumkurAreas}
                      />
                    ) : (
                      <div className="field-wrap">
                        <FieldLabel htmlFor="other-area">Enter area</FieldLabel>
                        <input
                          className="plain-input"
                          id="other-area"
                          placeholder="Type an area"
                          value={area === "All areas" ? "" : area}
                          onChange={event =>
                            setArea(event.target.value || "All areas")
                          }
                        />
                      </div>
                    )}
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
                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    justifyContent: "center",
                    marginTop: "30px",
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
        <a className="selected" href="#top">
          <House size={19} />
          <span>Home</span>
        </a>
        <a href="#find">
          <Search size={20} />
          <span>Find Donors</span>
        </a>
        <button
          className="emergency-tab"
          onClick={() => setEmergencyOpen(true)}
          aria-label="Open emergency help"
        >
          <span className="emergency-tab-icon">
            <PhoneCall size={22} />
          </span>
          <span>Emergency</span>
        </button>
        <button
          className="nav-btn"
          onClick={() => window.location.assign("/admin")}
          aria-label="Login to staff workspace"
        >
          <LockKeyhole size={19} />
          <span>Login</span>
        </button>
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
