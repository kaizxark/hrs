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
  const utils = trpc.useUtils();

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
        // Immediately seed the query cache with the returned staff session.
        // This causes `useStaffAuth()` and `loggedIn` in the parent to resolve
        // SYNCHRONOUSLY without waiting for a separate round trip to staff.me,
        // eliminating the delay/flicker after pressing Sign In.
        utils.staff.me.setData(undefined, result.staff);
        try {
          localStorage.setItem("hrs_had_session", "1");
        } catch {}

        // Invalidate and refresh other cached queries (e.g. records, audit logs)
        queryClient.invalidateQueries({
          predicate: query => {
            const key = query.queryKey;
            return !(Array.isArray(key) && key[0] === "staff" && key[1] === "me");
          },
        });

        if (result.staff.role === "volunteer") {
          navigate("/admin");
        }
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
      try {
        localStorage.removeItem("hrs_had_session");
      } catch {}
      utils.staff.me.setData(undefined, null);
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
