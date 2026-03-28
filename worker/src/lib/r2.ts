export async function uploadResume(
  bucket: R2Bucket, file: File, prefix = 'resumes'
): Promise<{ key: string; filename: string }> {
  const ts       = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key      = `${prefix}/${ts}_${safeName}`;
  await bucket.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type || 'application/octet-stream',
      contentDisposition: `attachment; filename="${file.name}"`,
    },
    customMetadata: { originalName: file.name, uploadedAt: new Date().toISOString() },
  });
  return { key, filename: file.name };
}

export async function getResume(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function deleteResume(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}
