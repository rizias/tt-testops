import type { TestOpsPort } from './port.js';

export type AttachmentResult =
  | { ok: true; bytes: Buffer; contentType: string }
  | { ok: false; reason: string; retriable: boolean };

export interface HttpContext {
  port: TestOpsPort;
  url: (path: string) => string;
  authHeaders: (accept?: string) => Promise<Record<string, string>>;
}

export async function fetchAttachmentBytes(
  ctx: HttpContext,
  attachmentId: number,
  shared = false,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const got = await attachmentAttempt(ctx, attachmentId, shared);
  return got.ok ? { bytes: got.bytes, contentType: got.contentType } : null;
}

export async function fetchAttachment(
  ctx: HttpContext,
  attachmentId: number,
  shared = false,
): Promise<AttachmentResult> {
  return attachmentAttempt(ctx, attachmentId, shared);
}

async function attachmentAttempt(
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
    if (!r.ok)
      return {
        ok: false,
        reason: `сервер ответил ${r.status}`,
        retriable: false,
      };
    if (!r.arrayBuffer) return { ok: false, reason: 'ответ без содержимого', retriable: false };
    const bytes = Buffer.from(await r.arrayBuffer());
    return {
      ok: true,
      bytes,
      contentType: r.headers?.get('content-type') ?? 'application/octet-stream',
    };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'связь оборвалась', retriable: false };
  }
}
