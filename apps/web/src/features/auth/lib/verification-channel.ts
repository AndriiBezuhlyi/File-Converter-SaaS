export const VERIFICATION_CHANNEL = 'flux-email-verification';
export const VERIFICATION_COMPLETED = 'verification-completed';

// A hint only: recipients must recheck their own server-authorized receipt.
export function notifyVerification() {
  try {
    const channel = new BroadcastChannel(VERIFICATION_CHANNEL);
    channel.postMessage({ type: VERIFICATION_COMPLETED });
    channel.close();
  } catch {
    // Visible polling and explicit recheck also cover unsupported/blocked channels.
  }
}
