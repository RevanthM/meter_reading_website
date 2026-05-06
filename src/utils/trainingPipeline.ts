/** Last path segment of a training folder prefix, e.g. `my-batch_1738234567890`. */
export function folderPrefixToSegment(folderPrefix: string): string {
  const t = folderPrefix.replace(/\/+$/, '');
  const i = t.lastIndexOf('/');
  return i >= 0 ? t.slice(i + 1) : t;
}

export function pipelineDetailPath(segment: string): string {
  return `/training/pipeline/${encodeURIComponent(segment)}`;
}
