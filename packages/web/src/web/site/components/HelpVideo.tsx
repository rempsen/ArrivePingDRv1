import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { articleBySlug } from "../support/articles";
import { clock, embedUrl, nextVideo, videoByKey, watchUrl, type HelpVideo } from "../support/videos";

/**
 * Help Center video player.
 *
 * - `LiteVideo` is the inline player used at the top of a guide: our own
 *   poster with a play button, swapped for the privacy-enhanced YouTube embed
 *   only when pressed. No request goes to YouTube before that.
 * - `VideoCard` is a thumbnail card that opens the shared player dialog.
 * - `VideoDialogProvider` owns one <dialog> for the page: chapters, the
 *   matching written guides and "Up next". The open video is mirrored in the
 *   URL (?v=key) so it can be linked to and survives a refresh.
 */

function PlayIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

export function LiteVideo({ video, start = 0, autoplay = false, label }: { video: HelpVideo; start?: number; autoplay?: boolean; label?: string }) {
  const [playing, setPlaying] = useState(autoplay);
  return (
    <div className="hv-frame">
      {playing ? (
        <iframe
          key={`${video.youtubeId}-${start}`}
          src={embedUrl(video, start)}
          title={video.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button type="button" className="hv-poster" onClick={() => setPlaying(true)} aria-label={label ?? `Play video: ${video.title} (${clock(video.seconds)})`}>
          <img src={video.poster} alt="" width={960} height={540} loading="lazy" decoding="async" />
          <span className="hv-poster__play">
            <PlayIcon size={26} />
          </span>
          <span className="hv-poster__time tnum">{clock(video.seconds)}</span>
        </button>
      )}
    </div>
  );
}

/** A thumbnail card. `variant="row"` is the compact list form used beside the featured video. */
export function VideoCard({ video, variant = "card" }: { video: HelpVideo; variant?: "card" | "row" }) {
  const { open } = useVideoDialog();
  return (
    <button type="button" className={`hv-card hv-card--${variant}`} onClick={() => open(video.key)}>
      <span className="hv-card__thumb">
        <img src={video.poster} alt="" width={960} height={540} loading="lazy" decoding="async" />
        <span className="hv-card__play" aria-hidden="true">
          <PlayIcon size={variant === "row" ? 14 : 18} />
        </span>
        <span className="hv-card__time tnum">{clock(video.seconds)}</span>
      </span>
      <span className="hv-card__text">
        <strong>{video.title}</strong>
        {variant === "card" && <span>{video.summary}</span>}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog                                                               */
/* ------------------------------------------------------------------ */

type Ctx = { open: (key: string, start?: number) => void };
const VideoDialogContext = createContext<Ctx>({ open: () => {} });
export const useVideoDialog = () => useContext(VideoDialogContext);

function setQuery(key: string | null) {
  const url = new URL(window.location.href);
  if (key) url.searchParams.set("v", key);
  else url.searchParams.delete("v");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

export function VideoDialogProvider({ children }: { children: ReactNode }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<{ key: string; start: number } | null>(null);

  const open = useCallback((key: string, start = 0) => {
    if (!videoByKey[key]) return;
    const d = dlg.current;
    if (d?.open) {
      // Chapter or "Up next" from lower in the dialog: bring the player back
      // into view so it doesn't start playing off-screen on short viewports.
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      d.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    } else {
      opener.current = document.activeElement as HTMLElement | null;
    }
    setState({ key, start });
    setQuery(key);
  }, []);

  // Deep link: /support/videos?v=create-a-job opens that video.
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("v");
    if (k && videoByKey[k]) open(k);
  }, [open]);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (state && !d.open) d.showModal();
  }, [state]);

  // A click on the backdrop (the <dialog> itself, outside the panel) closes it.
  // Escape closes it natively, so keyboard users already have a way out.
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === d) d.close();
    };
    d.addEventListener("click", onClick);
    return () => d.removeEventListener("click", onClick);
  }, []);

  const close = () => dlg.current?.close();
  const onClose = () => {
    setState(null);
    setQuery(null);
    opener.current?.focus?.();
  };

  const v = state ? videoByKey[state.key] : undefined;
  const next = v ? nextVideo(v.key) : undefined;
  const guides = v ? v.guides.map((s) => articleBySlug[s]).filter(Boolean) : [];

  return (
    <VideoDialogContext.Provider value={{ open }}>
      {children}
      <dialog
        ref={dlg}
        className="hv-dialog"
        aria-labelledby="hv-dialog-title"
        onClose={onClose}
      >
        {v && state && (
          <div className="hv-dialog__panel">
            <header className="hv-dialog__head">
              <div>
                <span className="eyebrow">Video · {clock(v.seconds)}</span>
                <h2 id="hv-dialog-title">{v.title}</h2>
              </div>
              <button type="button" className="hv-dialog__close" onClick={close} aria-label="Close video">
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <LiteVideo key={`${v.key}-${state.start}`} video={v} start={state.start} autoplay />

            <div className="hv-dialog__body">
              <p className="hv-dialog__summary">{v.summary}</p>

              {v.chapters && (
                <div className="hv-chapters">
                  <p className="legal__toc-label">Jump to</p>
                  <ol>
                    {v.chapters.map((c) => (
                      <li key={c.at}>
                        <button type="button" onClick={() => open(v.key, c.at)} aria-current={state.start === c.at ? "true" : undefined}>
                          <span className="tnum">{clock(c.at)}</span>
                          {c.title}
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="hv-dialog__foot">
                {guides.length > 0 && (
                  <div className="hv-dialog__guides">
                    <p className="legal__toc-label">Read the guide</p>
                    <ul>
                      {guides.map((g) => (
                        <li key={g.slug}>
                          <a href={`/support/${g.slug}`}>{g.title}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {next && (
                  <button type="button" className="hv-next" onClick={() => open(next.key)}>
                    <span className="hv-next__label">Up next</span>
                    <span className="hv-next__title">{next.title}</span>
                    <span className="hv-next__time tnum">{clock(next.seconds)}</span>
                  </button>
                )}
              </div>
              <p className="small hv-dialog__yt">
                <a href={watchUrl(v)} target="_blank" rel="noopener">
                  Watch on YouTube
                </a>{" "}
                · Real ArrivePing screens, AI narration.
              </p>
            </div>
          </div>
        )}
      </dialog>
    </VideoDialogContext.Provider>
  );
}
