import { Redirect } from 'expo-router';

import { consumeCommunityLandingChannelId } from '@/src/services/communityIntent';

import { tabRoute } from '@/src/navigation/routes';

export default function ProtectedIndexRedirect(): React.JSX.Element {
  // A freshly joined community member has no DMs yet, so land them on the community's landing
  // channel instead. The key is one-shot: every later visit falls through to the default tab.
  const landingChannelId = consumeCommunityLandingChannelId();
  if (landingChannelId) {
    return <Redirect href={`/(protected)/chat/${landingChannelId}`} />;
  }

  return <Redirect href={tabRoute('dms')} />;
}
