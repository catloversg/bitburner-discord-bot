# Bitburner Discord Bot

This bot works similarly to the [ns.pest bot](https://github.com/muesli4brekkies/disclj-BB). The main difference is that this bot supports slash commands while the ns.pest bot supports prefix commands (at the time of writing).

# Features

BitburnerBot supports:

- `/mdn`: Search mdn links
- `/ns`: Search ns links
- `/tip`: Support `mdn`, `ns`, `codeformat`, `strikeformat`, `spoilerformat`, `longcode`
- `/fun`: Support the remaining commands (`poast coad`, `quack`, `psps`, `bleep bloop`, etc.). Note that I'll never add the hacknet copypasta.

In order to use `!mdn` (points to https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting) and `!ns` (points to https://github.com/bitburner-official/bitburner-src/blob/stable/markdown/bitburner.md), you need to use `/tip mdn` and `/tip ns`. The first option of `/mdn` and `/ns` is required. If the first option is optional and users type `/mdn math[Enter]`, Discord behaves as if they typed `/mdn`. Users need to type `/mdn [Tab][Tab]math[Enter]`. To avoid this UX issue, we need to set the first option to "required" so they can type `/mdn math[Enter]`.

For fuzzy search, I use minisearch+fuzzysort instead of dice coefficient. This improves performance and accuracy in many cases.

With mdn search, besides fuzzy search, the bot will also query LLMs (Cloudflare Workers AI) to guess the link. This improves search results in some cases when users use a query that is impossible to match with a fuzzy search against URLs (e.g., search for "modulo", but the match is https://developer.mozilla.org/en-us/docs/web/javascript/reference/operators/remainder). I use the free tier of Cloudflare for this feature, so available capacity is fairly limited. Sometimes it may fail even when the account still has unused neurons. This should not be a problem due to the low traffic of this bot.

To avoid cluttering the channels with personal searches, for MDN search and NS search, the response is an ephemeral message by default. If you want to post it publicly, set ephemeral to false or press the "Post Publicly" button.

# How to build

Prerequisites:

- Copy `.env.example` to `.env` and `.env.production`, then fill in the required configuration properties.
- Run `npm run generate-data` to generate MDN and NS JSON data files.

Dev: `npm run dev`: Starts a local dev server with built-in hot reload support. Press "t" to create a Cloudflare tunnel for the local server, then set the bot's interactive HTTP endpoint to the tunnel URL. This works without a Cloudflare account.

Optional: `npm run cf-typegen`: Generates `worker-configuration.d.ts` in the top-level folder. For more information, check https://developers.cloudflare.com/workers/languages/typescript/.

Production: `npm run build` and `npm run deploy`.

`npm run cf-deploy`: Deploy to Cloudflare Workers. Don't use this unless you understand the pros and cons of using Cloudflare Workers (e.g., CPU time and request limits).

`/mdn` optionally supports querying LLMs. You need to create a Cloudflare account and get an API token for this. For more information, check
https://developers.cloudflare.com/workers-ai/get-started/rest-api/.

When changing the Discord command configurations, remember to run `npm run register-commands`.
