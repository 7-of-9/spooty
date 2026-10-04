export interface SpotifyConnection {
  state: 'connected' | 'connecting' | 'disconnected' | 'unavailable';
  connectedAt: string | null;
}

/** Chrome readiness is not proof of Spotify sign-in or of a completed sync. */
export function chromeConnectionGuidance(state: SpotifyConnection['state']): string {
  switch (state) {
    case 'connected': return 'Chrome is connected. Use Sync Spotify library, or Sync this playlist, to update your saved lists.';
    case 'connecting': return 'One connection request is awaiting approval in your main Chrome window. No additional requests will be sent.';
    case 'disconnected': return 'Spotify sync needs the shared Chrome connection. Connect once when you are ready; saved playlists and MP3s remain available.';
    case 'unavailable': return 'The Chrome bridge is unavailable. Start the existing bridge, then check the connection. Saved playlists and MP3s remain available.';
  }
}
