# AURAcord Bot

Bot Discord per gestire le sessioni scrim di AURAcord.

## Setup su Railway

1. Vai su [railway.app](https://railway.app) e crea un account
2. New Project → Deploy from GitHub repo (oppure usa "Empty Project" e carica i file)
3. Aggiungi le variabili d'ambiente (Settings → Variables):

```
DISCORD_BOT_TOKEN=il_tuo_bot_token
GUILD_ID=1329138511525187687
CUSTOM_ADMIN_ROLE_ID=1493689734181163108
ANNOUNCE_RELOAD_DUO_CHANNEL_ID=1493923144053030992
ANNOUNCE_DUO_BR_CHANNEL_ID=1493695409909137521
API_BASE=https://auracord-api.auracord10.workers.dev
ADMIN_TOKEN=auracord2026
```

4. Railway detecta automaticamente Node.js e usa `npm start`
5. Deploy → il bot va online

## Come funziona

### Flusso sessione:
1. Admin crea sessione su **samu.auracord10.workers.dev/scrims.html**
2. Bot rileva la nuova sessione (polling ogni 60s) e crea automaticamente:
   - Categoria: `Reload Session X Lobby 1 (Duo)`
   - Canali: registration, code, chat, getting-off, fills, admin
   - Ruolo: `SX-L1-26Apr-2100`
3. In `lobby-1-admin` appaiono i bottoni admin tools
4. Admin clicca **📢 Announce Session** → bot annuncia nel canale giusto
5. Admin clicca **Open Registration** → canale registration si apre + messaggio registrazione
6. Utenti cliccano **Register Your Team** → inseriscono epic name → ricevono ruolo
7. A 50 registrazioni → fills si apre automaticamente
8. Admin apre il custom game su **dash.yunite.xyz** → Yunite posta in `lobby-X-code`
9. Admin clicca **➕ Open New Lobby** se servono più lobby
10. Fine sessione → admin clicca **🔴 Close Lobby** → canali + ruolo eliminati

## Slash commands
- `/sessions` — lista sessioni attive
- `/registrations scrim_id lobby` — lista registrazioni di una lobby
