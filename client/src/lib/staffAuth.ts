import { trpc } from "@/lib/trpc";
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

  const { data: staff, isLoading, refetch } = trpc.staff.me.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const loginMutation = trpc.staff.login.useMutation({
    onSuccess: async (result) => {
      if (result.success && result.staff) {
        // Refetch staff.me so the query cache updates and the parent
        // component re-renders (loggedIn flips true) without a full reload.
        await refetch();
        if (result.staff.role === "volunteer") {
          navigate("/admin");
        }
        // For admin: no navigation needed — the caller's parent already
        // conditionally renders <Login /> vs dashboard based on `staff`.
      }
    },
    onError: (error) => {
      console.error("Login failed:", error);
    },
  });

  const logoutMutation = trpc.staff.logout.useMutation({
    onSuccess: async () => {
      try {
        sessionStorage.removeItem("manus-cookie");
      } catch {}
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