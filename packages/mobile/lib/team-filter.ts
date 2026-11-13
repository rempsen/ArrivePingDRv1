/**
 * What Today asks of the Team screen when it opens it, carried in route params
 * (`?status=` and `?mode=`). Expo Router drops null and undefined params when it
 * builds a link, so "everybody" can't be sent as null; it is the string "all".
 */
export const TEAM_ALL = "all";

export type TeamMode = "list" | "map";

/** `filter`: a status, or null for everybody. Left out when the request doesn't say. */
export interface TeamRequest {
  filter?: string | null;
  mode?: TeamMode;
}

/** The request in these route params, or null when there is none (a plain tab tap, an empty status). */
export function teamRequestFromParams(params: { status?: string; mode?: string }): TeamRequest | null {
  const request: TeamRequest = {};
  if (params.status) request.filter = params.status === TEAM_ALL ? null : params.status;
  if (params.mode === "list" || params.mode === "map") request.mode = params.mode;
  return request.filter !== undefined || request.mode !== undefined ? request : null;
}
