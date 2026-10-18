import { useEffect, useRef } from "react";
import { useAuth } from "../hooks/use-auth";
import { PlaybackProvider, usePlayback } from "../site/motion/playback";
import { useReveal } from "../site/motion/use-reveal";
import { scrollToAnchor, useHeaderOffset } from "../site/motion/use-scrollspy";
import { SiteHeader } from "../site/components/SiteHeader";
import { SiteFooter } from "../site/components/SiteFooter";
import { Audiences, Pricing, FAQ, OurStory, ClosingCTA } from "../site/sections";
import { HeroFilm } from "../site/live/HeroFilm";
import { CustomerView } from "../site/live/CustomerView";
import { DispatchStory } from "../site/live/DispatchStory";
import { TechApp } from "../site/live/TechApp";
import { FirstHour } from "../site/live/FirstHour";
import { OfficeView } from "../site/live/OfficeView";
import { Integrations } from "../site/live/Integrations";
import { usePageMeta } from "../site/seo/head";
import "../site/site.css";
import "../site/live/live.css";
import "../site/live/opening.css";
import "../site/live/lower.css";
import { homeFor } from "../lib/home";

/** Marketing landing page — Attio-inspired light design language, scoped under `.site`. */
export default function Index() {
  return (
    <PlaybackProvider>
      <Page />
    </PlaybackProvider>
  );
}

function Page() {
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const { isAuthed, role } = useAuth();
  const { reduced } = usePlayback();

  const dashboardHref = isAuthed ? homeFor(role) : undefined;

  useReveal(rootRef);
  useHeaderOffset(headerRef, rootRef);

  // Deep links (`/#arrivals`) land below the fixed header once layout settles.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToAnchor(id, true));
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The marketing page shares the dark ink canvas with the product console (no flash between them).
  useEffect(() => {
    const prev = document.documentElement.style.backgroundColor;
    document.documentElement.style.backgroundColor = "#070b12";
    return () => {
      document.documentElement.style.backgroundColor = prev;
    };
  }, []);
  // Title, description, canonical, Open Graph and JSON-LD (also prerendered into the HTML).
  usePageMeta("/");

  return (
    <div className="site" ref={rootRef} data-reduced={reduced ? "true" : undefined}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader ref={headerRef} dashboardHref={dashboardHref} />
      <main id="main" tabIndex={-1}>
        <HeroFilm />
        <CustomerView />
        <DispatchStory />
        <TechApp />
        <FirstHour />
        <OfficeView />
        <Integrations />
        <Audiences />
        <Pricing />
        <FAQ />
        <OurStory />
        <ClosingCTA />
      </main>
      <SiteFooter />
    </div>
  );
}
