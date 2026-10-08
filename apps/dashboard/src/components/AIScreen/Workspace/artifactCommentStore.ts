import {
  addArtifactComment,
  listArtifactComments,
  resolveArtifactComment,
} from '../../../services/XyneAI/XyneAIArtifactsService';
import { registerCommentStore, type ItemComment } from '../../workspaceItems';

let registered = false;

export function registerArtifactCommentStore(): void {
  if (registered) return;
  registered = true;

  registerCommentStore('ai-artifact', {
    list: async item => (await listArtifactComments(item.id)) as ItemComment[],
    add: async (item, comment) => {
      const row = await addArtifactComment(item.id, {
        body: comment.body,
        ...(comment.anchor ? { anchor: comment.anchor } : {}),
      });
      if (!row) throw new Error('The comment was not saved');
      return row as ItemComment;
    },
    resolve: async (item, commentId, resolved) => {
      await resolveArtifactComment(item.id, commentId, resolved);
    },
  });
}
