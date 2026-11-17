interface SlashCommandOption {
  name: string;
  description: string;
  type: number;
  required?: boolean;
  autocomplete?: boolean;
}

interface SlashCommand {
  name: string;
  description: string;
  type?: number;
  options?: SlashCommandOption[];
}

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const commands: SlashCommand[] = [
  {
    name: "mdn",
    description: "Search MDN",
    type: 1,
    options: [
      {
        name: "search-text",
        description: "Search text",
        type: 3,
        required: true,
      },
      {
        name: "ephemeral",
        description: "Hide the reply from others (default: true)",
        type: 5, // boolean
        required: false,
      },
    ],
  },
  {
    name: "ns",
    description: "Search NS API",
    type: 1,
    options: [
      {
        name: "search-text",
        description: "Search text",
        type: 3,
        required: true,
      },
      {
        name: "ephemeral",
        description: "Hide the reply from others (default: true)",
        type: 5, // boolean
        required: false,
      },
    ],
  },
  {
    name: "tip",
    description: "Show advice and useful information",
    type: 1,
    options: [
      {
        name: "topic",
        description: "The topic of the tip (e.g. codeformat)",
        type: 3,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "fun",
    description: "Show something funny",
    type: 1,
    options: [
      {
        name: "topic",
        description: "The topic of the content (e.g. quack)",
        type: 3,
        required: true,
        autocomplete: true,
      },
    ],
  },
];

async function registerCommands() {
  const url = GUILD_ID
    ? `https://discord.com/api/v10/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${BOT_TOKEN}`,
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(`Failed to register commands (${response.status}): ${await response.text()}`);
  }
  console.log("Successfully registered commands:", await response.json());
}

registerCommands().catch(console.error);
