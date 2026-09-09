import { useMemo, useState } from "react";
import {
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
  ChevronDown,
  Droplets,
  Eye,
  Heart,
  MapPin,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LocationStats } from "@/lib/api";
import type { AdminRecord } from "./Admin";

type SortKey = "donors" | "available" | "verified" | "name" | "coverage";

type LocationsViewProps = {
  locations: LocationStats[];
  totalAreas: number;
  totalDonors: number;
  totalAvailable: number;
  newThisSync: LocationStats[];
  outsideTumkur: number;
  records: AdminRecord[];
  donors: AdminRecord[];
  availableDonors: AdminRecord[];
  pending: AdminRecord[];
  lastSyncedAt: Date | null;
  bloodGroups: string[];
  isSyncing: boolean;
  onSync: () => void;
};

/* ─── tiny helpers ─── */
const bloodGroupColors: Record<string, string> = {
  "A+": "#c5162d",
  "A-": "#e16a70",
  "B+": "#2563eb",
  "B-": "#60a5fa",
  "AB+": "#9333ea",
  "AB-": "#c084fc",
  "O+": "#059669",
  "O-": "#34d399",
};

const heatColor = (pct: number) => {
  if (pct >= 75) return "#15803d";
  if (pct >= 50) return "#16a34a";
  if (pct >= 25) return "#f59e0b";
  if (pct > 0) return "#ea580c";
  return "transparent";
};

/* ─────────────────────────────────────────────────────── */

