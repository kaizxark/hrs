const ADMIN_SESSION_KEY = "hrs-admin-session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type StoredAdminSession = {
  username: string;
  token: string;
  expiresAt: number;
};

function canUseStorage() {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

export function saveAdminSession(username: string) {
  if (!canUseStorage()) return;
  const session: StoredAdminSession = {
    username,
    token: crypto.randomUUID(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

export function getAdminSession(): StoredAdminSession | null {
  if (!canUseStorage()) return null;
  try {
    const stored = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!stored) return null;
    const session = JSON.parse(stored) as Partial<StoredAdminSession>;
    if (
      !session.username ||
      !session.token ||
      !session.expiresAt ||
      session.expiresAt <= Date.now()
    ) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return null;
    }
    return session as StoredAdminSession;
  } catch {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    return null;
  }
}

export function clearAdminSession() {
  if (!canUseStorage()) return;
  localStorage.removeItem(ADMIN_SESSION_KEY);
}
