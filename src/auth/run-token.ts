const encoder = new TextEncoder();

const decodeBearerToken = (authHeader: string | null): string | undefined => {
  if (!authHeader) return undefined;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return undefined;
  return token;
};

export const hasValidRunToken = async (request: Request, expectedToken: string): Promise<boolean> => {
  if (!expectedToken) return false;
  const token = decodeBearerToken(request.headers.get("authorization"));
  if (!token) return false;
  const a = encoder.encode(token);
  const b = encoder.encode(expectedToken);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
};
