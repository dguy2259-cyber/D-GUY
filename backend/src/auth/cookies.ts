export function sessionCookieOptions(secure: boolean, httpOnly: boolean, maxAge?: number) {
  return {
    httpOnly,
    secure,
    sameSite: 'lax' as const,
    path: '/' as const,
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}
