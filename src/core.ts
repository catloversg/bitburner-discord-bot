import {
  ButtonStyleTypes,
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKey,
} from "discord-interactions";
import {
  bannedChannels,
  exactSearch,
  funHandlers,
  fuzzySearch,
  getAutocompleteSuggestions,
  isValidSearchRequest,
  queryLlmForMdnUrl,
  spoilerChannels,
  spoilerWords,
  SUPPRESS_EMBEDS,
  tipHandlers,
  type Interaction,
  type SearchOptions,
  type TipAndFunHandler,
} from "./utils.ts";

export async function handleDiscordRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) {
    return new Response("Missing signature headers", { status: 401 });
  }
  const body = await request.text();
  const isValidRequest = await verifyKey(body, signature, timestamp, process.env.DISCORD_BOT_PUBLIC_KEY as string);
  if (!isValidRequest) {
    return new Response("Invalid request signature", { status: 401 });
  }
  const interaction = JSON.parse(body) as Interaction;

  if (interaction.type === InteractionType.PING) {
    return Response.json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    const focusedOption = interaction.data.options?.find((option) => option.focused);
    const query = focusedOption?.value;
    const choices = getAutocompleteSuggestions(interaction.data.name, query);
    return Response.json({
      type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
      data: {
        choices: choices.slice(0, 25),
      },
    });
  }

  // Only return an ephemeral message when the slash command is used in banned channels.
  // This ensures nobody can trick other bots into banning our bot by tricking our bot into posting in honeypot channels.
  if (interaction.channel_id && bannedChannels.has(interaction.channel_id)) {
    return Response.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "Invalid channel",
        flags: InteractionResponseFlags.EPHEMERAL,
      },
    });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    switch (interaction.data.name) {
      case "mdn":
      case "ns":
        return handleSearch(interaction);
      case "tip":
        return handleTipAndFun(interaction, tipHandlers);
      case "fun":
        return handleTipAndFun(interaction, funHandlers);
    }
  }

  if (interaction.type === InteractionType.MESSAGE_COMPONENT && interaction.data.custom_id === "post_public_btn") {
    return handlePostPublicButton(interaction);
  }

  return new Response("Unknown interaction", { status: 400 });
}

async function handleSearch(interaction: Interaction) {
  const options = interaction.data.options;
  const searchTextOptionValue = options?.find((option) => option.name === "search-text")?.value;
  const ephemeralOptionValue = options?.find((option) => option.name === "ephemeral")?.value;
  const buildTypeOptionValue = options?.find((option) => option.name === "build-type")?.value;

  if (searchTextOptionValue !== undefined && typeof searchTextOptionValue !== "string") {
    throw new Error(
      `search-text must be a string. search-text: ${searchTextOptionValue}. typeof search-text: ${typeof searchTextOptionValue}`,
    );
  }
  if (ephemeralOptionValue !== undefined && typeof ephemeralOptionValue !== "boolean") {
    throw new Error(
      `ephemeral must be a boolean. ephemeral: ${ephemeralOptionValue}. typeof ephemeral: ${typeof ephemeralOptionValue}`,
    );
  }
  if (buildTypeOptionValue !== undefined && typeof buildTypeOptionValue !== "string") {
    throw new Error(
      `build-type must be a string. build-type: ${buildTypeOptionValue}. typeof build-type: ${typeof buildTypeOptionValue}`,
    );
  }
  const searchText = searchTextOptionValue ?? "";
  const isEphemeral = ephemeralOptionValue ?? true;
  const buildType = buildTypeOptionValue ?? "both";

  const isValidBuildType = (value: string): value is "both" | "stable" | "dev" =>
    value === "both" || value === "stable" || value === "dev";
  const searchType = interaction.data.name;
  let searchOptions: SearchOptions;

  if (searchType === "mdn") {
    searchOptions = { type: "mdn" };
  } else if (searchType === "ns") {
    if (!isValidBuildType(buildType)) {
      throw new Error(`Invalid build type: ${buildType}`);
    }
    searchOptions = { type: "ns", buildType };
  } else {
    throw new Error(`Invalid search type: ${searchType}`);
  }

  // Empty search request
  // This "feature" is currently disabled.
  // If the first option is optional and users type "/mdn math[Enter]", Discord behaves as if they typed "/mdn".
  // Users need to type "/mdn [Tab][Tab]math[Enter]".
  // To avoid this UX issue, we need to set the first option to "required" so they can type "/mdn math[Enter]".
  if (searchText.trim() === "") {
    return Response.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content:
          interaction.data.name === "mdn"
            ? "https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting"
            : "https://github.com/bitburner-official/bitburner-src/blob/stable/markdown/bitburner.md",
        flags: (isEphemeral ? InteractionResponseFlags.EPHEMERAL : 0) | SUPPRESS_EMBEDS,
        ...buildResponseComponents(isEphemeral),
      },
    });
  }

  const resultOfCheckingSearchRequest = isValidSearchRequest(searchText);
  if (!resultOfCheckingSearchRequest.success) {
    // Report invalid search requests publicly (ignore isEphemeral)
    return Response.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `Invalid request. ${resultOfCheckingSearchRequest.message}`,
      },
    });
  }

  // Spoiler request
  if (
    interaction.data.name === "ns" &&
    interaction.channel_id &&
    !spoilerChannels.has(interaction.channel_id) &&
    resultOfCheckingSearchRequest.words.some((v) => spoilerWords.has(v.toLowerCase()))
  ) {
    // Instruct users privately (ignore isEphemeral)
    return Response.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "Do not mention spoiler words in non-spoiler channels",
        flags: InteractionResponseFlags.EPHEMERAL,
      },
    });
  }

  // Respond ASAP
  const initialResponseMessage = `Search text: ${searchText}
Searching ...
`;
  await fetch(`https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: (isEphemeral ? InteractionResponseFlags.EPHEMERAL : 0) | SUPPRESS_EMBEDS,
        content: initialResponseMessage,
      },
    }),
  });

  // Update response
  const updatedMessage = await search(searchText, searchOptions);
  await fetch(
    `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: updatedMessage,
        flags: SUPPRESS_EMBEDS,
        ...buildResponseComponents(isEphemeral),
      }),
    },
  );
  return new Response(null, { status: 202 });
}

