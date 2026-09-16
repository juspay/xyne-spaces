export interface Website {
  id: string;
  name: string;
  url: string;
  icon?: string;
  // Path to icon image (takes precedence over emoji icon)
  iconImage?: string;
  // If true, uses URL parameters instead of webview
  useUrlParams?: boolean;
  // Template for URL with {text} placeholder
  urlTemplate?: string;
  // If true, use smart URL parsing (for MIMIR)
  useDynamicUrl?: boolean;
}
export const WEBSITES: Website[] = [
  {
    id: 'google',
    name: 'Google',
    url: 'https://www.google.com',
    iconImage: '/images/google.png',
    useUrlParams: true,
    urlTemplate: 'https://www.google.com/search?q={text}',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chat.openai.com',
    iconImage: '/images/chatgpt.png',
    useUrlParams: true,
    urlTemplate: 'https://chat.openai.com/?prompt={text}',
  },
];
