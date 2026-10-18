import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, MapPinned, MessageSquareText, CalendarRange, Compass, Play } from "lucide-react";
import { Modal } from "../components/modal";
import { useAuth } from "../hooks/use-auth";
import { useWorkerNoun, useCustomerNoun } from "../lib/use-brand";
import { apiFetch, apiHeaders } from "../lib/api";
import type { OnboardingState } from "../../shared/onboarding";
import { useGuide } from "./GuideProvider";
import { chapterById } from "./registry";

/**
 * First-login Welcome sheet (Notion pattern): one screen, three optional
 * questions, then straight into the first guided chapter. Shown once per
 * person per company — the only part of the Guide that ever opens by itself.
 *
 * For a brand-new admin the AI setup chat ("Let's finish setting up") runs
 * first; the Welcome waits until that is finished or set aside.
 */
type Goal = NonNullable<OnboardingState["goal"]>;
type Persona = NonNullable<OnboardingState["persona"]>;
type TeamSize = NonNullable<OnboardingState["teamSize"]>;

/** Which chapter each goal opens. Updated as chapters ship. */
const GOAL_CHAPTER: Record<Goal, string> = {
  track: "find-your-way",
  eta: "find-your-way",
  schedule: "scheduler",
  explore: "find-your-way",
};

const WELCOME_VIDEO = {
  src: "/media/welcome/arriveping-welcome-720p.mp4",
  poster: "/media/welcome/arriveping-welcome-poster.webp",
  captions: "/media/welcome/arriveping-welcome.en.vtt",
};

const OFFICE_ROLES = new Set(["admin", "superadmin", "manager", "dispatcher", "project_manager"]);

export function WelcomeSheet() {
  const { user, role } = useAuth();
  const { state, save, startChapter, activeChapterId } = useGuide();
  const worker = useWorkerNoun();
  const customer = useCustomerNoun();
  const isAdmin = role === "admin" || role === "superadmin";

  // Admins: wait for the AI setup chat to be finished or set aside.
  const setupQ = useQuery({
    queryKey: ["onboarding", "status"],
    queryFn: async () => {
      const res = await apiFetch("/api/onboarding/status", { headers: apiHeaders() });
      return (await res.json()) as { checklist: { done: boolean } };
    },
    enabled: isAdmin,
    staleTime: 30_000,
  });
  const setupDone = !isAdmin || Boolean(setupQ.data?.checklist.done);

  const shouldShow =
    OFFICE_ROLES.has(role) && state !== null && !state.welcomeDoneAt && setupDone && !activeChapterId;

  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (shouldShow) setOpen(true);
  }, [shouldShow]);

  const [persona, setPersona] = useState<Persona | undefined>();
  const [teamSize, setTeamSize] = useState<TeamSize | undefined>();
  const [goal, setGoal] = useState<Goal>("explore");
  const [playVideo, setPlayVideo] = useState(false);
  const [videoAvailable, setVideoAvailable] = useState(false);

  // Only offer the video once the file is actually deployed.
  useEffect(() => {
    if (!open) return;
    fetch(WELCOME_VIDEO.poster, { method: "HEAD" })
      .then((r) => setVideoAvailable(r.ok && (r.headers.get("content-type") ?? "").startsWith("image/")))
      .catch(() => setVideoAvailable(false));
  }, [open]);

  const firstName = ((user as { name?: string } | undefined)?.name ?? "").split(" ")[0];
  const goals = useMemo(
    () =>
      [
        { id: "track" as const, icon: MapPinned, title: `See my ${worker.nounPlural.toLowerCase()} live`, sub: "The map and who's where" },
        { id: "eta" as const, icon: MessageSquareText, title: `Send ${customer.nounPlural.toLowerCase()} a live ETA`, sub: "On-the-way texts and tracking" },
        { id: "schedule" as const, icon: CalendarRange, title: "Plan my week", sub: "Scheduler and calendar views" },
        { id: "explore" as const, icon: Compass, title: "Just look around", sub: "A quick tour of the menu" },
      ],
    [worker.nounPlural, customer.nounPlural],
  );

  if (!open) return null;

  const finish = (start: boolean) => {
    setOpen(false);
    void save({ persona, teamSize, goal, welcomeDoneAt: new Date().toISOString() });
    if (start) {
      const id = GOAL_CHAPTER[goal];
      if (chapterById[id]) startChapter(id, "welcome");
    }
  };

  const chip = (selected: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors ${
      selected ? "bg-brand/15 text-white ring-brand" : "text-slate-300 ring-white/10 hover:bg-white/[0.04]"
    }`;

  return (
    <Modal
      open={open}
      onClose={() => finish(false)}
      title={firstName ? `Welcome to ArrivePing, ${firstName}` : "Welcome to ArrivePing"}
      subtitle="Three quick questions so we can show you the right things first. All optional."
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => finish(false)}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-400 hover:text-white"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={() => finish(true)}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-deep"
          >
            Show me around
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {videoAvailable && (
          <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
            {playVideo ? (
              <video
                aria-label="Welcome to ArrivePing video"
                className="aspect-video w-full bg-black"
                src={WELCOME_VIDEO.src}
                poster={WELCOME_VIDEO.poster}
                controls
                autoPlay
                playsInline
              >
                <track kind="captions" src={WELCOME_VIDEO.captions} srcLang="en" label="English" default />
              </video>
            ) : (
              <button
                type="button"
                onClick={() => setPlayVideo(true)}
                className="group relative block w-full"
                aria-label="Play the one-minute welcome video"
              >
                <img src={WELCOME_VIDEO.poster} alt="" className="aspect-video w-full object-cover" />
                <span className="absolute inset-0 grid place-items-center bg-black/30 transition-colors group-hover:bg-black/20">
                  <span className="flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-ink shadow-lg">
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" /> Watch the 1-minute welcome
                  </span>
                </span>
              </button>
            )}
          </div>
        )}

        <fieldset>
          <legend className="text-sm font-semibold text-white">What's your role?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                ["owner", "Owner"],
                ["dispatcher", "Dispatcher"],
                ["manager", "Manager"],
                ["other", "Something else"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={persona === id} onClick={() => setPersona(id)} className={chip(persona === id)}>
                {persona === id && <Check className="h-3.5 w-3.5 text-brand" aria-hidden="true" />}
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-white">How many {worker.nounPlural.toLowerCase()} do you send out?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["1-2", "3-9", "10-29", "30+"] as const).map((id) => (
              <button key={id} type="button" aria-pressed={teamSize === id} onClick={() => setTeamSize(id)} className={chip(teamSize === id)}>
                {teamSize === id && <Check className="h-3.5 w-3.5 text-brand" aria-hidden="true" />}
                {id.replace("-", "–")}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-white">What do you want to see first?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {goals.map((g) => (
              <button
                key={g.id}
                type="button"
                aria-label={`${g.title}: ${g.sub}`}
                aria-pressed={goal === g.id}
                onClick={() => setGoal(g.id)}
                className={`flex items-start gap-3 rounded-xl p-3 text-left ring-1 transition-colors ${
                  goal === g.id ? "bg-brand/10 ring-brand" : "ring-white/10 hover:bg-white/[0.03]"
                }`}
              >
                <g.icon className={`mt-0.5 h-5 w-5 shrink-0 ${goal === g.id ? "text-brand" : "text-slate-500"}`} aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold text-white">{g.title}</span>
                  <span className="block text-xs text-slate-400">{g.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <p className="text-xs text-slate-500">
          You can replay any guide later from <span className="font-semibold text-slate-300">Guide &amp; help</span> in the menu.
        </p>
      </div>
    </Modal>
  );
}
