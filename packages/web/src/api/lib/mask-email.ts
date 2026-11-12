/** `jane.doe@example.com` -> `j***@example.com`, for confirmations that shouldn't spell out the whole address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
