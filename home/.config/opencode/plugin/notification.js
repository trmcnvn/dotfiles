import { platform } from "os";

export const NotificationPlugin = async ({ $, client }) => {
  const soundPath =
    platform() === "darwin"
      ? "/System/Library/Sounds/Submarine.aiff"
      : "/usr/share/sounds/freedesktop/stereo/message.oga";

  const playSound = async () => {
    try {
      await $`ffplay -nodisp -autoexit -loglevel quiet -hide_banner ${soundPath}`;
    } catch {}
  };

  // Check if a session is a main (non-subagent) session
  const isMainSession = async (sessionID) => {
    try {
      const result = await client.session.get({ path: { id: sessionID } });
      const session = result.data ?? result;
      return !session.parentID;
    } catch {
      // If we can't fetch the session, assume it's main to avoid missing notifications
      return true;
    }
  };

  return {
    event: async ({ event }) => {
      // Only notify for main session events, not background subagents
      if (event.type === "session.idle") {
        const sessionID = event.properties.sessionID;
        if (await isMainSession(sessionID)) {
          await playSound();
        }
      }

      // Permission prompt created
      if (event.type === "permission.asked") {
        await playSound();
      }
    },
  };
};