export default function LocationsView({
  locations,
  totalAreas,
  totalDonors,
  totalAvailable,
  newThisSync,
  outsideTumkur,
  records: _records,
  donors: _donors,
  availableDonors: _availableDonors,
  pending: _pending,
  lastSyncedAt: _lastSyncedAt,
  bloodGroups,
  isSyncing: _isSyncing,
  onSync: _onSync,
}: LocationsViewProps) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("donors");
  const [expandedArea, setExpandedArea] = useState<string | null>(null);

  /* ── filtered & sorted list ── */
  const filtered = useMemo(() => {
    let list = [...locations];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.area.toLowerCase().includes(q) ||
          l.topGroup.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      switch (sortBy) {
        case "available":
          return b.available - a.available;
        case "verified":
          return b.verified - a.verified;
        case "name":
          return a.area.localeCompare(b.area);
        case "coverage":
          return (b.donors / (totalDonors || 1)) - (a.donors / (totalDonors || 1));
        default:
          return b.donors - a.donors || b.total - a.total;
      }
    });
    return list;
  }, [locations, search, sortBy, totalDonors]);

  /* ── chart data ── */
  const barData = filtered.map((l) => ({
    name: l.area.length > 12 ? l.area.slice(0, 11) + "…" : l.area,
    fullName: l.area,
    donors: l.donors,
    available: l.available,
  }));

  const bloodGroupPie = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of locations) {
      for (const [bg, n] of Object.entries(l.bloodGroupCounts)) {
        counts[bg] = (counts[bg] || 0) + n;
      }
    }
    return bloodGroups
      .map((bg) => ({ name: bg, value: counts[bg] || 0 }))
      .filter((d) => d.value > 0);
  }, [locations, bloodGroups]);

  const avgDonorsPerArea = totalAreas ? Math.round(totalDonors / totalAreas) : 0;
  const availabilityPct = totalDonors ? Math.round((totalAvailable / totalDonors) * 100) : 0;

  /* ── top 5 areas for leaderboard ── */
  const topAreas = locations.slice(0, 5);

  return (
    <>
      {/* ─── KPI HERO ─── */}
      <div className="loc-kpi-row">
        <div className="loc-kpi loc-kpi--areas">
          <div className="loc-kpi-accent" />
          <div className="loc-kpi-body">
            <div className="loc-kpi-icon"><MapPin size={18} /></div>
            <div>
              <span>Active Zones</span>
              <strong>{totalAreas}</strong>
              <small>Coverage areas across Tumkur</small>
            </div>
          </div>
        </div>
        <div className="loc-kpi loc-kpi--donors">
          <div className="loc-kpi-accent" />
          <div className="loc-kpi-body">
            <div className="loc-kpi-icon"><Users size={18} /></div>
            <div>
              <span>Voluntary Donors</span>
              <strong>{totalDonors}</strong>
              <small>{avgDonorsPerArea} avg. per zone</small>
            </div>
          </div>
        </div>
        <div className="loc-kpi loc-kpi--available">
          <div className="loc-kpi-accent" />
          <div className="loc-kpi-body">
            <div className="loc-kpi-icon"><Heart size={18} /></div>
            <div>
              <span>Available Now</span>
              <strong>{totalAvailable}</strong>
              <small>{availabilityPct}% of total donors</small>
            </div>
          </div>
        </div>
        <div className="loc-kpi loc-kpi--outside">
          <div className="loc-kpi-accent" />
          <div className="loc-kpi-body">
            <div className="loc-kpi-icon"><TrendingUp size={18} /></div>
            <div>
              <span>Outside Tumkur</span>
              <strong>{outsideTumkur}</strong>
              <small>Records from other cities</small>
            </div>
          </div>
        </div>
      </div>

      {/* ─── SEARCH / SORT + CHART ROW ─── */}
      <div className="loc-two-col">
        {/* Left: Area Distribution Chart */}
        <div className="statistics-card loc-chart-card">
          <div className="statistics-card-heading">
            <div>
              <span>Distribution</span>
              <h2>Donors by area</h2>
            </div>
          </div>
          {filtered.length > 0 ? (
            <div className="loc-chart-wrap">
              <ResponsiveContainer width="100%" height={Math.max(200, filtered.length * 36)}>
                <BarChart
                  data={barData}
                  layout="vertical"
                  margin={{ top: 4, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid horizontal={false} stroke="#edf0ed" />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "#697369" }}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#3d483d" }}
                    width={85}
                  />
                  <Tooltip
                    contentStyle={{ border: "1px solid #dfe4df", borderRadius: 8, fontSize: 12 }}
                    cursor={{ fill: "#f4f8f4" }}
                    formatter={(value: number, name: string) => [value, name === "donors" ? "All Donors" : "Available Now"]}
                    labelFormatter={(label: string) => {
                      const item = barData.find((d) => d.name === label);
                      return item?.fullName || label;
                    }}
                  />
                  <Bar dataKey="donors" name="donors" fill="#c5162d" radius={[4, 4, 4, 4]} barSize={16}>
                    {barData.map((entry, idx) => {
                      const loc = locations.find((l) => l.area === entry.fullName);
                      const ratio = loc && totalDonors ? loc.donors / totalDonors : 0;
                      return (
                        <Cell
                          key={entry.fullName}
                          fill="#c5162d"
                          fillOpacity={0.55 + ratio * 0.45}
                        />
                      );
                    })}
                  </Bar>
                  <Bar dataKey="available" name="available" fill="#4a7a4a" radius={[4, 4, 4, 4]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="loc-empty-mini">
              <Search size={18} />
              <span>No areas match your search</span>
            </div>
          )}
        </div>

        {/* Right: Leaderboard + Blood Group Pie */}
        <div className="loc-right-stack">
          {/* Leaderboard */}
          <div className="statistics-card loc-leader-card">
            <div className="statistics-card-heading">
              <div>
                <span>Leaderboard</span>
                <h2>Top zones</h2>
              </div>
            </div>
            <div className="loc-leader-list">
              {topAreas.map((area, i) => {
                const pct = totalDonors ? Math.round((area.donors / totalDonors) * 100) : 0;
                return (
                  <div className="loc-leader-row" key={area.area}>
                    <div className={`loc-leader-rank ${i === 0 ? "loc-leader-rank--gold" : i === 1 ? "loc-leader-rank--silver" : i === 2 ? "loc-leader-rank--bronze" : ""}`}>
                      {i < 3 ? <Star size={11} /> : i + 1}
                    </div>
                    <div className="loc-leader-info">
                      <strong>{area.area}</strong>
                      <span>{area.donors} donors · {area.available} available</span>
                    </div>
                    <div className="loc-leader-bar-wrap">
                      <div className="loc-leader-bar" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="loc-leader-pct">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Blood Group Pie */}
          <div className="statistics-card loc-pie-card">
            <div className="statistics-card-heading">
              <div>
                <span>Composition</span>
                <h2>Blood groups</h2>
              </div>
            </div>
            {bloodGroupPie.length > 0 ? (
              <div className="loc-pie-layout">
                <div className="loc-pie-chart">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={bloodGroupPie}
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={78}
                        dataKey="value"
                        strokeWidth={2}
                        stroke="#fafbf9"
                      >
                        {bloodGroupPie.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={bloodGroupColors[entry.name] || "#888"}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ border: "1px solid #dfe4df", borderRadius: 8, fontSize: 12 }}
                        formatter={(value: number, name: string) => [`${value} donors`, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="loc-pie-legend">
                  {bloodGroupPie.map((d) => (
                    <div className="loc-pie-legend-item" key={d.name}>
                      <span className="loc-pie-dot" style={{ background: bloodGroupColors[d.name] || "#888" }} />
                      <strong>{d.name}</strong>
                      <small>{d.value}</small>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="loc-empty-mini">
                <Droplets size={18} />
                <span>No blood group data yet</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── SEARCH / FILTER BAR ─── */}
      <div className="loc-filter-bar">
        <div className="loc-search-wrap">
          <Search size={15} className="loc-search-icon" />
          <input
            className="loc-search-input"
            type="text"
            placeholder="Search areas by name or blood group…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="loc-search-clear" onClick={() => setSearch("")}>
              ×
            </button>
          )}
        </div>
        <div className="loc-sort-wrap">
          <SlidersHorizontal size={14} />
          <span>Sort by</span>
          <select
            className="loc-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
          >
            <option value="donors">Most Donors</option>
            <option value="available">Most Available</option>
            <option value="verified">Most Verified</option>
            <option value="coverage">Coverage %</option>
            <option value="name">Name A→Z</option>
          </select>
        </div>
        <div className="loc-filter-count">
          <strong>{filtered.length}</strong>
          <small>{filtered.length === 1 ? "area" : "areas"}</small>
        </div>
      </div>

      {/* ─── AREA CARDS (expandable) ─── */}
      <div className="loc-cards">
        {filtered.map((loc) => {
          const isOpen = expandedArea === loc.area;
          const pct = totalDonors ? Math.round((loc.donors / totalDonors) * 100) : 0;
          const barBg = totalDonors ? Math.round((loc.available / (loc.donors || 1)) * 100) : 0;
          const groupEntries = bloodGroups
            .map((bg) => ({ bg, count: loc.bloodGroupCounts[bg] || 0 }))
            .filter((g) => g.count > 0)
            .sort((a, b) => b.count - a.count);

          return (
            <div
              className={`loc-card ${loc.isNew ? "loc-card--new" : ""} ${isOpen ? "loc-card--open" : ""}`}
              key={loc.area}
            >
              {/* Card Header */}
              <div
                className="loc-card-header"
                onClick={() => setExpandedArea(isOpen ? null : loc.area)}
              >
                <div className="loc-card-left">
                  <div className="loc-card-rank-badge">{loc.isNew ? <Sparkles size={13} /> : locations.indexOf(loc) + 1}</div>
                  <div className="loc-card-meta">
                    <div className="loc-card-name-row">
                      <MapPin size={14} />
                      <strong>{loc.area}</strong>
                      {loc.isNew && <span className="loc-card-new-tag">New</span>}
                      {pct >= 20 && !loc.isNew && <span className="loc-card-hot-tag">Hot</span>}
                    </div>
                    <span className="loc-card-subtitle">
                      {loc.total} total records · Top: <strong>{loc.topGroup}</strong>
                    </span>
                  </div>
                </div>
                <div className="loc-card-right">
                  <div className="loc-card-stat-pair">
                    <div className="loc-card-stat">
                      <strong>{loc.donors}</strong>
                      <small>Donors</small>
                    </div>
                    <div className="loc-card-stat">
                      <strong>{loc.available}</strong>
                      <small>Ready</small>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`loc-card-chevron ${isOpen ? "loc-card-chevron--open" : ""}`}
                  />
                </div>
              </div>

              {/* Progress bar */}
              <div className="loc-card-bar-track">
                <div className="loc-card-bar-fill" style={{ width: `${pct}%` }} />
                <span className="loc-card-bar-label">{pct}%</span>
              </div>

              {/* Expanded Drill-Down */}
              {isOpen && (
                <div className="loc-card-detail">
                  <div className="loc-card-detail-grid">
                    {/* Stats */}
                    <div className="loc-card-detail-stats">
                      <div className="loc-card-dstat loc-card-dstat--verified">
                        <Eye size={14} />
                        <div>
                          <strong>{loc.verified}</strong>
                          <small>Verified</small>
                        </div>
                      </div>
                      <div className="loc-card-dstat loc-card-dstat--donors">
                        <Users size={14} />
                        <div>
                          <strong>{loc.donors}</strong>
                          <small>Voluntary</small>
                        </div>
                      </div>
                      <div className="loc-card-dstat loc-card-dstat--available">
                        <Heart size={14} />
                        <div>
                          <strong>{loc.available}</strong>
                          <small>Available</small>
                        </div>
                      </div>
                      <div className="loc-card-dstat loc-card-dstat--ratio">
                        <TrendingUp size={14} />
                        <div>
                          <strong>{barBg}%</strong>
                          <small>Readiness</small>
                        </div>
                      </div>
                    </div>

                    {/* Blood Group Mini Bars */}
                    <div className="loc-card-bloodgroups">
                      <span className="loc-card-bg-title">
                        <Droplets size={13} />
                        Blood Group Distribution
                      </span>
                      {groupEntries.length > 0 ? (
                        <div className="loc-card-bg-bars">
                          {groupEntries.map((g) => {
                            const maxCount = Math.max(...groupEntries.map((x) => x.count));
                            const barW = maxCount ? (g.count / maxCount) * 100 : 0;
                            return (
                              <div className="loc-card-bg-row" key={g.bg}>
                                <span className="loc-card-bg-label">{g.bg}</span>
                                <div className="loc-card-bg-track">
                                  <div
                                    className="loc-card-bg-bar"
                                    style={{
                                      width: `${barW}%`,
                                      background: bloodGroupColors[g.bg] || "#888",
                                    }}
                                  />
                                </div>
                                <span className="loc-card-bg-count">{g.count}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="loc-card-bg-empty">No verified donors yet</span>
                      )}
                    </div>

                    {loc.firstSeenAt && (
                      <div className="loc-card-timestamp">
                        First detected: {new Date(loc.firstSeenAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="admin-empty">
            <MapPin size={23} />
            <h3>No areas found</h3>
            <p>{search ? "Try a different search term." : "Areas appear here automatically when donors are added to the sheet."}</p>
          </div>
        )}
      </div>

      {/* ─── COVERAGE MATRIX ─── */}
      <div className="statistics-card loc-matrix-card">
        <div className="statistics-card-heading">
          <div>
            <span>Coverage</span>
            <h2>Blood groups by area</h2>
          </div>
          <span className="loc-matrix-badge">
            <Droplets size={13} />
            {Math.min(filtered.length, locations.length)} areas
          </span>
        </div>
        <div className="loc-matrix-wrap">
          <table className="loc-matrix-table">
            <thead>
              <tr>
                <th className="loc-matrix-th-area">Area</th>
                <th>Donors</th>
                {bloodGroups.map((bg) => (
                  <th key={bg} style={{ color: bloodGroupColors[bg] }}>{bg}</th>
                ))}
                <th>Available</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 15).map((area) => {
                const pct = totalDonors ? Math.round((area.donors / totalDonors) * 100) : 0;
                return (
                  <tr key={area.area}>
                    <td className="loc-matrix-area">
                      <strong>{area.area}</strong>
                      <small>{pct}%</small>
                    </td>
                    <td className="loc-matrix-count">{area.donors}</td>
                    {bloodGroups.map((bg) => {
                      const count = area.bloodGroupCounts[bg] || 0;
                      const maxForBg = Math.max(...filtered.map((f) => f.bloodGroupCounts[bg] || 0));
                      const intensity = maxForBg ? count / maxForBg : 0;
                      return (
                        <td
                          key={bg}
                          className={`loc-matrix-cell ${count > 0 ? "loc-matrix-cell--active" : ""}`}
                          style={
                            count > 0
                              ? {
                                  background: `${bloodGroupColors[bg] || "#888"}${Math.round(intensity * 18).toString(16).padStart(2, "0")}`,
                                  color: intensity > 0.5 ? bloodGroupColors[bg] : undefined,
                                }
                              : undefined
                          }
                        >
                          {count > 0 ? (
                            <strong>{count}</strong>
                          ) : (
                            <span className="loc-matrix-dash">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="loc-matrix-available">
                      {area.available > 0 ? (
                        <span className="loc-matrix-avail-badge">{area.available}</span>
                      ) : (
                        <span className="loc-matrix-dash">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Total</strong></td>
                <td className="loc-matrix-count"><strong>{totalDonors}</strong></td>
                {bloodGroups.map((bg) => (
                  <td key={bg} className="loc-matrix-cell">
                    <strong>
                      {locations.reduce((s, a) => s + (a.bloodGroupCounts[bg] || 0), 0)}
                    </strong>
                  </td>
                ))}
                <td className="loc-matrix-count"><strong>{totalAvailable}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
