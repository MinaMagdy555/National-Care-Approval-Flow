export const MAX_UPLOAD_SIZE_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB || 50);
export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
export const ALLOWED_UPLOAD_EXTENSIONS = ['png', 'jpg', 'jpeg', 'mp4', 'pdf'];

export function uploadLimitLabel() {
  return `${MAX_UPLOAD_SIZE_MB}MB`;
}

export function uploadLimitHelpText() {
  return MAX_UPLOAD_SIZE_MB <= 50
    ? 'Only PNG, JPG, MP4, or PDF files up to 50MB are allowed. Compress the file or raise VITE_MAX_UPLOAD_MB for larger Drive uploads.'
    : `Only PNG, JPG, MP4, or PDF files up to ${uploadLimitLabel()} are allowed.`;
}
