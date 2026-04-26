// ── interactions.js — Button & Modal handlers ─────────────────────
const {
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, EmbedBuilder, PermissionFlagsBits
} = require('discord.js');
const {
  kvGet, kvSet, createLobby,
  postRegistrationMessage, announceSession, getNextSessionNumber,
} = require('./sessions');

const ADMIN_ROLE = process.env.CUSTOM_ADMIN_ROLE_ID;
const GUILD_ID   = process.env.GUILD_ID;

function isAdmin(member) {
  return member.roles.cache.has(ADMIN_ROLE) ||
    member.permissions.has(PermissionFlagsBits.Administrator);
}

function setupInteractions(client) {
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isButton()) await handleButton(client, interaction);
      if (interaction.isModalSubmit()) await handleModal(client, interaction);
    } catch (err) {
      console.error('Interaction error:', err);
      const msg = { content: '❌ Errore interno.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
  });
}

async function handleButton(client, interaction) {
  const id = interaction.customId;
  const guild = interaction.guild;
  const member = interaction.member;

  // ── Registration: join ──────────────────────────────────────────
  if (id.startsWith('reg_join_')) {
    const [,, scrimId, lobbyNum] = id.split('_');
    const lobbyData = await kvGet(`lobby_${scrimId}_${lobbyNum}`);
    if (!lobbyData) return interaction.reply({ content: '❌ Lobby non trovata.', ephemeral: true });
    if (!lobbyData.registrationOpen) return interaction.reply({ content: '❌ La registrazione non è ancora aperta.', ephemeral: true });

    // Mostra modal per epic name
    const modal = new ModalBuilder()
      .setCustomId(`modal_reg_${scrimId}_${lobbyNum}`)
      .setTitle('Register Your Team');
    const epicInput = new TextInputBuilder()
      .setCustomId('epic_name')
      .setLabel('Epic Games Username (leader del duo)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(32);
    modal.addComponents(new ActionRowBuilder().addComponents(epicInput));
    await interaction.showModal(modal);
    return;
  }

  // ── Registration: leave ─────────────────────────────────────────
  if (id.startsWith('reg_leave_')) {
    const [,, scrimId, lobbyNum] = id.split('_');
    const lobbyData = await kvGet(`lobby_${scrimId}_${lobbyNum}`);
    if (!lobbyData) return interaction.reply({ content: '❌ Lobby non trovata.', ephemeral: true });

    const idx = lobbyData.registrations.findIndex(r => r.discordId === interaction.user.id);
    if (idx === -1) return interaction.reply({ content: '❌ Non sei registrato.', ephemeral: true });

    lobbyData.registrations.splice(idx, 1);
    await kvSet(`lobby_${scrimId}_${lobbyNum}`, lobbyData);

    // Rimuovi ruolo
    const role = guild.roles.cache.get(lobbyData.roleId);
    if (role) await member.roles.remove(role).catch(() => {});

    return interaction.reply({ content: '✅ Rimosso dalla lobby.', ephemeral: true });
  }

  // ── Registration: view list ─────────────────────────────────────
  if (id.startsWith('reg_list_')) {
    const [,, scrimId, lobbyNum] = id.split('_');
    const lobbyData = await kvGet(`lobby_${scrimId}_${lobbyNum}`);
    if (!lobbyData) return interaction.reply({ content: '❌ Lobby non trovata.', ephemeral: true });

    const regs = lobbyData.registrations || [];
    const list = regs.length
      ? regs.map((r, i) => `${i + 1}. **${r.epicName}** — <@${r.discordId}>`).join('\n')
      : '*Nessuno registrato ancora.*';

    const embed = new EmbedBuilder()
      .setTitle(`📋 Registrazioni — Lobby ${lobbyNum}`)
      .setDescription(list)
      .setFooter({ text: `${regs.length} registrati` })
      .setColor(0x7c3aed);

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── ADMIN: solo per CUSTOM ADMIN ────────────────────────────────
  if (id.startsWith('admin_')) {
    if (!isAdmin(member)) {
      return interaction.reply({ content: '❌ Non hai i permessi.', ephemeral: true });
    }

    const parts   = id.split('_');
    // admin_ACTION_scrimId_lobbyNum
    const action  = parts.slice(1, parts.length - 2).join('_');
    const scrimId = parts[parts.length - 2];
    const lobbyNum = parts[parts.length - 1];

    const lobbyData = await kvGet(`lobby_${scrimId}_${lobbyNum}`);
    if (!lobbyData && action !== 'new_lobby') {
      return interaction.reply({ content: '❌ Lobby non trovata.', ephemeral: true });
    }

    // ── Open Registration ────────────────────────────────────────
    if (action === 'open_reg') {
      lobbyData.registrationOpen = true;
      await kvSet(`lobby_${scrimId}_${lobbyNum}`, lobbyData);

      // Apri canale registration a @everyone
      const regChannel = guild.channels.cache.get(lobbyData.channels.registration);
      if (regChannel) {
        await regChannel.permissionOverwrites.edit(guild.roles.everyone, {
          ViewChannel: true,
          SendMessages: false,
        });
        // Posta messaggio registrazione
        const scrims = await kvGet('scrims') || [];
        const scrim = scrims.find(s => s.id === scrimId);
        if (scrim) await postRegistrationMessage(regChannel, scrim, lobbyData);
      }
      return interaction.reply({ content: '✅ Registrazione aperta.', ephemeral: true });
    }

    // ── Close Registration ───────────────────────────────────────
    if (action === 'close_reg') {
      lobbyData.registrationOpen = false;
      await kvSet(`lobby_${scrimId}_${lobbyNum}`, lobbyData);

      const regChannel = guild.channels.cache.get(lobbyData.channels.registration);
      if (regChannel) {
        await regChannel.permissionOverwrites.edit(guild.roles.everyone, {
          ViewChannel: false,
        });
      }
      return interaction.reply({ content: '✅ Registrazione chiusa.', ephemeral: true });
    }

    // ── Announce Session ─────────────────────────────────────────
    if (action === 'announce') {
      const scrims = await kvGet('scrims') || [];
      const scrim = scrims.find(s => s.id === scrimId);
      if (scrim) await announceSession(guild, scrim, lobbyData);
      return interaction.reply({ content: '✅ Sessione annunciata.', ephemeral: true });
    }

    // ── Show/Hide/Mute/Unmute Fills ──────────────────────────────
    if (action === 'show_fills') {
      const ch = guild.channels.cache.get(lobbyData.channels.fills);
      if (ch) {
        await ch.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: true, SendMessages: false });
      }
      return interaction.reply({ content: '✅ Fills visibile.', ephemeral: true });
    }
    if (action === 'hide_fills') {
      const ch = guild.channels.cache.get(lobbyData.channels.fills);
      if (ch) {
        await ch.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
      }
      return interaction.reply({ content: '✅ Fills nascosto.', ephemeral: true });
    }
    if (action === 'mute_fills') {
      const ch = guild.channels.cache.get(lobbyData.channels.fills);
      if (ch) await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      return interaction.reply({ content: '✅ Fills silenziato.', ephemeral: true });
    }
    if (action === 'unmute_fills') {
      const ch = guild.channels.cache.get(lobbyData.channels.fills);
      if (ch) await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: true });
      return interaction.reply({ content: '✅ Fills attivato.', ephemeral: true });
    }

    // ── Show/Hide Getting Off ────────────────────────────────────
    if (action === 'show_goff') {
      const ch = guild.channels.cache.get(lobbyData.channels.gettingOff);
      if (ch) {
        const role = guild.roles.cache.get(lobbyData.roleId);
        if (role) await ch.permissionOverwrites.edit(role, { ViewChannel: true, SendMessages: true });
      }
      return interaction.reply({ content: '✅ Getting Off visibile.', ephemeral: true });
    }
    if (action === 'hide_goff') {
      const ch = guild.channels.cache.get(lobbyData.channels.gettingOff);
      if (ch) {
        const role = guild.roles.cache.get(lobbyData.roleId);
        if (role) await ch.permissionOverwrites.edit(role, { ViewChannel: false });
      }
      return interaction.reply({ content: '✅ Getting Off nascosto.', ephemeral: true });
    }

    // ── Open New Lobby ───────────────────────────────────────────
    if (action === 'new_lobby') {
      await interaction.deferReply({ ephemeral: true });
      const scrims = await kvGet('scrims') || [];
      const scrim = scrims.find(s => s.id === scrimId);
      if (!scrim) return interaction.editReply({ content: '❌ Sessione non trovata.' });

      const sessionNumber = await kvGet(`session_number_${scrimId}`) || 1;
      const newLobbyNum = parseInt(lobbyNum) + 1;

      await createLobby(guild, scrim, newLobbyNum, sessionNumber);
      return interaction.editReply({ content: `✅ Lobby ${newLobbyNum} creata.` });
    }

    // ── Close Lobby ──────────────────────────────────────────────
    if (action === 'close_lobby') {
      await interaction.deferReply({ ephemeral: true });

      // Elimina tutti i canali della lobby
      for (const chId of Object.values(lobbyData.channels)) {
        const ch = guild.channels.cache.get(chId);
        if (ch) await ch.delete().catch(() => {});
      }
      // Elimina categoria
      const cat = guild.channels.cache.get(lobbyData.categoryId);
      if (cat) await cat.delete().catch(() => {});

      // Rimuovi ruolo a tutti
      const role = guild.roles.cache.get(lobbyData.roleId);
      if (role) {
        const members = await guild.members.fetch();
        for (const [, m] of members) {
          if (m.roles.cache.has(role.id)) {
            await m.roles.remove(role).catch(() => {});
          }
        }
        await role.delete().catch(() => {});
      }

      await kvSet(`lobby_${scrimId}_${lobbyNum}`, null);
      return interaction.editReply({ content: '✅ Lobby chiusa e canali eliminati.' });
    }
  }
}

