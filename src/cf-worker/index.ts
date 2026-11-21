import { handleDiscordRequest } from "../core.ts";

export default {
  async fetch(request) {
    return handleDiscordRequest(request);
  },
} satisfies ExportedHandler<Env>;
