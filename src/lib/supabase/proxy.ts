import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTE_PREFIXES = ["/_next", "/auth", "/error", "/login"];

export function shouldRedirectUnauthenticatedRequest(pathname: string) {
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  return !PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectToLogin(request: NextRequest, response: NextResponse) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const redirectResponse = NextResponse.redirect(loginUrl);
  response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    const response = NextResponse.next({ request });
    return shouldRedirectUnauthenticatedRequest(request.nextUrl.pathname) ? redirectToLogin(request, response) : response;
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const { data, error } = await supabase.auth.getUser();
  if ((error || !data.user) && shouldRedirectUnauthenticatedRequest(request.nextUrl.pathname)) {
    return redirectToLogin(request, response);
  }

  return response;
}
