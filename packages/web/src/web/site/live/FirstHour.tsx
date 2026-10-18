import { firstHour } from "../config";
import { SetupFilm } from "./SetupFilm";
import { SetupTry } from "./SetupTry";

/**
 * Getting started: the most important section on the site.
 *
 * The setup film is the star: the onboarding agent reading a plumber's
 * website and building its workspace, beat by beat. Straight under it, the
 * visitor's turn (their website + work email → signup, and a HubSpot lead).
 * Then the rest of the first hour as a timeline, so "within the hour" is
 * something they can see, not just a claim.
 */
export function FirstHour() {
  const steps = firstHour.milestones;
  return (
    <section id="getting-started" className="section section--divided anchor fh" aria-labelledby="fh-title">
      <div className="container">
        <div className="fh-head" data-reveal="">
          <span className="eyebrow">{firstHour.eyebrow}</span>
          <h2 id="fh-title" className="h-section">
            {firstHour.title} <span className="h-muted">{firstHour.titleMuted}</span>
          </h2>
          <p className="lede">{firstHour.body}</p>
        </div>

        <SetupFilm />
        <SetupTry />

        <div className="fh-hour" data-reveal="">
          <h3 className="fh-hour__title">{firstHour.stepsTitle}</h3>
          <ol className="fh-steps">
            {steps.map((m, i) => (
              <li key={m.title} className="fh-step" style={{ "--i": i } as React.CSSProperties}>
                <span className="fh-step__at tnum">{m.at}</span>
                <span className="fh-step__dot" aria-hidden="true" />
                <strong>{m.title}</strong>
                <span className="fh-step__body">{m.body}</span>
              </li>
            ))}
          </ol>
          <p className="fh-note">{firstHour.note}</p>
        </div>
      </div>
    </section>
  );
}
