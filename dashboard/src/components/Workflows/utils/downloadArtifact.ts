import axios from 'axios';

/**
 * Download an artifact from GCS via the API
 * @param gcsPath - The GCS path of the artifact
 * @param filename - The filename to use for the download
 */
export async function downloadArtifact(gcsPath: string, filename: string): Promise<void> {
  const downloadUrl = `/api/workflows/artifacts/download?path=${encodeURIComponent(gcsPath)}`;
  const response = await axios.get<Blob>(downloadUrl, { responseType: 'blob' });
  const url = window.URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
