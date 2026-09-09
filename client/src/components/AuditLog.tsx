import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Filter,
  History,
  Loader2,
  Search,
  Shield,
  Trash2,
  User,
  UserCheck,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 50;

const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All actions" },
  { value: "profile.verify", label: "Verify" },
  { value: "profile.update", label: "Update" },
  { value: "profile.delete", label: "Delete" },
  { value: "profile.donation", label: "Record donation" },
  { value: "profile.send_email", label: "Send email" },
  { value: "directory.sync", label: "Directory sync" },
  { value: "audit.clear", label: "Clear audit log" },
  { value: "system.notify_owner", label: "Notify owner" },
  { value: "staff.create", label: "Create staff" },
  { value: "staff.delete", label: "Delete staff" },
  { value: "staff.update", label: "Update staff" },
];

/** Elegant, muted palette — each action gets a sophisticated tone. */
const ACTION_META: Record<
  string,
  { icon: React.ReactNode; color: string; bg: string }
> = {
  "profile.verify": {
    icon: <UserCheck size={15} />,
    color: "#2d6a4f",
    bg: "#d8f3dc",
  },
  "profile.update": {
    icon: <FileText size={15} />,
    color: "#3a5a8c",
    bg: "#d4e4f7",
  },
  "profile.delete": {
    icon: <Trash2 size={15} />,
    color: "#a4243b",
    bg: "#f4d6d6",
  },
  "profile.donation": {
    icon: <CheckCircle2 size={15} />,
    color: "#7b2d8b",
    bg: "#ece0f0",
  },
  "profile.send_email": {
    icon: <User size={15} />,
    color: "#b07d2b",
    bg: "#f5ecd3",
  },
  "directory.sync": {
    icon: <History size={15} />,
    color: "#1a759f",
    bg: "#d0eaf5",
  },
  "audit.clear": {
    icon: <Trash2 size={15} />,
    color: "#a4243b",
    bg: "#f4d6d6",
  },
  "system.notify_owner": {
    icon: <Shield size={15} />,
    color: "#5c6370",
    bg: "#e4e6e9",
  },
  "staff.create": {
    icon: <UserCheck size={15} />,
    color: "#2d6a4f",
    bg: "#d8f3dc",
  },
  "staff.delete": {
    icon: <Trash2 size={15} />,
    color: "#a4243b",
    bg: "#f4d6d6",
  },
  "staff.update": {
    icon: <FileText size={15} />,
    color: "#3a5a8c",
    bg: "#d4e4f7",
  },
};

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

interface AuditLogEntry {
  id: number;
  action: string;
  actionLabel: string;
  targetId: string | null;
  targetName: string | null;
  details: Record<string, unknown> | null;
  success: boolean;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function formatTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Kolkata",
      hour12: true,
    });
  } catch {
    return dateStr;
  }
}

function formatRelative(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const diff = Date.now() - date.getTime();
    if (diff < 0) return "just now";
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) {
      const m = Math.floor(diff / 60_000);
      return `${m}m ago`;
    }
    if (diff < 86_400_000) {
      const h = Math.floor(diff / 3_600_000);
      return `${h}h ago`;
    }
    const d = Math.floor(diff / 86_400_000);
    if (d < 7) return `${d}d ago`;
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatFullTimestamp(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return dateStr;
  }
}

