export type FeedMedia = { id: string; filename: string; mimetype: string; size: number };
export type FeedExcerpt = {
  author: { id: string; name: string };
  text: string;
  createdAt: string;
  media: FeedMedia[];
};
export type SourceMessage = FeedExcerpt & { id: string; revision: string };
export type FeedPost = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  excerpts: FeedExcerpt[];
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  commentCount: number;
  liked: boolean;
};
export type FeedPage = {
  posts: FeedPost[];
  nextCursor: string | null;
  viewerId: string;
  canModerate: boolean;
  workspaceName: string;
};
export type FeedComment = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};
export type SourcePage = {
  workspaceName: string;
  privateSource: boolean;
  messages: SourceMessage[];
  nextCursor: string | null;
};
