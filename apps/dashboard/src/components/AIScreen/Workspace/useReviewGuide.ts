import { useEffect, useState } from 'react';
import { fetchFile } from '../../../services/clients/fileFetchService';
import type { ConversationArtifact } from '../../../services/XyneAI/XyneAIArtifactsService';
import { parseReviewGuide, type ReviewGuide } from './reviewDiff';

const GUIDE_FILENAME = /^review-comments\.json$/i;

export function findGuideArtifact(artifacts: ConversationArtifact[]): ConversationArtifact | null {
  const candidates = artifacts.filter(
    artifact => artifact.kind === 'FILE' && GUIDE_FILENAME.test(artifact.title.trim()),
  );
  if (candidates.length === 0) return null;
  return (
    [...candidates].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0] ?? null
  );
}

export function useReviewGuide(artifacts: ConversationArtifact[]): ReviewGuide | null {
  const [guide, setGuide] = useState<ReviewGuide | null>(null);
  const refId = findGuideArtifact(artifacts)?.openRef.refId ?? null;

  useEffect(() => {
    if (!refId) {
      setGuide(null);
      return;
    }
    let cancelled = false;
    void fetchFile(
      `/xyne-ai/v2/attachments/${encodeURIComponent(refId)}/download`,
      'review-comments.json',
      'application/json',
    )
      .then(file => file.text())
      .then(text => {
        if (!cancelled) setGuide(parseReviewGuide(text));
      })
      .catch(() => {
        if (!cancelled) setGuide(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refId]);

  return guide;
}
