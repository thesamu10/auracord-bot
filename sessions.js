// ── sessions.js — Lobby creation & management ────────────────────
const {
  ChannelType, PermissionFlagsBits, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, EmbedBuilder
} = require('discord.js');
const fetch = require('node-fetch');

const API_BASE    = process.env.API_BASE;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const GUILD_ID    = process.env.GUILD_ID;
const ADMIN_ROLE  = process.env.CUSTOM_ADMIN_ROLE_ID;

// ── KV helpers ────────────────────────────────────────────────────
async function kvGet(key) {
  const res = await fetch(`${API_BASE}/api/get?key=${encodeURIComponent(key)}`);
  const data = await res.json();
  return data.value;
}

async function kvSet(key, value) {
  await fetch(`${API_BASE}/api/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN },
    body: JSON.stringify({ key, value }),
  });
}

// ── Formato ora CET/CEST ──────────────────────────────────────────
function fmtTime(date) {
  return date.toLocaleTimeString('it-IT', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Rome'
  });
}

function fmtDate(date) {
  return date.toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Europe/Rome'
  });
}

// ── Role name ─────────────────────────────────────────────────────
function makeRoleName(sessionNumber, lobbyNumber, time) {
  const d = new Date(time);
  const day   = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en', { month: 'short', timeZone: 'Europe/Rome' });
  const hhmm  = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).replace(':', '');
  return `S${sessionNumber}-L${lobbyNumber}-${day}${month}-${hhmm}`;
}

// ── Category name ─────────────────────────────────────────────────
function makeCategoryName(sessionNumber, lobbyNumber, mode) {
  const modeLabel = { 'Reload Duo': 'Duo', 'Duo BR': 'Duo', Solo: 'Solo', Trio: 'Trio', Squad: 'Squad' }[mode] || mode;
  return `Reload Session ${sessionNumber} Lobby ${lobbyNumber} (${modeLabel})`;
}

// ── Session counter ───────────────────────────────────────────────
async function getNextSessionNumber() {
  const n = (await kvGet('session_counter')) || 0;
  await kvSet('session_counter', n + 1);
  return n + 1;
}

// ── Create full lobby ─────────────────────────────────────────────
async function createLobby(guild, scrim, lobbyNumber, sessionNumber) {
  const everyone  = guild.roles.everyone;
  const adminRole = guild.roles.cache.get(ADMIN_ROLE);

  // 1. Ruolo sessione
  const roleName    = makeRoleName(sessionNumber, lobbyNumber, scrim.time);
  const sessionRole = await guild.roles.create({
    name: roleName, color: 0x7c3aed,
    reason: `AURAcord: ${scrim.name}`,
  });

  // Permessi base
  const denyAll   = { ViewChannel: false };
  const adminPerm = adminRole
    ? [{ id: adminRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }]
    : [];

  // 2. Categoria
  const category = await guild.channels.create({
    name: makeCategoryName(sessionNumber, lobbyNumber, scrim.mode || scrim.format),
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: sessionRole.id, allow: [PermissionFlagsBits.ViewChannel] },
      ...adminPerm,
    ],
  });

  // 3. Canali con permessi corretti
  //
  // LOGICA VISIBILITÀ:
  // - registration : visibile a @everyone (non registrati), nascosto ai registrati
  // - code/chat/getting-off/dropmap : visibile solo ai registrati (sessionRole)
  // - fills : nascosto a tutti, si apre manualmente/automaticamente
  // - admin : solo CUSTOM ADMIN

  const channelDefs = [
    {
      name: `lobby-${lobbyNumber}-registration`,
      key: 'registration',
      overrides: [
        { id: everyone.id,    allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
        { id: sessionRole.id, deny:  [PermissionFlagsBits.ViewChannel] }, // registrati non vedono più registration
        ...adminPerm,
      ],
    },
    {
      name: `lobby-${lobbyNumber}-code`,
      key: 'code',
      overrides: [
        { id: everyone.id,    deny:  [PermissionFlagsBits.ViewChannel] },
        { id: sessionRole.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
        ...adminPerm,
      ],
    },
    {
      name: `lobby-${lobbyNumber}-chat`,
      key: 'chat',
      overrides: [
        { id: everyone.id,    deny:  [PermissionFlagsBits.ViewChannel] },
        { id: sessionRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ...adminPerm,
      ],
    },
    {
      name: `lobby-${lobbyNumber}-getting-off`,
      key: 'gettingOff',
      overrides: [
        { id: everyone.id,    deny:  [PermissionFlagsBits.ViewChannel] },
        { id: sessionRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ...adminPerm,
      ],
    },
    {
      name: `lobby-${lobbyNumber}-dropmap`,
      key: 'dropmap',
      overrides: [
        { id: everyone.id,    deny:  [PermissionFlagsBits.ViewChannel] },
        { id: sessionRole.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
        ...adminPerm,
      ],
    },
    {
      name: `lobby-${lobbyNumber}-fills`,
      key: 'fills',
      overrides: [
        { id: everyone.id,    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ...adminPerm,
      ],
    },
    {
      name: `lobby-${lobbyNumber}-admin`,
      key: 'admin',
      overrides: [
        { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        ...adminPerm,
      ],
    },
  ];

  const channels = {};
  for (const def of channelDefs) {
    const ch = await guild.channels.create({
      name: def.name,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: def.overrides,
    });
    channels[def.key] = ch;
  }

  // 4. Salva in KV
  const lobbyData = {
    lobbyNumber, sessionNumber, scrimId: scrim.id,
    categoryId: category.id, roleId: sessionRole.id, roleName,
    registrations: [], registrationOpen: false, fillsOpen: false,
    channels: {
      registration: channels.registration.id,
      code:         channels.code.id,
      chat:         channels.chat.id,
      gettingOff:   channels.gettingOff.id,
      dropmap:      channels.dropmap.id,
      fills:        channels.fills.id,
      admin:        channels.admin.id,
    },
  };
  await kvSet(`lobby_${scrim.id}_${lobbyNumber}`, lobbyData);

  // 5. Posta messaggi iniziali
  await postAdminTools(channels.admin, scrim, lobbyData);
  await postFillsMessage(channels.fills, lobbyData);
  await postDropmapMessage(channels.dropmap, scrim, lobbyData);

  return { category, channels, sessionRole, lobbyData };
}

// ── Admin tools ───────────────────────────────────────────────────
async function postAdminTools(channel, scrim, lobbyData) {
  const embed = new EmbedBuilder()
    .setTitle('🛠️ Admin Tools')
    .setDescription(`**${scrim.name}** — Lobby ${lobbyData.lobbyNumber}`)
    .setColor(0x7c3aed);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin_open_reg_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('Open Registration').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`admin_close_reg_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('Close Registration').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`admin_announce_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('📢 Announce').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin_show_fills_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('Show Fills').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_hide_fills_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('Hide Fills').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_mute_fills_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('Mute Fills').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_unmute_fills_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('Unmute Fills').setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin_show_goff_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('Show Getting Off').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_hide_goff_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('Hide Getting Off').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_new_lobby_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('➕ New Lobby').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_close_lobby_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('🔴 Close Lobby').setStyle(ButtonStyle.Danger),
  );

  await channel.send({ embeds: [embed], components: [row1, row2, row3] });
}

// ── Fills message ─────────────────────────────────────────────────
async function postFillsMessage(channel, lobbyData) {
  const embed = new EmbedBuilder()
    .setTitle('Want to fill in a session?')
    .setDescription(
      'If we need additional teams to participate in this session we will open this channel.\n\n' +
      '**DO NOT DM** or **PING** any staff member as you will be banned.'
    )
    .setColor(0x7c3aed);
  await channel.send({ embeds: [embed] });
}

// ── Dropmap message ───────────────────────────────────────────────
async function postDropmapMessage(channel, scrim, lobbyData) {
  const siteUrl = `${process.env.FRONTEND_URL || 'https://samu.auracord10.workers.dev'}/session.html?id=${scrim.id}`;
  const embed = new EmbedBuilder()
    .setTitle('🗺️ Drop Map')
    .setDescription(
      `Visualizza la drop map per questa sessione sul sito AURAcord.\n\n` +
      `🔗 **[Apri Drop Map](${siteUrl})**`
    )
    .setColor(0x7c3aed);
  await channel.send({ embeds: [embed] });
}

// ── Registration message ──────────────────────────────────────────
async function postRegistrationMessage(channel, scrim, lobbyData) {
  const modeIcon = { Solo: '🧍', Duo: '👥', Trio: '👨‍👩‍👦', Squad: '👨‍👩‍👧‍👦' };
  const icon = modeIcon[scrim.mode] || '🎮';

  const embed = new EmbedBuilder()
    .setTitle(`${icon} Registered player/team`)
    .setDescription(
      `**${scrim.name}**\n` +
      `Register below to add yourself to the session.\n\n` +
      `⚠️ 1 registration per team.`
    )
    .setColor(0x7c3aed)
    .setThumbnail('https://samu.auracord10.workers.dev/assets/pr-logo.png');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`reg_join_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('Register Your Team').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`reg_leave_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('Leave').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`reg_list_${scrim.id}_${lobbyData.lobbyNumber}`).setLabel('📋 View Registrations').setStyle(ButtonStyle.Secondary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// ── Announce session ──────────────────────────────────────────────
async function announceSession(guild, scrim, lobbyData) {
  const ANNOUNCE_RELOAD_DUO = process.env.ANNOUNCE_RELOAD_DUO_CHANNEL_ID;
  const ANNOUNCE_DUO_BR     = process.env.ANNOUNCE_DUO_BR_CHANNEL_ID;

  const mode = scrim.mode || scrim.format || '';
  const channelId = mode.toLowerCase().includes('reload') ? ANNOUNCE_RELOAD_DUO : ANNOUNCE_DUO_BR;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  const gameTime = new Date(scrim.time);
  const regTime  = new Date(gameTime.getTime() - 15 * 60000);

  const embed = new EmbedBuilder()
    .setTitle(scrim.name)
    .setDescription(
      `→ **Registration opens @ ${fmtTime(regTime)}**\n` +
      `→ **First Game Commences @ ${fmtTime(gameTime)}**\n\n` +
      `**Staff in charge:** <@${scrim.staffId || guild.ownerId}>\n\n` +
      `- Session lasts **${scrim.games || 3} games**. Miss a single game and you will be banned.\n` +
      `- **Bottom 3** will lose access.\n\n` +
      `**${scrim.capacity || 50}+ reacts** | **${(scrim.capacity || 50) * 2}+ for second** *(1 per duo)*`
    )
    .setFooter({ text: fmtDate(gameTime) })
    .setColor(0x7c3aed);

  await channel.send({ content: '@everyone', embeds: [embed] });
}

module.exports = { kvGet, kvSet, createLobby, postRegistrationMessage, announceSession, getNextSessionNumber };
