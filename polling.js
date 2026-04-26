// ── polling.js — Controlla nuove sessioni ogni minuto ────────────
const { createLobby, kvGet, kvSet, getNextSessionNumber } = require('./sessions');

const GUILD_ID = process.env.GUILD_ID;
const POLL_INTERVAL = 60 * 1000; // ogni 60 secondi

let knownScrims = new Set();

async function startPolling(client) {
  console.log('🔄 Polling avviato...');

  // Prima run immediata
  await poll(client);

  setInterval(() => poll(client), POLL_INTERVAL);
}

async function poll(client) {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;

    const scrims = await kvGet('scrims') || [];

    for (const scrim of scrims) {
      // Salta sessioni già processate
      if (knownScrims.has(scrim.id)) continue;
      // Salta sessioni senza status 'standby' o 'active'
      if (!['standby', 'active'].includes(scrim.status)) continue;
      // Salta sessioni senza tempo valido
      if (!scrim.time || isNaN(new Date(scrim.time))) continue;

      console.log(`📋 Nuova sessione rilevata: ${scrim.name} (${scrim.id})`);
      knownScrims.add(scrim.id);

      // Controlla se la lobby è già stata creata per questa sessione
      const existingLobby = await kvGet(`lobby_${scrim.id}_1`);
      if (existingLobby) {
        console.log(`  → Lobby già esistente per ${scrim.id}, skip`);
        continue;
      }

      // Ottieni/assegna numero sessione progressivo
      let sessionNumber = await kvGet(`session_number_${scrim.id}`);
      if (!sessionNumber) {
        sessionNumber = await getNextSessionNumber();
        await kvSet(`session_number_${scrim.id}`, sessionNumber);
      }

      // Crea la prima lobby
      try {
        await createLobby(guild, scrim, 1, sessionNumber);
        console.log(`  ✅ Lobby 1 creata per sessione ${sessionNumber} (${scrim.name})`);
      } catch (err) {
        console.error(`  ❌ Errore creazione lobby per ${scrim.id}:`, err);
        knownScrims.delete(scrim.id); // retry al prossimo poll
      }
    }
  } catch (err) {
    console.error('Polling error:', err);
  }
}

module.exports = { startPolling };
