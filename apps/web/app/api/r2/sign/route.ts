import { id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { RequestError } from '@/lib/members/errors';
import { signObject, signSharedKey } from '@/lib/r2/service';

const signQuery = z.object({
  comparison: id.optional(),
  /** A public share token (04 §5): signs objects of the shared comparison without a session. */
  token: z.string().min(1).max(128).optional(),
  key: z.string().min(1).max(1024),
  /** `1`: answer with a redirect to the signed URL, for `<img src>`. */
  redirect: z.enum(['0', '1']).optional(),
});

/**
 * GET /api/r2/sign?key=…&comparison=… (09 §1): viewer+ gets a short-lived (1 h) signed GET URL
 * for an object of a comparison of their project. Keys of other runs, comparisons or projects are
 * refused. With `token`, a share viewer gets the same for the shared comparison only; this route is
 * public in the proxy for that reason and checks the session itself otherwise.
 */
export async function GET(request: NextRequest) {
  const query = signQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return validationResponse(query.error.issues);
  try {
    const { comparison, key, token } = query.data;
    let signed: { url: string; expiresAt: string };
    if (token !== undefined) {
      signed = await signSharedKey({ token, comparisonId: comparison, key });
    } else {
      if (!comparison) return validationResponse([{ path: ['comparison'], message: 'Required' }]);
      const user = await getCurrentUser();
      if (!user) throw new RequestError(401, 'unauthorized', 'Sign in to view report images');
      signed = await signObject(user, { comparisonId: comparison, key });
    }
    // Browsers may reuse the answer for a while, well before the signature expires.
    const headers = { 'cache-control': 'private, max-age=600' };
    if (query.data.redirect === '1') {
      return NextResponse.redirect(signed.url, { status: 302, headers });
    }
    return NextResponse.json(signed, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