function describeDetails(
  action: string,
  details: Record<string, unknown> | null,
): string | null {
  if (!details) return null;

  // --- MySQL format (dot-notation keys from server logAudit) ---
  if (action === "profile.verify" && details.bloodGroup) {
    return `${details.bloodGroup}${details.donorConsent !== undefined ? ` · consent ${details.donorConsent}` : ""}`;
  }
  if (action === "profile.verify" && details.blood_group) {
    // Legacy sheet format (snake_case keys from Apps Script)
    const consent = details.donor_consent
      ? ` · consent ${details.donor_consent}`
      : "";
    return `${details.blood_group}${consent}`;
  }
  if (action === "profile.update") {
    // Server logs { changedFields: [...] }
    if (Array.isArray(details.changedFields)) {
      const fields = details.changedFields as string[];
      if (fields.length === 0) return null;
      const labels: Record<string, string> = {
        name: "name",
        dob: "date of birth",
        gender: "gender",
        mobile: "mobile",
        email: "email",
        city: "city",
        area: "area",
        bloodGroup: "blood group",
        donorConsent: "consent",
      };
      return fields.map((f) => labels[f] || f).join(", ");
    }
    // Legacy sheet format
    if (details.message) return String(details.message);
  }
  if (action === "profile.donation" && details.donationTime) {
    return String(details.donationTime);
  }
  if (action === "profile.donation" && details.donation_time) {
    // Legacy sheet format
    return String(details.donation_time);
  }
  if (action === "profile.delete") {
    // Server logs { hrsIds, count }
    const ids = details.hrsIds;
    if (Array.isArray(ids) && ids.length > 0) {
      const preview = ids.slice(0, 3).join(", ");
      const more = ids.length > 3 ? ` +${ids.length - 3}` : "";
      return `${preview}${more}`;
    }
    const count = details.count;
    if (count) return `${count} record(s) deleted`;
    // Legacy sheet format (JSON string of IDs)
    const legacyIds = details.hrs_ids;
    const legacyCount = details.deleted;
    if (typeof legacyIds === "string") {
      try {
        const arr = JSON.parse(legacyIds) as string[];
        if (arr.length > 0) {
          const preview = arr.slice(0, 3).join(", ");
          const more = arr.length > 3 ? ` +${arr.length - 3}` : "";
          return `${preview}${more}`;
        }
      } catch {
        // fall through
      }
    }
    if (legacyCount) return `${legacyCount} record(s) deleted`;
  }
  if (action === "directory.sync") {
    // Server logs { before, after }
    if (details.before !== undefined) {
      return `${details.before} → ${details.after}`;
    }
    // Legacy sheet format
    if (details.message) return String(details.message);
  }
  if (action === "system.notify_owner" && details.title) {
    return String(details.title);
  }
  if (action === "audit.clear" && details.removed !== undefined) {
    return `${details.removed} entries removed`;
  }
  // Staff actions — show username/displayName from details
  if (action === "staff.create" && details.username) {
    return String(details.username);
  }
  if (action === "staff.delete" && details.username) {
    return String(details.username);
  }
  if (action === "staff.update" && details.username) {
    const parts: string[] = [];
    if (details.displayNameChanged) parts.push("name changed");
    if (details.passwordChanged) parts.push("password changed");
    return parts.length > 0 ? parts.join(", ") : String(details.username);
  }

  if (details.message) return String(details.message);

  return null;
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export default function AuditLog() {
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onSearchChange = useCallback((value: string) => {
    setSearchDraft(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPage(0);
    }, 350);
  }, []);

  useEffect(() => {
    setPage(0);
  }, [actionFilter]);

  const query = trpc.audit.list.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    action: actionFilter === "all" ? undefined : actionFilter,
    search: search || undefined,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      query.refetch();
    }, 15_000);
    return () => clearInterval(interval);
  }, [query]);

  const logs: AuditLogEntry[] = useMemo(
    () => ((query.data as { logs: AuditLogEntry[] } | undefined)?.logs ?? []),
    [query.data],
  );

  const total = useMemo(
    () => ((query.data as { total: number } | undefined)?.total ?? 0),
    [query.data],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isEmpty = !query.isLoading && logs.length === 0;

  const clearMutation = trpc.audit.clear.useMutation({
    onSuccess: () => {
      query.refetch();
    },
  });

  // Group logs by date
  const grouped = useMemo(() => {
    const groups: { date: string; entries: AuditLogEntry[] }[] = [];
    let currentDate = "";
    for (const log of logs) {
      try {
        const d = new Date(log.createdAt);
        const label = d.toLocaleDateString("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        });
        if (label !== currentDate) {
          currentDate = label;
          groups.push({ date: label, entries: [] });
        }
        groups[groups.length - 1].entries.push(log);
      } catch {
        if (currentDate !== "Unknown") {
          currentDate = "Unknown";
          groups.push({ date: "Unknown", entries: [] });
        }
        groups[groups.length - 1].entries.push(log);
      }
    }
    return groups;
  }, [logs]);

  return (
    <section className="audit-card">
      {/* Toolbar */}
      <div className="audit-toolbar">
        <div className="audit-search">
          <Search size={14} className="audit-search-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search by name, ID, or action…"
            value={searchDraft}
            onChange={(e) => onSearchChange(e.target.value)}
            className="audit-search-input"
          />
          {searchDraft && (
            <button
              className="audit-search-clear"
              onClick={() => {
                setSearchDraft("");
                setSearch("");
                setPage(0);
                inputRef.current?.focus();
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="audit-toolbar-right">
          <button
            className="audit-clear-btn"
            onClick={() => {
              if (confirm("Clear all audit log entries? This cannot be undone.")) {
                clearMutation.mutate();
              }
            }}
            disabled={clearMutation.isPending}
            title="Clear all audit logs"
          >
            {clearMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {clearMutation.isPending ? "Clearing…" : "Clear logs"}
          </button>

          <select
            className="audit-filter-trigger"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            {ACTION_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>

          <span className="audit-count-badge">
            {total} {total === 1 ? "entry" : "entries"}
          </span>
        </div>
      </div>

      {/* Loading */}
      {query.isLoading && (
        <div className="audit-status-box">
          <Loader2 size={18} className="animate-spin" />
          <span>Loading audit log…</span>
        </div>
      )}

      {/* Error */}
      {query.isError && (
        <div className="audit-status-box audit-status-error">
          <AlertTriangle size={16} />
          <span>Failed to load audit log.</span>
          <button className="audit-retry-btn" onClick={() => query.refetch()}>
            Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {isEmpty && (
        <div className="audit-status-box audit-status-empty">
          <History size={36} strokeWidth={1} />
          <h3>No audit entries yet</h3>
          <p>Actions like verify, update, delete, and sync will appear here.</p>
        </div>
      )}

      {/* Log entries */}
      {!query.isLoading && grouped.length > 0 && (
        <div className="audit-groups">
          {grouped.map((group) => (
            <div key={group.date} className="audit-group">
              <div className="audit-group-header">
                <span className="audit-group-date">{group.date}</span>
                <span className="audit-group-count">
                  {group.entries.length}{" "}
                  {group.entries.length === 1 ? "action" : "actions"}
                </span>
              </div>
              <div className="audit-group-entries">
                {group.entries.map((log) => {
                  const meta = ACTION_META[log.action] || {
                    icon: <Clock size={15} />,
                    color: "#5c6370",
                    bg: "#e4e6e9",
                  };
                  const detail = describeDetails(log.action, log.details);
                  const isFailed = !log.success;

                  return (
                    <div
                      key={log.id}
                      className={`audit-row${isFailed ? " audit-row--error" : ""}`}
                    >
                      {/* Icon */}
                      <div
                        className="audit-row-icon"
                        style={{
                          background: isFailed ? "#f4d6d6" : meta.bg,
                          color: isFailed ? "#a4243b" : meta.color,
                        }}
                      >
                        {isFailed ? (
                          <AlertTriangle size={15} />
                        ) : (
                          meta.icon
                        )}
                      </div>

                      {/* Main content */}
                      <div className="audit-row-body">
                        <div className="audit-row-top">
                          <span className="audit-row-action">
                            {log.actionLabel}
                          </span>
                          {detail && (
                            <span className="audit-row-detail">{detail}</span>
                          )}
                        </div>
                        <div className="audit-row-meta">
                          {log.targetName && (
                            <span className="audit-row-name">
                              {log.targetName}
                            </span>
                          )}
                          {log.targetId && (
                            <span className="audit-row-id">
                              {log.targetId}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Time */}
                      <div className="audit-row-time">
                        <span
                          className="audit-row-clock"
                          title={formatFullTimestamp(log.createdAt)}
                        >
                          {formatTime(log.createdAt)}
                        </span>
                        <span className="audit-row-relative">
                          {formatRelative(log.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="audit-pagination">
          <button
            className="audit-page-btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeft size={14} />
            Prev
          </button>
          <span className="audit-pagination-info">
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="audit-page-btn"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
