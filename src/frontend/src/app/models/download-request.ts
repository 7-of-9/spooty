import type { DownloadReceipt, DownloadRequestStatus } from '../services/library.service';

export const DOWNLOAD_REQUEST_STORAGE = 'spooty.pending-download.v1';
export function validDownloadRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
}
export function validDownloadReceipt(value: any): value is DownloadReceipt {
  return !!value && [value.queued, value.skipped, value.reused ?? 0]
    .every(n => Number.isSafeInteger(n) && n >= 0) && (value.reused ?? 0) <= value.skipped;
}
export function validDownloadRequestStatus(value: any, id: string): value is DownloadRequestStatus {
  return value?.requestId === id && ['preparing', 'completed', 'interrupted', 'failed'].includes(value.state) &&
    Number.isSafeInteger(value.startedAt) && value.startedAt >= 0 && typeof value.destination === 'string' &&
    (value.finishedAt === null || (Number.isSafeInteger(value.finishedAt) && value.finishedAt >= value.startedAt)) &&
    (value.state === 'completed' || value.state === 'failed' ? value.finishedAt !== null : value.finishedAt === null) &&
    (value.state === 'completed' ? validDownloadReceipt(value.receipt) : value.receipt === null);
}
