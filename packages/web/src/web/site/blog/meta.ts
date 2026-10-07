/** Small helpers shared by the blog pages, the prerender and structured data. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-01-08" → "January 8, 2026". Pure string maths, so server and browser always agree. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

export type Author = { name: string; role: string; initials: string; bio: string; url?: string };

const AUTHORS: Record<string, Author> = {
  "Dan Rosenblat": {
    name: "Dan Rosenblat",
    role: "Founder & CEO, NVC360",
    initials: "DR",
    bio: "Dan is the founder and CEO of NVC360, the Winnipeg company behind ArrivePing. Before building software, the NVC360 team ran a specialty subcontracting operation with more than 800 field technicians.",
    url: "https://arriveping.com/about",
  },
};

export function authorFor(name: string): Author {
  return (
    AUTHORS[name] ?? {
      name,
      role: "ArrivePing",
      initials: name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      bio: "",
    }
  );
}
