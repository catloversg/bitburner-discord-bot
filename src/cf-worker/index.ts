import { handleDiscordRequest } from "../core";

export default {
  async fetch(request) {
    return handleDiscordRequest(request);
  },
} satisfies ExportedHandler<Env>;
