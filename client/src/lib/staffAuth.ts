import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

const STAFF_COOKIE_NAME = "hrs_staff_session_v2";

export interface StaffSession {
  id: number;
  username: string;
  displayName: string;
  role: "volunteer" | "admin";
  active: boolean;
}

export function useStaffAuth() {
  const [, navigate] = useLocation() as [string, (to: string) => void];
  const queryClient = useQueryClient();

  const {
    data: staff,
    isLoading,
    refetch,
  } = trpc.staff.me.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const loginMutation = trpc.staff.login.useMutation({
    onSuccess: async result => {
      if (result.success && result.staff) {
        // Single centralized cache sweep: mark every cached query stale and
        // refetch the mounted ones. Queries that errored with 401 before the
        // login (e.g. records fetched on a page the user hit first) and any
        // data left over from a previous session recover here — individual
        // pages do not need their own "refetch on login" wiring.
        // staff.me is part of this sweep, so `staff` resolves and the parent
        // re-renders (loggedIn flips true) without a full reload.
        await queryClient.invalidateQueries();
        if (result.staff.role === "volunteer") {
          navigate("/admin");
        }
        // For admin: no navigation needed — the caller's parent already
        // conditionally renders <Login /> vs dashboard based on `staff`.
      }
    },
    onError: error => {
      console.error("Login failed:", error);
    },
  });

  const logoutMutation = trpc.staff.logout.useMutation({
    onSuccess: async () => {
      try {
        sessionStorage.removeItem("manus-cookie");
      } catch {}
      // Forget "this browser has logged in" so the next visit shows the
      // login form immediately (no skeleton flash before it).
      try {
        localStorage.removeItem("hrs_had_session");
      } catch {}
      // Drop the ENTIRE query cache so nothing from this account's session
      // survives — the next login (as any user) starts clean.
      queryClient.clear();
      window.location.href = "/";
    },
  });

  const login = async (username: string, password: string) => {
    return loginMutation.mutateAsync({ username, password });
  };

  const logout = () => {
    return logoutMutation.mutateAsync();
  };

  return {
    staff: staff ?? null,
    isLoading,
    login,
    logout,
    isLoggingIn: loginMutation.isPending,
    isLoggingOut: logoutMutation.isPending,
  };
}
