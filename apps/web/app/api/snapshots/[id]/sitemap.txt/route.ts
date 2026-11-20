import { formatSitemapTxt } from '@vrt/engine';
import { id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { RequestError } from '@/lib/members/errors';
import { fetchAllSnapshotUrls } from '@/lib/sitemap/queries';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/snapshots/:id/sitemap.txt (F-SITEMAP-2): viewer+ downloads the included URLs in the
 * prototype `sitemap.txt` format. Visibility is enforced by RLS on the snapshot.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const snapshotId = id.safeParse((await params).id);
  if (!snapshotId.success) return validationResponse(snapshotId.error.issues);
  try {
    if (!(await getCurrentUser())) {
      throw new RequestError(401, 'unauthorized', 'Sign in to download the sitemap');
    }
    const supabase = await createClient();
    const { data: snapshot, error } = await supabase
      .from('sitemap_snapshots')
      .select('id, status')
      .eq('id', snapshotId.data)
      .maybeSingle();
    if (error) throw new Error(`Could not load the snapshot: ${error.message}`);
    if (!snapshot) throw new RequestError(404, 'not_found', 'Snapshot not found');
    if (snapshot.status !== 'completed') {
      throw new RequestError(422, 'business_rule', 'Only completed snapshots can be exported');
    }
    const rows = await fetchAllSnapshotUrls(supabase, snapshot.id);
    return new NextResponse(formatSitemapTxt(rows), {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': 'attachment; filename="sitemap.txt"',
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
