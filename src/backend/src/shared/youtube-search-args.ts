export type YoutubeSearchAttempt = {
  label: string;
  useCookies: boolean;
  client: string;
};

/** Explicit supported clients; authenticated proven mode starts at index 1. */
export const YOUTUBE_SEARCH_ATTEMPTS: YoutubeSearchAttempt[] = [
  {
    label: 'visionos',
    useCookies: false,
    client: 'visionos',
  },
  {
    label: 'cookies+web_creator',
    useCookies: true,
    client: 'web_creator',
  },
];

export function buildYoutubeSearchArgs(opts: {
  query: string;
  cookiesPath: string | null;
  useCookies: boolean;
  client: string;
}): string[] {
  const args = [
    `ytsearch1:${opts.query}`,
    '--flat-playlist',
    '--print',
    'url',
    '--no-playlist',
    '--no-warnings',
    '--socket-timeout',
    '20',
    '--extractor-args',
    `youtube:player_client=${opts.client}`,
  ];
  if (opts.useCookies && opts.cookiesPath) {
    args.push('--cookies', opts.cookiesPath);
  }
  return args;
}
