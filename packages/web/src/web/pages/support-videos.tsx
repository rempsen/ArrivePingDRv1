import { HelpShell, ContactCard } from "../site/components/HelpShell";
import { VideoCard, VideoDialogProvider, useVideoDialog } from "../site/components/HelpVideo";
import { clock, liveVideos, videoByKey, videoGroups, videosIn } from "../site/support/videos";

/**
 * Help Center videos — https://arriveping.com/support/videos
 *
 * Every how-to, grouped by what you're trying to get done. Cards open the
 * shared player dialog; ?v=<key> deep-links straight to one video.
 */
export default function SupportVideosPage() {
  return (
    <HelpShell path="/support/videos">
      <VideoDialogProvider>
        <main id="main" tabIndex={-1} className="help">
          <header className="help-hero hv-hero">
            <div className="container help-hero__inner">
              <nav className="help-article__crumbs" aria-label="Breadcrumb">
                <a href="/support">Help Center</a>
                <span aria-hidden="true">›</span>
                <span>Videos</span>
              </nav>
              <h1 className="help-hero__title">Video guides</h1>
              <p className="help-hero__lede">
                {liveVideos.length} short videos on real ArrivePing screens. Watch them in order for a full tour, or pick the task in front of
                you.
              </p>
              <StartHere />
            </div>
          </header>

          {videoGroups.map((g) => {
            const list = videosIn(g.id).filter((v) => v.key !== "walkthrough");
            if (!list.length) return null;
            return (
              <section key={g.id} id={g.id} className="help__section container anchor" aria-labelledby={`hv-${g.id}-h`}>
                <div className="help__section-head hv-head">
                  <div>
                    <h2 id={`hv-${g.id}-h`}>{g.title}</h2>
                    <p>{g.blurb}</p>
                  </div>
                  <span className="hv-meta tnum">
                    {list.length} {list.length === 1 ? "video" : "videos"} · about {Math.max(1, Math.round(list.reduce((t, v) => t + v.seconds, 0) / 60))} min
                  </span>
                </div>
                <ul className="hv-grid">
                  {list.map((v) => (
                    <li key={v.key}>
                      <VideoCard video={v} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <section className="help__section container help__split" aria-label="More help">
            <div>
              <div className="help__section-head">
                <h2>Prefer to read?</h2>
                <p>
                  Every video has a step-by-step guide in the <a href="/support">Help Center</a>, with the exact menu names. The videos are
                  also on our <a href="https://www.youtube.com/@arriveping" target="_blank" rel="noopener">YouTube channel</a>.
                </p>
              </div>
            </div>
            <ContactCard compact />
          </section>
        </main>
      </VideoDialogProvider>
    </HelpShell>
  );
}

/** The walkthrough as a single "start here" call to action in the hero. */
function StartHere() {
  const { open } = useVideoDialog();
  const walk = videoByKey.walkthrough;
  if (!walk) return null;
  return (
    <button type="button" className="hv-start" onClick={() => open(walk.key)} aria-label={`Play the full walkthrough: ${walk.title} (${clock(walk.seconds)})`}>
      <span className="hv-start__thumb">
        <img src={walk.poster} alt="" width={960} height={540} decoding="async" />
        <span className="hv-card__play" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
          </svg>
        </span>
      </span>
      <span className="hv-start__text">
        <span className="eyebrow">New here? Start with this · {clock(walk.seconds)}</span>
        <strong>{walk.title}</strong>
        <span>{walk.chapters?.length ?? 0} chapters, from sign-up to your first dispatched job.</span>
      </span>
    </button>
  );
}