async function handleModal(client, interaction) {
  const id = interaction.customId;
  const guild = interaction.guild;

  // ── Modal registrazione ─────────────────────────────────────────
  if (id.startsWith('modal_reg_')) {
    const [,, scrimId, lobbyNum] = id.split('_');
    const epicName = interaction.fields.getTextInputValue('epic_name').trim();
    const lobbyData = await kvGet(`lobby_${scrimId}_${lobbyNum}`);
    if (!lobbyData) return interaction.reply({ content: '❌ Lobby non trovata.', ephemeral: true });

    // Controlla se già registrato
    const already = lobbyData.registrations.find(r => r.discordId === interaction.user.id);
    if (already) return interaction.reply({ content: `❌ Sei già registrato come **${already.epicName}**.`, ephemeral: true });

    // Aggiungi registrazione
    lobbyData.registrations.push({
      discordId: interaction.user.id,
      discordTag: interaction.user.tag,
      epicName,
      registeredAt: Date.now(),
    });

    await kvSet(`lobby_${scrimId}_${lobbyNum}`, lobbyData);

    // Assegna ruolo
    const role = guild.roles.cache.get(lobbyData.roleId);
    if (role) await interaction.member.roles.add(role).catch(() => {});

    // Controlla soglia fills (50 registrati)
    if (lobbyData.registrations.length === 50 && !lobbyData.fillsOpen) {
      lobbyData.fillsOpen = true;
      await kvSet(`lobby_${scrimId}_${lobbyNum}`, lobbyData);

      const fillsCh = guild.channels.cache.get(lobbyData.channels.fills);
      if (fillsCh) {
        await fillsCh.permissionOverwrites.edit(guild.roles.everyone, {
          ViewChannel: true,
          SendMessages: false,
        });
        // Posta messaggio soglia raggiunta
        const embed = new EmbedBuilder()
          .setTitle('🎮 Fill Requests Aperte')
          .setDescription(
            `Abbiamo raggiunto **${lobbyData.registrations.length} registrazioni**.\n` +
            `Se vuoi partecipare come fill, reagisci qui sotto.`
          )
          .setColor(0x7c3aed);
        await fillsCh.send({ embeds: [embed] });
      }
    }

    return interaction.reply({
      content: `✅ Registrato come **${epicName}**! Ti è stato assegnato il ruolo \`${lobbyData.roleName}\`.`,
      ephemeral: true,
    });
  }
}

module.exports = { setupInteractions };
