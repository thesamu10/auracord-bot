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
      if (!['standby', 'active'].includes(scrim.status)) continue;
      if (!scrim.time || isNaN(new Date(scrim.time))) continue;

      // Controlla se c'è un deploy_pending per questa sessione (tasto dal sito)
      const pending = await kvGet(`deploy_pending_${scrim.id}`);

      // Salta se già processato E non c'è deploy_pending
      if (knownScrims.has(scrim.id) && !pending) continue;

      // Controlla se la lobby è già stata creata
      const existingLobby = await kvGet(`lobby_${scrim.id}_1`);
      if (existingLobby && !pending) {
        knownScrims.add(scrim.id);
        continue;
      }

      if (existingLobby && pending) {
        // Deploy già fatto, rimuovi il pending
        await kvSet(`deploy_pending_${scrim.id}`, null);
        continue;
      }

      console.log(`📋 Deploy sessione: ${scrim.name} (${scrim.id}) ${pending ? '[MANUAL]' : '[AUTO]'}`);
      knownScrims.add(scrim.id);

      // Ottieni/assegna numero sessione progressivo
      let sessionNumber = await kvGet(`session_number_${scrim.id}`);
      if (!sessionNumber) {
        sessionNumber = await getNextSessionNumber();
        await kvSet(`session_number_${scrim.id}`, sessionNumber);
      }

      // Crea la prima lobby
      try {
        await createLobby(guild, scrim, 1, sessionNumber);
        // Rimuovi il pending dopo deploy riuscito
        if (pending) await kvSet(`deploy_pending_${scrim.id}`, null);
        console.log(`  ✅ Lobby 1 creata per sessione ${sessionNumber} (${scrim.name})`);
      } catch (err) {
        console.error(`  ❌ Errore creazione lobby per ${scrim.id}:`, err);
        knownScrims.delete(scrim.id);
      }
    }
  } catch (err) {
    console.error('Polling error:', err);
  }
}

module.exports = { startPolling };
