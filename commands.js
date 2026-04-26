// ── commands.js — Slash commands ─────────────────────────────────
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('sessions')
    .setDescription('Mostra le sessioni attive'),
  new SlashCommandBuilder()
    .setName('registrations')
    .setDescription('Mostra le registrazioni di una lobby')
    .addStringOption(opt =>
      opt.setName('scrim_id').setDescription('ID della sessione').setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('lobby').setDescription('Numero lobby').setRequired(true)),
].map(c => c.toJSON());

async function setupCommands(client) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registrati');
  } catch (err) {
    console.error('❌ Errore registrazione comandi:', err);
  }

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    const { kvGet } = require('./sessions');

    if (commandName === 'sessions') {
      const scrims = await kvGet('scrims') || [];
      const active = scrims.filter(s => ['standby', 'active'].includes(s.status));
      if (!active.length) return interaction.reply({ content: 'Nessuna sessione attiva.', ephemeral: true });

      const list = active.map(s =>
        `• **${s.name}** — \`${s.status}\` — ID: \`${s.id}\``
      ).join('\n');

      return interaction.reply({ content: `**Sessioni attive:**\n${list}`, ephemeral: true });
    }

    if (commandName === 'registrations') {
      const scrimId  = interaction.options.getString('scrim_id');
      const lobbyNum = interaction.options.getInteger('lobby');
      const lobbyData = await kvGet(`lobby_${scrimId}_${lobbyNum}`);
      if (!lobbyData) return interaction.reply({ content: '❌ Lobby non trovata.', ephemeral: true });

      const regs = lobbyData.registrations || [];
      const list = regs.length
        ? regs.map((r, i) => `${i + 1}. **${r.epicName}** — <@${r.discordId}>`).join('\n')
        : '*Nessuno.*';

      return interaction.reply({ content: `**Registrazioni Lobby ${lobbyNum}:**\n${list}`, ephemeral: true });
    }
  });
}

module.exports = { setupCommands };
