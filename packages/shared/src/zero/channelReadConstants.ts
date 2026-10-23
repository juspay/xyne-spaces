/**
 * Most channel ids `POST /api/channels/mark-read` accepts in one request.
 *
 * Both halves of the feature need the same number, which is why it lives here: the
 * controller refuses a larger body, and the dashboard hook splits anything larger into
 * successive requests so that no group — however many channels it holds — is ever
 * refused. Keep the hook's batching driven by this value; a client batch larger than the
 * server bound would reintroduce the rejection it exists to prevent.
 *
 * The number is a payload guard, not a capacity one. `unreadService.markChannelsAsViewed`
 * costs a flat handful of statements regardless of how many channels it is given, so this
 * only stops an absurd request body: 1000 cuid2 ids is roughly 30KB, well inside the
 * 10MB body limit, and a group that large is already far past anything real.
 */
export const MARK_READ_REQUEST_MAX_CHANNELS = 1000;
