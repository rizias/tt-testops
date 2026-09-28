import { ApiError, TestOpsError } from '../errors.js';
import type { HttpContext } from './http.js';

export type AttachmentResult =
  | { ok: true; bytes: Buffer; contentType: string }
  | { ok: false; reason: string; transient: boolean };

const connectionLost = (e: unknown): boolean =>
  !(e instanceof TestOpsError) || (e instanceof ApiError && e.kind === 'network');

export async function fetchAttachment(
  ctx: HttpContext,
  attachmentId: number,
  shared: boolean,
): Promise<AttachmentResult> {
  const url = ctx.url(
    shared
      ? `/api/sharedstep/attachment/${attachmentId}/content`
      : `/api/testcase/attachment/${attachmentId}/content`,
  );
  try {
    const h = await ctx.authHeaders('*/*');
    const r = await ctx.port.get(url, h);
    if (!r.ok) return { ok: false, reason: `сервер ответил ${r.status}`, transient: r.status >= 500 };
    if (!r.arrayBuffer) return { ok: false, reason: 'ответ без содержимого', transient: false };
    const bytes = Buffer.from(await r.arrayBuffer());
    return {
      ok: true,
      bytes,
      contentType: r.headers?.get('content-type') ?? 'application/octet-stream',
    };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'связь оборвалась', transient: connectionLost(e) };
  }
}
