import { useEffect, useRef, type ReactNode } from "react";
import { useAuth } from "../../hooks/use-auth";
import { PlaybackProvider } from "../motion/playback";
import { useReveal } from "../motion/use-reveal";
import { useHeaderOffset } from "../motion/use-scrollspy";
import { usePageMeta } from "../seo/head";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

/** Header, footer, reveal motion and page metadata shared by the public content pages. */
export function MarketingShell({ path, children }: { path: string; children: ReactNode }) {
  return (
    <PlaybackProvider>
      <Shell path={path}>{children}</Shell>
    </PlaybackProvider>
  );
}

function Shell({ path, children }: { path: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const { isAuthed, role } = useAuth();
  const dashboardHref = isAuthed ? (role === "admin" ? "/admin" : role === "rider" ? "/rider" : "/app") : undefined;

  useReveal(rootRef);
  useHeaderOffset(headerRef, rootRef);
  usePageMeta(path);

  useEffect(() => {
    const prev = document.documentElement.style.backgroundColor;
    document.documentElement.style.backgroundColor = "#070b12";
    return () => {
      document.documentElement.style.backgroundColor = prev;
    };
  }, []);

  return (
    <div className="site" ref={rootRef}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader ref={headerRef} dashboardHref={dashboardHref} />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
