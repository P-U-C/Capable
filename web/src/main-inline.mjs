// Self-hosted build entry (--media=inline): videos play here; Mini App aware.
import { start } from "./app.mjs";
import { play } from "./player.mjs";
import { miniappReady } from "./miniapp.mjs";

start({ media: "inline", play, onReady: miniappReady });
