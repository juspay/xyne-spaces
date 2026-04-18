import axios from 'axios';

/**
 * Download an artifact from storage via the API
 * @param storagePath - The storage path of the artifact
 * @param filename - The filename to use for the download
 */
export async function downloadArtifact(storagePath: string, filename: string): Promise<void> {
  const downloadUrl = `/api/workflows/artifacts/download?path=${encodeURIComponent(storagePath)}`;
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
