/**
 * How Today asks the Team screen to open: `null` is "show everybody", a string
 * is that status. The request is consumed once when Team gains focus, so a plain
 * tap on the Team tab keeps whatever chip was picked last.
 *
 * It travels here, not in the route's params: Expo Router drops null and
 * undefined params when it builds the link, so "no filter" can't be told apart
 * from "no request" there.
 */
export type TeamFilterRequest = { status: string | null };

let pending: TeamFilterRequest | undefined;

export function requestTeamFilter(status: string | null): void {
  pending = { status };
}

/** The waiting request, if any; asking again returns nothing until a new one is made. */
export function takeTeamFilterRequest(): TeamFilterRequest | undefined {
  const request = pending;
  pending = undefined;
  return request;
}