async function search(searchText: string, searchOptions: SearchOptions): Promise<string> {
  const exactUrl = exactSearch(searchText, searchOptions);
  if (exactUrl) {
    if (exactUrl.includes("blob/dev/")) {
      return `Search text: ${searchText}\n- ${exactUrl}\nThis API is only available in the dev version.`;
    } else {
      return `Search text: ${searchText}\n- ${exactUrl}`;
    }
  }
  // Fallback to LLM (for MDN) + fuzzySearch
  const results = new Set<string>();
  if (searchOptions.type === "mdn" && process.env.CLOUDFLARE_ACCOUNT_ID) {
    let urlGuessedByLlm = "";
    try {
      urlGuessedByLlm = await queryLlmForMdnUrl(searchText);
    } catch (error) {
      console.error(error);
    }
    if (urlGuessedByLlm.length > 0 && urlGuessedByLlm !== "n/a") {
      results.add(urlGuessedByLlm.toLowerCase());
    }
  }
  for (const url of fuzzySearch(searchText, searchOptions)) {
    results.add(url);
  }

  if (results.size === 0) {
    return `Search text: ${searchText}\nNo results found.`;
  }
  const resultsText = [...results].join("\n- ");
  if (resultsText.includes("blob/dev/")) {
    const warningMessage =
      results.size === 1
        ? "This API is only available in the dev version."
        : "Some APIs are only available in the dev version.";
    return `Search text: ${searchText}\n- ${resultsText}\n${warningMessage}`;
  } else {
    return `Search text: ${searchText}\n- ${resultsText}`;
  }
}

function handleTipAndFun(interaction: Interaction, handlers: TipAndFunHandler) {
  const topic = interaction.data.options?.[0].value ?? "";
  if (typeof topic !== "string") {
    throw new Error(`topic must be a string. topic: ${topic}. typeof topic: ${typeof topic}`);
  }

  const handler = handlers.find(({ match }) => match(topic));
  const content = handler?.handle(topic);
  if (!content) {
    return Response.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "Invalid topic",
        flags: InteractionResponseFlags.EPHEMERAL,
      },
    });
  }

  return Response.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: content,
      ...(handler?.embedImage && {
        embeds: [{ image: { url: handler.embedImage } }],
      }),
    },
  });
}

function buildResponseComponents(isEphemeral: boolean) {
  if (!isEphemeral) {
    return {};
  }
  return {
    components: [
      {
        type: MessageComponentTypes.ACTION_ROW,
        components: [
          {
            type: MessageComponentTypes.BUTTON,
            style: ButtonStyleTypes.PRIMARY,
            label: "Post Publicly",
            custom_id: "post_public_btn",
          },
        ],
      },
    ],
  };
}

async function handlePostPublicButton(interaction: Interaction) {
  // Respond ASAP and remove the button
  await fetch(`https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: { components: [] },
    }),
  });
  // Repost publicly
  await fetch(`https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: interaction.message?.content,
      flags: SUPPRESS_EMBEDS,
    }),
  });
  return new Response(null, { status: 202 });
}
