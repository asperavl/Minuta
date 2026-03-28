import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        }
      }
    }
  )

  // ALWAYS use getUser() not getSession()
  // getSession() does not verify with Auth server and must not be used for authorization
  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  const isPublicRoute =
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/auth')

  // Authenticated users visiting landing page go to dashboard
  if (user && pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Unauthenticated users visiting protected routes go to login
  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
