declare module 'alexa-cookie2' {
  type CookieResult = { cookie: string; cookieData: Record<string, unknown> };
  type Cb = (err: Error | null, result: CookieResult) => void;
  export function refreshAlexaCookie(formerRegistrationData: unknown, callback: Cb): void;
  export function generateAlexaCookie(email: string | null, password: string | null, options: Record<string, unknown>, callback: Cb): void;
}
