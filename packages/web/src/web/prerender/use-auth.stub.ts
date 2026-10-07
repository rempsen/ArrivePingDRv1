/**
 * Build-time stand-in for hooks/use-auth.ts, used only when the public pages
 * are rendered to static HTML (see vite/plugins/prerender-plugin.ts). The real
 * hook reads the session from the browser; at build time every visitor is
 * signed out.
 */
export function useAuth() {
  return {
    user: undefined,
    role: "customer" as const,
    isPending: false,
    isAuthed: false,
    sessionError: false,
    refetchSession: () => {},
  };
}
