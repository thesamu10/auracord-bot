// ── AURAcord Bot ─────────────────────────────────────────────────
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const fetch = require('node-fetch');

const { setupCommands }    = require('./commands');
const { setupInteractions } = require('./interactions');
const { startPolling }     = require('./polling');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once('ready', async () => {
  console.log(`✅ Bot online come ${client.user.tag}`);
  await setupCommands(client);
  setupInteractions(client);
  startPolling(client);
});

client.login(process.env.DISCORD_BOT_TOKEN);
