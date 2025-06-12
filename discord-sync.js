// discord-sync.js - Script pro synchronizaci dat s Discord botem
const fs = require('fs');
const path = require('path');

// Konfigurace cest
const DISCORD_BOT_PATH = '/mnt/data/evrimabot';
const KILL_STATS_FILE = path.join(DISCORD_BOT_PATH, 'kill_stats.json');
const PROCESSED_KILLS_FILE = path.join(DISCORD_BOT_PATH, 'processed_kills.json');
const PLAYTIME_FILE = path.join(DISCORD_BOT_PATH, 'playtime_stats.json');
const KILL_FEED_FILE = path.join(DISCORD_BOT_PATH, 'recent_kills.json');

class DiscordBotSync {
    constructor() {
        this.lastSync = new Date();
        this.killFeedCache = [];
        this.maxKillFeedItems = 100;
    }

    // Čtení dat z Discord bota
    readKillStats() {
        try {
            if (fs.existsSync(KILL_STATS_FILE)) {
                const data = fs.readFileSync(KILL_STATS_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Chyba při čtení kill_stats.json:', error);
        }
        return {};
    }

    // Čtení seznamu zpracovaných killů
    readProcessedKills() {
        try {
            if (fs.existsSync(PROCESSED_KILLS_FILE)) {
                const data = fs.readFileSync(PROCESSED_KILLS_FILE, 'utf8');
                return new Set(JSON.parse(data));
            }
        } catch (error) {
            console.error('Chyba při čtení processed_kills.json:', error);
        }
        return new Set();
    }

    // Čtení herních časů
    readPlaytimeStats() {
        try {
            if (fs.existsSync(PLAYTIME_FILE)) {
                const data = fs.readFileSync(PLAYTIME_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Chyba při čtení playtime_stats.json:', error);
        }
        return {};
    }

    // Zápis herních časů
    writePlaytimeStats(data) {
        try {
            fs.writeFileSync(PLAYTIME_FILE, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error('Chyba při zápisu playtime_stats.json:', error);
            return false;
        }
    }

    // Čtení kill feedu
    readKillFeed() {
        try {
            if (fs.existsSync(KILL_FEED_FILE)) {
                const data = fs.readFileSync(KILL_FEED_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Chyba při čtení recent_kills.json:', error);
        }
        return [];
    }

    // Zápis kill feedu
    writeKillFeed(data) {
        try {
            fs.writeFileSync(KILL_FEED_FILE, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error('Chyba při zápisu recent_kills.json:', error);
            return false;
        }
    }

    // Parsování kill log řádku pro kill feed
    parseKillLogLine(logLine) {
        // Regex pro parsování kill logu stejný jako v Discord botu
        const killPattern = /\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}(?:\.\d{3})?)\]\s*\[LogTheIsleKillData\]:\s*([^\[]+?)\s*\[(\d+)\]\s*Dino:\s*([^,]+?),\s*(?:Male|Female|Genderless|Unknown),\s*([\d\.]+)\s*-\s*Killed the following player:\s*([^,]+?),\s*\[(\d+)\],\s*Dino:\s*([^,]+?),\s*Gender:\s*(?:Male|Female|Genderless|Unknown),\s*Growth:\s*([\d\.]+).*/;
        
        const naturalDeathPattern = /\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}(?:\.\d{3})?)\]\s*\[LogTheIsleKillData\]:\s*([^\[]+?)\s*\[(\d+)\]\s*Dino:\s*([^,]+?),\s*(?:Male|Female|Genderless|Unknown),\s*([\d\.]+)\s*-\s*Died from Natural cause.*/;

        let match = logLine.match(killPattern);
        if (match) {
            return {
                timestamp: this.parseTimestamp(match[1]),
                killer: match[2].trim(),
                killerId: match[3],
                killerDino: match[4].trim(),
                victim: match[6].trim(),
                victimId: match[7],
                victimDino: match[8].trim(),
                natural: false
            };
        }

        match = logLine.match(naturalDeathPattern);
        if (match) {
            return {
                timestamp: this.parseTimestamp(match[1]),
                killer: match[2].trim(),
                killerId: match[3],
                killerDino: match[4].trim(),
                victim: null,
                victimId: null,
                victimDino: null,
                natural: true
            };
        }

        return null;
    }

    // Parsování timestamp
    parseTimestamp(timestampStr) {
        // Konverze z formátu "2024.01.15-14.30.45.123" na ISO string
        const parts = timestampStr.split(/[.-]/);
        if (parts.length >= 6) {
            const year = parts[0];
            const month = parts[1];
            const day = parts[2];
            const hour = parts[3];
            const minute = parts[4];
            const second = parts[5];
            const ms = parts[6] || '000';

            return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`).toISOString();
        }
        return new Date().toISOString();
    }

    // Aktualizace kill feedu z log souboru
    async updateKillFeedFromLog() {
        try {
            // Pokud existuje log soubor, parsuj nové kill eventy
            const LOG_FILE = '/TheIsle/Saved/Logs/TheIsle-Shipping.log'; // Upravte cestu podle potřeby
            
            if (!fs.existsSync(LOG_FILE)) {
                console.log('Log soubor nenalezen, používám existující kill feed');
                return;
            }

            const processedKills = this.readProcessedKills();
            const existingKillFeed = this.readKillFeed();
            
            // Čtení posledních řádků z log souboru (posledních 1000 řádků)
            const logContent = fs.readFileSync(LOG_FILE, 'utf8');
            const logLines = logContent.split('\n').slice(-1000);

            const newKills = [];

            for (const line of logLines) {
                if (line.includes('[LogTheIsleKillData]')) {
                    const killData = this.parseKillLogLine(line);
                    if (killData) {
                        // Vytvoření jedinečného ID pro kill event
                        const killId = `${killData.timestamp}_${killData.killerId}_${killData.victimId || 'natural'}`;
                        
                        if (!processedKills.has(killId)) {
                            newKills.push(killData);
                            processedKills.add(killId);
                        }
                    }
                }
            }

            if (newKills.length > 0) {
                // Přidání nových killů do feedu
                const updatedKillFeed = [...existingKillFeed, ...newKills]
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                    .slice(0, this.maxKillFeedItems);

                // Uložení aktualizovaného feedu
                this.writeKillFeed(updatedKillFeed);
                
                // Uložení zpracovaných killů
                fs.writeFileSync(PROCESSED_KILLS_FILE, JSON.stringify([...processedKills]));
                
                console.log(`Přidáno ${newKills.length} nových kill eventů do feedu`);
            }

        } catch (error) {
            console.error('Chyba při aktualizaci kill feedu:', error);
        }
    }

    // Simulace aktualizace herního času z RCON nebo jiného zdroje
    async updatePlaytimeFromRCON() {
        try {
            // Zde byste implementovali čtení herního času z RCON nebo jiného API
            // Pro demonstraci používám simulovaná data
            
            const killStats = this.readKillStats();
            const playtimeStats = this.readPlaytimeStats();

            // Simulace přidání herního času pro aktivní hráče
            for (const steamId of Object.keys(killStats)) {
                if (!playtimeStats[steamId]) {
                    playtimeStats[steamId] = 0;
                }
                
                // Simulace přidání 1 minuty herního času
                playtimeStats[steamId] += Math.floor(Math.random() * 5) + 1;
            }

            this.writePlaytimeStats(playtimeStats);
            console.log('Herní časy aktualizovány');

        } catch (error) {
            console.error('Chyba při aktualizaci herních časů:', error);
        }
    }

    // Hlavní synchronizační metoda
    async sync() {
        console.log('Spouštím synchronizaci s Discord botem...');
        
        try {
            // Aktualizace kill feedu
            await this.updateKillFeedFromLog();
            
            // Aktualizace herních časů
            await this.updatePlaytimeFromRCON();
            
            this.lastSync = new Date();
            console.log(`Synchronizace dokončena: ${this.lastSync.toISOString()}`);
            
        } catch (error) {
            console.error('Chyba při synchronizaci:', error);
        }
    }

    // Získání informací o stavu synchronizace
    getSyncInfo() {
        return {
            lastSync: this.lastSync,
            killStatsExists: fs.existsSync(KILL_STATS_FILE),
            playtimeExists: fs.existsSync(PLAYTIME_FILE),
            killFeedExists: fs.existsSync(KILL_FEED_FILE),
            killFeedItems: this.readKillFeed().length
        };
    }
}

// Export pro použití v serveru
module.exports = DiscordBotSync;

// Pokud je spuštěn přímo, spusť synchronizaci
if (require.main === module) {
    const sync = new DiscordBotSync();
    
    // Okamžitá synchronizace
    sync.sync();
    
    // Periodická synchronizace každých 30 sekund
    setInterval(() => {
        sync.sync();
    }, 30000);
    
    console.log('Discord bot synchronizace spuštěna');
}
