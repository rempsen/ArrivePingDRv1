import { useEffect, useRef, useState } from "react";
import { slot as getSlot, type MediaSlot as Slot } from "../media";
import { scenes } from "../scenes";
import { usePlayback } from "../motion/playback";
import { useInView } from "../motion/use-scene-clock";
import { brand, footageLabel, illustrativeLabel } from "../config";
import { liveTrip } from "../live-trip-geometry";
import { LiveTripOverlay } from "./LiveTripOverlay";

/**
 * A replaceable motion slot. Renders supplied video when the manifest says
 * so and the source loads; otherwise the DOM/SVG fallback scene. Layout
 * (aspect ratio, radius, label position) is owned here so swapping media
 * never moves the page.
 */
export function MediaSlot({ id, className = "", raised = false }: { id: string; className?: string; raised?: boolean }) {
  const s = getSlot(id);
  const [videoFailed, setVideoFailed] = useState(false);
  const useVideo = s.kind === "video" && !!s.desktopSrc && !videoFailed;
  const Scene = scenes[s.fallbackScene];

  return (
    <figure
      className={`slot${raised ? " slot--raised" : ""} ${className}`.trim()}
      data-slot={s.id}
      style={{ "--ar": s.aspectRatio, "--ar-m": s.mobileAspectRatio ?? s.aspectRatio } as React.CSSProperties}
    >
      {useVideo ? <SlotVideo slot={s} onFail={() => setVideoFailed(true)} /> : <Scene />}
      <figcaption className="visually-hidden">
        {useVideo ? footageLabel : illustrativeLabel}: {s.accessibleSummary}
      </figcaption>
    </figure>
  );
}

function SlotVideo({ slot, onFail }: { slot: Slot; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const { paused, hidden, reduced } = usePlayback();
  const inView = useInView(ref, 0.35);
  const shouldPlay = inView && !paused && !hidden && !reduced;
  const mobile = typeof window !== "undefined" && window.innerWidth < 768 && !!slot.mobileSrc;
  const src = mobile ? slot.mobileSrc : slot.desktopSrc;
  // Live technician layer for recordings that show the customer's arrival map
  const trip = liveTrip(mobile ? slot.liveTrip?.mobile : slot.liveTrip?.desktop);
  // Each video ships with a same-named poster ("x.mp4" → "x-poster.jpg"), so the mobile cut gets its own poster.
  const poster = slot.posterSrc && src ? src.replace(/\.mp4$/, "-poster.jpg") : slot.posterSrc;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (shouldPlay) void v.play().catch(() => {});
    else v.pause();
  }, [shouldPlay]);

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- decorative, muted, looping background media with no audio track */}
      <video
        ref={ref}
        className="slot__media"
        style={{ objectFit: slot.fit }}
        src={src}
        poster={poster}
        muted={slot.muted}
        loop={slot.repeat}
        playsInline
        preload="metadata"
        onError={onFail}
        aria-hidden="true"
      />
      {trip ? <LiveTripOverlay geo={trip} videoRef={ref} playing={shouldPlay} /> : null}
      {/* Real-footage mark: a subtle ArrivePing logo (the figcaption carries the text for screen readers) */}
      <span className="slot__label slot__label--brand" aria-hidden="true">
        <img className="slot__brand slot__brand--on-dark" src={brand.logoLight} alt="" width={41} height={12} />
        <img className="slot__brand slot__brand--on-light" src={brand.logoDark} alt="" width={41} height={12} />
      </span>
    </>
  );
}
