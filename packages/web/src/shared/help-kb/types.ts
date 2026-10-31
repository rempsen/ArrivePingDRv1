/**
 * The ArrivePing screen map: every screen of every app, what each control on
 * it does, and step-by-step answers to the questions people ask about it.
 *
 * It's written from the source code (the real button labels), one file per
 * area, and powers "Ask ArrivePing" on the public Help Center, in the office
 * dashboard and in the mobile apps. Keep it true to the code: when a screen
 * changes, change its entry in the same pull request.
 *
 * Words a company renames (Jobs → Work orders, Technicians → Installers,
 * Customers → Clients) are written as placeholders: {job} {jobs} {worker}
 * {workers} {customer} {customers}. The assistant swaps in the company's own
 * words when it knows them, and the defaults otherwise.
 */

/** Which app the screen lives in. */
export type KbSurface =
  | "office-web" //   the office dashboard in a browser (computer or iPad)
  | "office-mobile" // the office side of the iPhone/iPad/Android app
  | "tech-app" //     the technician side of the iPhone/Android app
  | "customer" //     what a company's own customer sees (tracking page, booking form, texts, emails)
  | "account"; //     signing up, signing in, passwords, joining a company

export type KbPlatform = "web" | "ios" | "android";
export type KbRole = "admin" | "manager" | "dispatcher" | "technician" | "customer" | "anyone";

export interface KbControl {
  /** The label exactly as it appears on screen (or a short description for an icon). */
  label: string;
  /** What pressing / changing it does, in one or two sentences. */
  does: string;
}

export interface KbTask {
  /** The question as a person would ask it ("How do I move a job to another day?"). */
  q: string;
  /** Imperative steps naming the real buttons, in order. 2–8 steps. */
  steps: string[];
  /** Optional one-line note: a limit, a permission needed, a gotcha. */
  note?: string;
}

export interface KbFix {
  /** What the person sees or says ("Technician isn't showing on the map"). */
  problem: string;
  /** Why it happens and what to do, in one to three sentences. */
  fix: string;
}

export interface KbEntry {
  /** Unique, stable: "<surface>.<area>.<screen>", e.g. "office-web.settings.skill-classes". */
  id: string;
  /** The screen's name as people know it ("Scheduler", "Job details"). */
  title: string;
  surface: KbSurface;
  platforms: KbPlatform[];
  /** Who uses this screen. */
  roles: KbRole[];
  /** How to get there from the app's home, naming each tap ("Sidebar → Setup → Settings → Skill Classes tab"). */
  path: string;
  /** Web route or app screen when there is one ("/admin/settings?tab=skill-classes"). */
  route?: string;
  /** The permission needed to see it, if any (from shared/office-pages.ts). */
  permission?: string;
  /** What the screen is for, in one or two sentences. */
  summary: string;
  controls: KbControl[];
  tasks: KbTask[];
  fixes?: KbFix[];
  /** Other words people might search with ("calendar", "dispatch board"). */
  keywords?: string[];
}
