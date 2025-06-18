// server.js - SKUTEČNĚ KOMPLETNÍ VERZE - ČÁST A
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();

// Cesty k souborům Discord bota
const DISCORD_BOT_PATH = '/mnt/data/evrimabot';
const KILL_STATS_FILE = path.join(DISCORD_BOT_PATH, 'kill_stats.json');
const KILL_FEED_FILE = path.join(DISCORD_BOT_PATH, 'recent_kills.json');
const PLAYTIME_FILE = path.join(DISCORD_BOT_PATH, 'playtime_stats.json');
const KILLFEED_DB_PATH = path.join(DISCORD_BOT_PATH, 'killfeed.db');

// Explicitně definujeme cestu k .env souboru
const envPath = path.resolve(__dirname, '.env');

// Kontrola existence .env souboru
console.log(`Kontrola .env souboru na cestě: ${envPath}`);
if (fs.existsSync(envPath)) {
    console.log('.env soubor nalezen');
    
    const result = dotenv.config({ path: envPath });
    if (result.error) {
        console.error('Chyba při načítání .env souboru:', result.error);
    } else {
        console.log('Proměnné prostředí byly úspěšně načteny z .env souboru');
    }
} else {
    console.error(`CHYBA: .env soubor nebyl nalezen na cestě ${envPath}`);
    console.log('Vytváření výchozího .env souboru...');
    
    const defaultEnvContent = `RCON_HOST=87.236.195.202
RCON_PORT=1039
RCON_PASS=heslo
SESSION_SECRET=jursky-masakr-secret
STEAM_API_KEY=
ADMIN_STEAM_IDS=
APP_URL=http://jursky.karelkana.eu
WEBHOOK_TOKEN=discord-bot-webhook`;
    
    try {
        fs.writeFileSync(envPath, defaultEnvContent);
        console.log('Výchozí .env soubor byl vytvořen. Upravte jej podle potřeby.');
        dotenv.config({ path: envPath });
    } catch (err) {
        console.error('Chyba při vytváření výchozího .env souboru:', err);
    }
}

// Ujistěte se, že složka data existuje
const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('Vytvořena složka data/');
}

// Kontrola existence databáze a Discord bot souborů
console.log("--- DEBUG Soubory Discord bota ---");
console.log(`Discord bot path: ${DISCORD_BOT_PATH}`);
console.log(`📊 Kill stats JSON (PRIORITNÍ pro statistiky): ${fs.existsSync(KILL_STATS_FILE) ? '✅ EXISTS' : '❌ MISSING'} - ${KILL_STATS_FILE}`);
console.log(`⏱️ Playtime JSON: ${fs.existsSync(PLAYTIME_FILE) ? '✅ EXISTS' : '❌ MISSING'} - ${PLAYTIME_FILE}`);
console.log(`🔥 Kill feed JSON (NEPOUŽÍVÁ SE): ${fs.existsSync(KILL_FEED_FILE) ? '⚠️ EXISTS' : '❌ MISSING'} - ${KILL_FEED_FILE}`);
console.log(`🗄️ SQLite DB (JEDINÝ zdroj pro kill feed): ${fs.existsSync(KILLFEED_DB_PATH) ? '✅ EXISTS' : '❌ MISSING'} - ${KILLFEED_DB_PATH}`);
console.log("🔄 STRATEGIE: JSON pro statistiky, SQLite pro kill feed, bounty používá API killfeed");
console.log("----------------------------------------------------");

// Fallback hodnoty pro kritické proměnné
if (!process.env.RCON_HOST) {
    console.log('Fallback: Nastavení RCON_HOST');
    process.env.RCON_HOST = '87.236.195.202';
}

if (!process.env.RCON_PORT) {
    console.log('Fallback: Nastavení RCON_PORT');
    process.env.RCON_PORT = '1039';
}

if (!process.env.APP_URL) {
    console.log('Fallback: Nastavení APP_URL');
    process.env.APP_URL = 'http://jursky.karelkana.eu';
}

// Načtení ostatních modulů
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const EvrimaRCON = require('./gamercon-async');

// OPRAVENO - Správný import databázových služeb
const { db, parsePermissions } = require('./services/database');

// Debug proměnných pro RCON
console.log("--- DEBUG RCON proměnných ---");
console.log(`RCON_HOST z env: "${process.env.RCON_HOST}"`);
console.log(`RCON_PORT z env: "${process.env.RCON_PORT}"`);
console.log(`RCON_PORT jako číslo: ${parseInt(process.env.RCON_PORT)}`);
console.log(`APP_URL z env: "${process.env.APP_URL}"`);
console.log(`STEAM_API_KEY nastaven: ${process.env.STEAM_API_KEY ? 'Ano' : 'Ne'}`);
console.log("---------------------------");

// Načtení konfiguračních proměnných z .env souboru
const RCON_HOST = process.env.RCON_HOST;
const RCON_PORT = parseInt(process.env.RCON_PORT, 10);
const RCON_PASS = process.env.RCON_PASS;
const SESSION_SECRET = process.env.SESSION_SECRET || 'jursky-masakr-secret';
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const ADMIN_STEAM_IDS = process.env.ADMIN_STEAM_IDS;
const APP_URL = process.env.APP_URL || 'http://jursky.karelkana.eu';

// Kontrola platnosti hodnot
if (!RCON_HOST) {
    console.error("VAROVÁNÍ: RCON_HOST není definováno v .env souboru");
}

if (isNaN(RCON_PORT)) {
    console.error(`CHYBA: RCON_PORT není platné číslo nebo chybí: "${process.env.RCON_PORT}"`);
    console.error("Ujistěte se, že soubor .env obsahuje řádek RCON_PORT=1039 bez uvozovek");
}

if (!RCON_PASS) {
    console.error("VAROVÁNÍ: RCON_PASS není definováno v .env souboru");
}

if (!STEAM_API_KEY) {
    console.error("❌ KRITICKÁ CHYBA: STEAM_API_KEY není definováno v .env souboru");
    console.error("Steam přihlášení nebude fungovat bez platného API klíče");
    console.error("Získej API klíč na: https://steamcommunity.com/dev/apikey");
    // Nepokračuj bez Steam API klíče
    process.exit(1);
}

// Seznam admin Steam ID
const adminSteamIds = (ADMIN_STEAM_IDS || '').split(',').map(id => id.trim());

// Konfigurace aplikace
const app = express();
const port = process.env.PORT || 7682;
// server.js KOMPLETNÍ - ČÁST B (pokračování po části A)

// Pomocné funkce pro databázi
function queryDatabase(query, params = []) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(KILLFEED_DB_PATH)) {
            console.warn(`Databáze killfeed.db neexistuje na cestě: ${KILLFEED_DB_PATH}`);
            resolve([]);
            return;
        }
        
        const database = new sqlite3.Database(KILLFEED_DB_PATH);
        database.all(query, params, (err, rows) => {
            if (err) {
                console.error('Databázová chyba:', err);
                reject(err);
            } else {
                resolve(rows);
            }
        });
        database.close();
    });
}

// Pomocné funkce pro čtení JSON souboru
function readJsonFile(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(`Chyba při čtení ${filePath}:`, error);
    }
    return defaultValue;
}

// Pomocná funkce pro zápis JSON souboru
function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Chyba při zápisu ${filePath}:`, error);
        return false;
    }
}

// Funkce pro získání statistik z JSON souborů (prioritní zdroj)
function getStatsFromJSON() {
    try {
        console.log('Načítám data z JSON souborů (prioritní zdroj)');
        const killStats = readJsonFile(KILL_STATS_FILE, {});
        const playtimeStats = readJsonFile(PLAYTIME_FILE, {});

        const players = [];
        for (const [steamId, stats] of Object.entries(killStats)) {
            const player = {
                steamId: steamId,
                id: steamId,
                name: stats.player_name || `Player ${steamId}`,
                kills: parseInt(stats.kills || 0),
                deaths: parseInt(stats.deaths || 0),
                kd: (parseInt(stats.kills || 0)) / Math.max(parseInt(stats.deaths || 0), 1),
                streak: Math.max((parseInt(stats.kills || 0)) - (parseInt(stats.deaths || 0)), 0),
                bestStreak: Math.max((parseInt(stats.kills || 0)) - (parseInt(stats.deaths || 0)), 0),
                playtime: playtimeStats[steamId] || 0,
                dinos: stats.dinos || {},
                source: 'json'
            };
            players.push(player);
        }

        const topKills = players.filter(p => p.kills > 0).sort((a, b) => b.kills - a.kills);
        const topDeaths = players.filter(p => p.deaths > 0).sort((a, b) => b.deaths - a.deaths);
        const topKD = players.filter(p => p.kills >= 5 && p.deaths > 0).sort((a, b) => b.kd - a.kd);
        const topStreaks = players.filter(p => p.kills > 0).sort((a, b) => b.streak - a.streak);

        // Top dinosauři z JSON
        const dinoStats = {};
        players.forEach(player => {
            if (player.dinos) {
                for (const [dino, kills] of Object.entries(player.dinos)) {
                    if (!dinoStats[dino]) {
                        dinoStats[dino] = { name: dino, kills: 0, deaths: 0, source: 'json' };
                    }
                    dinoStats[dino].kills += parseInt(kills);
                }
            }
        });

        const topDinos = Object.values(dinoStats).sort((a, b) => b.kills - a.kills);

        const totalPlayers = players.filter(p => p.kills > 0 || p.deaths > 0).length;
        const totalKills = players.reduce((sum, p) => sum + p.kills, 0);
        const totalDeaths = players.reduce((sum, p) => sum + p.deaths, 0);
        const avgKD = totalKills / Math.max(totalDeaths, 1);

        console.log(`JSON: Načteno ${players.length} hráčů, ${totalKills} killů, ${totalDeaths} deaths`);

        return {
            topKills,
            topDeaths,
            topKD,
            topStreaks,
            topDinos,
            overview: {
                totalPlayers,
                totalKills,
                totalDeaths,
                avgKD
            },
            source: 'json'
        };
    } catch (error) {
        console.error('Chyba při načítání statistik z JSON:', error);
        return {
            topKills: [],
            topDeaths: [],
            topKD: [],
            topStreaks: [],
            topDinos: [],
            overview: {},
            source: 'json-error'
        };
    }
}

// Funkce pro hledání hráče v JSON
function searchPlayerInJSON(searchTerm) {
    try {
        console.log(`Hledám hráče "${searchTerm}" v JSON souborech`);
        const killStats = readJsonFile(KILL_STATS_FILE, {});
        const playtimeStats = readJsonFile(PLAYTIME_FILE, {});

        let foundPlayer = null;

        if (killStats[searchTerm]) {
            foundPlayer = {
                steamId: searchTerm,
                stats: killStats[searchTerm]
            };
        } else {
            for (const [steamId, stats] of Object.entries(killStats)) {
                if (stats.player_name && stats.player_name.toLowerCase().includes(searchTerm.toLowerCase())) {
                    foundPlayer = {
                        steamId: steamId,
                        stats: stats
                    };
                    break;
                }
            }
        }

        if (!foundPlayer) {
            console.log(`Hráč "${searchTerm}" nenalezen v JSON`);
            return null;
        }

        const stats = foundPlayer.stats;
        const playerData = {
            steamId: foundPlayer.steamId,
            id: foundPlayer.steamId,
            name: stats.player_name || `Player ${foundPlayer.steamId}`,
            kills: parseInt(stats.kills || 0),
            deaths: parseInt(stats.deaths || 0),
            kd: (parseInt(stats.kills || 0)) / Math.max(parseInt(stats.deaths || 0), 1),
            streak: Math.max((parseInt(stats.kills || 0)) - (parseInt(stats.deaths || 0)), 0),
            bestStreak: Math.max((parseInt(stats.kills || 0)) - (parseInt(stats.deaths || 0)), 0),
            playtime: playtimeStats[foundPlayer.steamId] || 0,
            dinos: stats.dinos || {},
            source: 'json'
        };

        console.log(`Hráč nalezen v JSON: ${playerData.name} (${playerData.kills} killů)`);
        return playerData;
    } catch (error) {
        console.error('Chyba při vyhledávání hráče v JSON:', error);
        return null;
    }
}

// Hlavní funkce pro statistiky - JSON prioritní
async function getStatsFromDatabase() {
    try {
        console.log('Načítám statistiky - JSON je prioritní');
        return getStatsFromJSON();
    } catch (error) {
        console.error('Chyba při načítání statistik:', error);
        return {
            topKills: [],
            topDeaths: [],
            topKD: [],
            topStreaks: [],
            topDinos: [],
            overview: {},
            source: 'error'
        };
    }
}

// OPRAVENO - Hlavní funkce pro kill feed s přidáním ID a Steam ID pro bounty systém
async function getKillFeedFromDatabase(limit = 20) {
    try {
        console.log('Načítám kill feed z SQLite databáze (jediný zdroj)');
        
        // Kill feed existuje pouze v SQLite databázi
        if (fs.existsSync(KILLFEED_DB_PATH)) {
            const kills = await queryDatabase(`
                SELECT id, timestamp, killer_name as killer, killer_dino as killerDino, 
                       victim_name as victim, victim_dino as victimDino, is_natural_death as natural,
                       killer_id, victim_id, created_at
                FROM kills 
                ORDER BY created_at DESC 
                LIMIT ?
            `, [limit]);

            return kills.map(kill => ({
                ...kill,
                natural: Boolean(kill.natural),
                source: 'sqlite'
            }));
        } else {
            console.warn('SQLite databáze neexistuje - kill feed není k dispozici');
            return [];
        }
    } catch (error) {
        console.error('Chyba při načítání kill feedu ze SQLite:', error);
        return [];
    }
}

// Hlavní funkce pro hledání hráče - JSON prioritní
async function searchPlayerInDatabase(searchTerm) {
    try {
        console.log(`Hledám hráče "${searchTerm}" - JSON je prioritní`);
        return searchPlayerInJSON(searchTerm);
    } catch (error) {
        console.error('Chyba při hledání hráče:', error);
        return null;
    }
}

// Nastavení middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session konfigurace
app.use(session({
    secret: SESSION_SECRET,
    name: 'isle-tracker-session',
    resave: true,
    saveUninitialized: true,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: false
    }
}));

// Passport konfigurace s detailním debuggingem
app.use(passport.initialize());
app.use(passport.session());

// Debug Steam strategy před vytvořením
console.log('🔧 Konfigurace Steam Strategy:', {
    returnURL: `${APP_URL}/auth/steam/return`,
    realm: APP_URL,
    hasApiKey: !!STEAM_API_KEY,
    apiKeyLength: STEAM_API_KEY ? STEAM_API_KEY.length : 0
});

passport.use(new SteamStrategy({
    returnURL: `${APP_URL}/auth/steam/return`,
    realm: APP_URL,
    apiKey: STEAM_API_KEY
}, async (identifier, profile, done) => {
    try {
        console.log('🔄 Steam strategy callback spuštěn');
        console.log('📋 Identifier:', identifier);
        console.log('📋 Profile data:', {
            id: profile ? profile.id : 'missing',
            displayName: profile ? profile.displayName : 'missing',
            profileKeysCount: profile ? Object.keys(profile).length : 0
        });
        
        if (!profile || !profile.id) {
            console.error('❌ Chybí Steam profile data');
            return done(new Error('Chybí Steam profile data'), null);
        }
        
        const steamId = profile.id;
        const isAdmin = adminSteamIds.includes(steamId);
        
        profile.isAdmin = isAdmin;
        console.log('✅ Steam autentizace úspěšná:', {
            id: profile.id,
            displayName: profile.displayName,
            isAdmin: isAdmin
        });
        
        return done(null, profile);
    } catch (error) {
        console.error('❌ Chyba při zpracování Steam profilu:', error);
        return done(error, null);
    }
}));

passport.serializeUser((user, done) => {
    try {
        console.log('🔄 Serializace uživatele:', user.id);
        done(null, user);
    } catch (error) {
        console.error('❌ Chyba při serializaci uživatele:', error);
        done(error);
    }
});

passport.deserializeUser((obj, done) => {
    try {
        console.log('🔄 Deserializace uživatele:', obj ? obj.id : 'null');
        done(null, obj);
    } catch (error) {
        console.error('❌ Chyba při deserializaci uživatele:', error);
        done(error);
    }
});
// server.js KOMPLETNÍ - ČÁST C (pokračování po části B)

// Optimalizovaný RCON Manager s trvalým připojením a 2-minutovou cache
class RconManager {
    constructor() {
        this.rcon = null;
        this.connected = false;
        this.connecting = false;
        this.lastActivity = Date.now();
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 3;
        this.reconnectDelay = 5000;
        
        // NOVÁ Cache pro data - uchovává data až 2 minuty
        this.cachedPlayerData = [];
        this.cachedServerInfo = null;
        this.lastSuccessfulDataUpdate = null;
        this.CACHE_DURATION = 2 * 60 * 1000; // 2 minuty v ms
        
        // Správné Evrima RCON příkazy
        this.commands = {
            playerinfo: Buffer.from([0x02, 0x77, 0x00]),
            playerlist: Buffer.from([0x02, 0x40, 0x00]),
            serverinfo: Buffer.from([0x02, 0x12, 0x00]),
            status: Buffer.from([0x02, 0x01, 0x00])
        };
        
        this.dinoClassMappings = {
            'BP_Carnotaurus_C': 'Carnotaurus',
            'BP_Utahraptor_C': 'Utahraptor',
            'BP_Allosaurus_C': 'Allosaurus',
            'BP_Tyrannosaurus_C': 'Tyrannosaurus',
            'BP_TyrannosaurusJuvenile_C': 'Tyrannosaurus (Juvenile)',
            'BP_Deinosuchus_C': 'Deinosuchus',
            'BP_Stegosaurus_C': 'Stegosaurus',
            'BP_Tenontosaurus_C': 'Tenontosaurus',
            'BP_Triceratops_C': 'Triceratops',
            'BP_TriceratopsJuvenile_C': 'Triceratops (Juvenile)',
            'BP_Pachycephalosaurus_C': 'Pachycephalosaurus',
            'BP_Omniraptor_C': 'Omniraptor',
            'BP_Human_C': 'Human',
            'BP_Diabloceratops_C': 'Diabloceratops',
            'BP_Hypsilophodon_C': 'Hypsilophodon',
            'BP_Maiasaura_C': 'Maiasaura',
            'BP_Ceratosaurus_C': 'Ceratosaurus',
            'BP_Dilophosaurus_C': 'Dilophosaurus',
            'BP_Herrerasaurus_C': 'Herrerasaurus',
            'BP_Pteranodon_C': 'Pteranodon',
            'BP_Troodon_C': 'Troodon',
            'BP_Beipiaosaurus_C': 'Beipiaosaurus',
            'BP_Gallimimus_C': 'Gallimimus',
            'BP_Dryosaurus_C': 'Dryosaurus',
            'BP_Compsognathus_C': 'Compsognathus',
            'BP_Pterodactylus_C': 'Pterodactylus',
            'BP_Boar_C': 'Boar',
            'BP_Deer_C': 'Deer',
            'BP_Goat_C': 'Goat',
            'BP_Seaturtle_C': 'Seaturtle'
        };
        
        this.carnivores = [
            'Carnotaurus', 'Utahraptor', 'Allosaurus', 'Tyrannosaurus', 
            'Deinosuchus', 'Ceratosaurus', 'Dilophosaurus', 'Herrerasaurus', 
            'Troodon', 'Compsognathus'
        ];
        
        this.herbivores = [
            'Stegosaurus', 'Tenontosaurus', 'Triceratops', 'Pachycephalosaurus',
            'Diabloceratops', 'Hypsilophodon', 'Maiasaura', 'Beipiaosaurus', 
            'Gallimimus', 'Dryosaurus'
        ];

        this.initialize();
    }

    // NOVÁ metoda - kontrola platnosti cache
    isCacheValid() {
        if (!this.lastSuccessfulDataUpdate) return false;
        const age = Date.now() - this.lastSuccessfulDataUpdate;
        return age < this.CACHE_DURATION;
    }

    // NOVÁ metoda - získání dat s fallback na cache
    async getPlayerData() {
        try {
            // Pokusit se o fresh data
            const response = await this.sendCommand('playerinfo');
            const players = this.parsePlayerInfo(response);
            
            // Aktualizovat cache při úspěchu
            this.cachedPlayerData = players;
            this.lastSuccessfulDataUpdate = Date.now();
            
            console.log(`✅ Fresh RCON data: ${players.length} hráčů`);
            return {
                players: players,
                fromCache: false,
                cacheAge: 0
            };
            
        } catch (error) {
            console.warn(`⚠️ RCON selhalo: ${error.message}`);
            
            // Použít cache pokud je platná
            if (this.isCacheValid()) {
                const cacheAge = Date.now() - this.lastSuccessfulDataUpdate;
                console.log(`📋 Používám cached data (${Math.round(cacheAge / 1000)}s staré)`);
                
                return {
                    players: this.cachedPlayerData,
                    fromCache: true,
                    cacheAge: cacheAge
                };
            } else {
                console.error('❌ Žádná platná cached data k dispozici');
                throw new Error('RCON nedostupné a cache prošla');
            }
        }
    }

    // NOVÁ metoda - získání server info s cache
    async getServerInfoData() {
        try {
            const response = await this.sendCommand('serverinfo');
            const serverInfo = this.parseServerInfo(response);
            
            // Aktualizovat cache
            this.cachedServerInfo = serverInfo;
            
            return {
                serverInfo: serverInfo,
                fromCache: false
            };
            
        } catch (error) {
            console.warn(`⚠️ Server info selhalo: ${error.message}`);
            
            if (this.cachedServerInfo && this.isCacheValid()) {
                return {
                    serverInfo: this.cachedServerInfo,
                    fromCache: true
                };
            } else {
                return {
                    serverInfo: this.getDefaultServerInfo(),
                    fromCache: false
                };
            }
        }
    }

    async initialize() {
        try {
            console.log('🔄 Inicializace RCON - vytváření trvalého připojení...');
            await this.ensureConnection();
            
            // Kontrola připojení každých 2 minuty
            setInterval(() => this.healthCheck(), 2 * 60 * 1000);
            
            if (this.connected) {
                console.log('✅ RCON připojeno - spouštění auto-refresh dat');
                this.startAutoRefresh();
            }
        } catch (error) {
            console.error('❌ Chyba při inicializaci RCON:', error);
        }
    }

    startAutoRefresh() {
        // Auto-refresh každých 30 sekund - používá existující připojení
        setInterval(async () => {
            try {
                if (this.connected && !this.connecting) {
                    console.log('🔄 Auto-refresh: Obnovování dat hráčů...');
                    const result = await this.getPlayerData();
                    console.log(`✅ Auto-refresh: ${result.players.length} hráčů${result.fromCache ? ' (z cache)' : ''}`);
                }
            } catch (error) {
                console.error('⚠️ Chyba při auto-refresh:', error.message);
                this.markConnectionAsBroken();
            }
        }, 30000);
    }

    async healthCheck() {
        try {
            if (!this.connected || this.connecting) {
                console.log('🔍 Health check: Připojení není aktivní, přeskakuji');
                return;
            }

            console.log('🔍 Health check: Testování RCON připojení...');
            await this.sendCommandDirect('status');
            console.log('✅ Health check: Připojení je v pořádku');
            
            this.connectionAttempts = 0;
            
        } catch (error) {
            console.warn('⚠️ Health check: Připojení nereaguje:', error.message);
            this.markConnectionAsBroken();
        }
    }

    markConnectionAsBroken() {
        console.log('💥 Označuji připojení jako vadné');
        this.connected = false;
        if (this.rcon) {
            try {
                this.rcon.socket?.destroy();
            } catch (e) {
                // Ignorujeme chyby při čištění
            }
            this.rcon = null;
        }
    }

    async ensureConnection() {
        if (this.connecting) {
            console.log('⏳ Čekání na dokončení probíhajícího připojení...');
            await this.waitForConnection();
            return this.connected;
        }

        if (this.connected && this.rcon) {
            return true;
        }

        return await this.connect();
    }

    async waitForConnection() {
        const maxWait = 10000;
        const startTime = Date.now();
        
        while (this.connecting && (Date.now() - startTime) < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    async connect() {
        if (this.connecting) {
            console.log('⏳ Připojení již probíhá, čekám...');
            await this.waitForConnection();
            return this.connected;
        }

        this.connecting = true;
        
        try {
            if (this.rcon) {
                try {
                    await this.rcon.close();
                } catch (e) {
                    console.log('🧹 Chyba při čištění starého připojení (ignorováno)');
                }
                this.rcon = null;
            }

            console.log(`🔗 Vytváření nového RCON připojení: ${RCON_HOST}:${RCON_PORT}`);
            
            if (!RCON_HOST) {
                throw new Error('RCON_HOST není nastaven');
            }
            
            if (isNaN(RCON_PORT)) {
                throw new Error(`RCON_PORT není platné číslo: ${process.env.RCON_PORT}`);
            }
            
            this.rcon = new EvrimaRCON(RCON_HOST, RCON_PORT, RCON_PASS);
            await this.rcon.connect();
            
            this.connected = true;
            this.connectionAttempts = 0;
            this.lastActivity = Date.now();
            
            console.log(`✅ RCON trvalé připojení vytvořeno: ${RCON_HOST}:${RCON_PORT}`);
            return true;
            
        } catch (error) {
            this.connected = false;
            this.connectionAttempts++;
            
            console.error(`❌ Chyba při vytváření RCON připojení (pokus ${this.connectionAttempts}/${this.maxConnectionAttempts}):`, error.message);
            
            if (this.connectionAttempts < this.maxConnectionAttempts) {
                console.log(`⏳ Čekání ${this.reconnectDelay}ms před dalším pokusem...`);
                await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
                
                this.connecting = false;
                return await this.connect();
            } else {
                console.error('💀 Dosažen maximální počet pokusů o připojení');
                throw new Error(`Nelze se připojit k RCON po ${this.maxConnectionAttempts} pokusech`);
            }
        } finally {
            this.connecting = false;
        }
    }

    async sendCommand(command) {
        console.log(`📤 RCON příkaz: ${command}`);
        
        await this.ensureConnection();
        
        if (!this.connected) {
            throw new Error('RCON připojení se nepodařilo navázat');
        }
        
        return await this.sendCommandDirect(command);
    }

    async sendCommandDirect(command) {
        this.lastActivity = Date.now();
        
        const commandBuffer = this.commands[command];
        if (!commandBuffer) {
            throw new Error(`Neznámý příkaz: ${command}`);
        }
        
        try {
            const response = await this.rcon.send_command(commandBuffer);
            
            if (!response || response.length === 0) {
                console.warn(`⚠️ Prázdná odpověď pro příkaz ${command}`);
                return '';
            }
            
            console.log(`✅ ${command}: Odpověď ${response.length} znaků`);
            return response;
            
        } catch (error) {
            console.error(`💥 Chyba při ${command}:`, error.message);
            this.markConnectionAsBroken();
            throw error;
        }
    }

    async getPlayerInfoBySteamId(steamId) {
        if (!steamId) {
            throw new Error('Steam ID není zadáno');
        }
        
        console.log(`🔍 Hledání hráče ID: ${steamId}`);
        
        try {
            const result = await this.getPlayerData();
            const player = result.players.find(p => p.steamId === steamId);
            
            if (!player) {
                console.log(`❌ Hráč ${steamId} nebyl nalezen`);
                return null;
            }
            
            console.log(`✅ Hráč nalezen: ${player.name} (${player.dino})${result.fromCache ? ' [CACHE]' : ''}`);
            return player;
            
        } catch (error) {
            console.error('Chyba při hledání hráče:', error);
            return null;
        }
    }

    async close() {
        console.log('🔒 Uzavírání RCON připojení...');
        
        this.connected = false;
        this.connecting = false;
        
        if (this.rcon) {
            try {
                await this.rcon.close();
                console.log('✅ RCON připojení úspěšně uzavřeno');
            } catch (error) {
                console.error('⚠️ Chyba při uzavírání RCON:', error.message);
            }
            this.rcon = null;
        }
    }

    getConnectionStatus() {
        return {
            connected: this.connected,
            connecting: this.connecting,
            connectionAttempts: this.connectionAttempts,
            lastActivity: new Date(this.lastActivity).toISOString(),
            cachedPlayers: this.cachedPlayerData.length,
            hasServerInfo: !!this.cachedServerInfo,
            cacheValid: this.isCacheValid(),
            cacheAge: this.lastSuccessfulDataUpdate ? Date.now() - this.lastSuccessfulDataUpdate : null,
            lastSuccessfulUpdate: this.lastSuccessfulDataUpdate ? new Date(this.lastSuccessfulDataUpdate).toISOString() : null
        };
    }

    parsePlayerInfo(response) {
        try {
            console.log('📊 Parsování dat hráčů...');
            
            if (!response || response.length === 0) {
                console.warn('⚠️ Prázdná odpověď při parsování');
                return [];
            }
            
            let responseString = response.toString()
                .replace(/\[\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}\]\s*/g, '')
                .trim();
            
            const playerBlocks = responseString.split(/(?=(?:PlayerDataName:|Name:))/)
                .filter(block => block.trim().length > 0);
            
            console.log(`📦 Nalezeno ${playerBlocks.length} bloků dat`);
            
            const players = [];
            let playerId = 1;

            for (const block of playerBlocks) {
                if (!block.trim()) continue;
                
                try {
                    const nameMatch = block.match(/(?:PlayerDataName|Name):\s*([^,\n\r]+)/);
                    const playerIdMatch = block.match(/PlayerID:\s*(\d+)/);
                    const locationMatch = block.match(/Location:\s*X=(-?\d+\.?\d*)\s*Y=(-?\d+\.?\d*)\s*Z=(-?\d+\.?\d*)/);
                    const classMatch = block.match(/Class:\s*(BP_[a-zA-Z0-9_]+)/);
                    const growthMatch = block.match(/Growth:\s*(\d+\.?\d*)/);
                    const healthMatch = block.match(/Health:\s*(\d+\.?\d*)/);
                    const staminaMatch = block.match(/Stamina:\s*(\d+\.?\d*)/);
                    const hungerMatch = block.match(/Hunger:\s*(\d+\.?\d*)/);
                    const thirstMatch = block.match(/Thirst:\s*(\d+\.?\d*)/);
                    
                    if (!nameMatch || !playerIdMatch || !locationMatch || !classMatch) {
                        continue;
                    }
                    
                    const name = nameMatch[1].trim();
                    const steamId = playerIdMatch[1];
                    const x = parseFloat(locationMatch[1]);
                    const y = parseFloat(locationMatch[2]);
                    const z = parseFloat(locationMatch[3]);
                    const dinoClass = classMatch[1];
                    
                    const dinoName = this.dinoClassMappings[dinoClass] || dinoClass;
                    
                    let dinoType = 'other';
                    if (this.carnivores.some(carnivore => dinoName.includes(carnivore))) {
                        dinoType = 'carnivore';
                    } else if (this.herbivores.some(herbivore => dinoName.includes(herbivore))) {
                        dinoType = 'herbivore';
                    }
                    
                    const player = {
                        id: playerId++,
                        name,
                        steamId,
                        x,
                        y,
                        z,
                        dino: dinoName,
                        dinoType,
                        growth: growthMatch ? parseFloat(growthMatch[1]) : null,
                        health: healthMatch ? parseFloat(healthMatch[1]) : null,
                        stamina: staminaMatch ? parseFloat(staminaMatch[1]) : null,
                        hunger: hungerMatch ? parseFloat(hungerMatch[1]) : null,
                        thirst: thirstMatch ? parseFloat(thirstMatch[1]) : null
                    };
                    
                    players.push(player);
                    
                } catch (parseError) {
                    console.error('⚠️ Chyba při parsování hráče:', parseError.message);
                }
            }
            
            console.log(`✅ Úspěšně parsováno ${players.length} hráčů`);
            return players;
        } catch (error) {
            console.error('❌ Chyba při parsování dat hráčů:', error);
            return [];
        }
    }

    parseServerInfo(response) {
        try {
            if (!response || response.length === 0) {
                return this.getDefaultServerInfo();
            }
            
            const responseString = response.toString()
                .replace(/\[\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}\]\s*/g, '')
                .trim();
            
            if (responseString.includes('PlayerDataName:') || responseString.includes('PlayerID:')) {
                console.log('🔄 Server vrátil player data - extrahuji počet hráčů');
                const playerCount = (responseString.match(/PlayerID:/g) || []).length;
                
                const info = this.getDefaultServerInfo();
                info.currentPlayers = playerCount;
                info.note = `${playerCount} hráčů online (server info nedostupné)`;
                return info;
            }
            
            const serverNameMatch = responseString.match(/(?:ServerDetailsServerName|ServerName):\s*([^,\n\r]+)/);
            const serverMapMatch = responseString.match(/(?:ServerMap|Map):\s*([^,\n\r]+)/);
            const maxPlayersMatch = responseString.match(/(?:ServerMaxPlayers|MaxPlayers):\s*(\d+)/);
            const currentPlayersMatch = responseString.match(/(?:ServerCurrentPlayers|CurrentPlayers):\s*(\d+)/);
            const dayLengthMatch = responseString.match(/(?:ServerDayLengthMinutes|DayLength):\s*(\d+)/);
            const nightLengthMatch = responseString.match(/(?:ServerNightLengthMinutes|NightLength):\s*(\d+)/);
            
            const serverInfo = {
                name: serverNameMatch ? serverNameMatch[1].trim() : 'Evrima Server',
                map: serverMapMatch ? serverMapMatch[1].trim() : 'Gateway',
                maxPlayers: maxPlayersMatch ? parseInt(maxPlayersMatch[1]) : 120,
                currentPlayers: currentPlayersMatch ? parseInt(currentPlayersMatch[1]) : 0,
                dayLength: dayLengthMatch ? parseInt(dayLengthMatch[1]) : 60,
                nightLength: nightLengthMatch ? parseInt(nightLengthMatch[1]) : 30
            };
            
            this.cachedServerInfo = serverInfo;
            
            console.log('✅ Server info parsováno:', serverInfo);
            return serverInfo;
        } catch (error) {
            console.error('❌ Chyba při parsování server info:', error);
            return this.getDefaultServerInfo();
        }
    }
    
    getDefaultServerInfo() {
        return {
            name: 'Evrima Server',
            map: 'Gateway',
            maxPlayers: 120,
            currentPlayers: 0,
            dayLength: 60,
            nightLength: 30,
            note: 'Výchozí hodnoty'
        };
    }
}

// Vytvoření instance RCON manažeru
const rconManager = new RconManager();
// server.js KOMPLETNÍ - ČÁST D (pokračování po části C)

// OPRAVENO - Inicializace bounty systému PO všech závislých službách
let bountyService = null;
setTimeout(async () => {
    try {
        const BountyService = require('./services/bounty');
        bountyService = new BountyService();
        console.log('✅ Bounty service inicializován s kill feed integrací');
    } catch (error) {
        console.error('❌ Chyba při inicializaci bounty service:', error);
    }
}, 3000); // Počkat 3 sekundy na inicializaci ostatních služeb

// Middleware pro kontrolu přihlášení
const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ 
        success: false, 
        message: 'Uživatel není přihlášen',
        loginUrl: '/auth/steam'
    });
};

// Middleware pro kontrolu admin práv
const ensureAdmin = (req, res, next) => {
    if (req.isAuthenticated() && req.user.isAdmin) {
        return next();
    }
    res.status(403).json({ 
        success: false, 
        message: 'Nedostatečná oprávnění'
    });
};

// Middleware pro ověření přihlášení
function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Nepřihlášen' });
    }
    next();
}
// NOVÉ - SPRÁVNÉ
// Bounty active endpoint - OPRAVENÁ VERZE bez bountyService
app.get('/api/bounty/active', async (req, res) => {
    try {
        const bountyDbPath = path.join(__dirname, 'data', 'bounty.db');
        
        // Zkontroluj, jestli databáze existuje
        if (!fs.existsSync(bountyDbPath)) {
            console.log('Bounty databáze neexistuje:', bountyDbPath);
            return res.json({ success: true, bounties: [] });
        }
        
        const db = new sqlite3.Database(bountyDbPath);
        
        db.all(
            `SELECT * FROM bounties 
             WHERE status = 'active' 
             AND expires_at > datetime('now')
             ORDER BY amount DESC`,
            [],
            (err, rows) => {
                db.close();
                
                if (err) {
                    console.error('Bounty DB error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                console.log(`📊 Nalezeno ${(rows || []).length} aktivních bounty`);
                
                res.json({
                    success: true,
                    bounties: (rows || []).map(bounty => ({
                        id: bounty.id,
                        target_steam_id: bounty.target_steam_id,
                        target_name: bounty.target_name,
                        amount: bounty.amount,
                        placed_by_steam_id: bounty.placed_by_steam_id,
                        placed_by_name: bounty.placed_by_name,
                        expires_at: bounty.expires_at,
                        created_at: bounty.created_at
                    }))
                });
            }
        );
    } catch (error) {
        console.error('Bounty active error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});
// Bounty overview stats
app.get('/api/bounty-overview', async (req, res) => {
    try {
        if (!bountyService) {
            return res.status(503).json({ error: 'Bounty service není inicializován' });
        }

        const overview = await bountyService.getBountyOverview();
        
        res.json({
            success: true,
            totalPlayers: overview.totalPlayers,
            totalBounty: overview.totalBounty,
            averageBounty: Math.round(overview.averageBounty || 0),
            maxBounty: overview.maxBounty,
            minBounty: overview.minBounty,
            totalSpent: overview.totalSpent || 0,
            circulatingBounty: (overview.totalBounty || 0) - (overview.totalSpent || 0)
        });
    } catch (error) {
        console.error('Bounty overview error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});
// Middleware pro kontrolu JSON souborů
app.use('/api/stats', (req, res, next) => {
    const jsonExists = fs.existsSync(KILL_STATS_FILE);
    
    if (!jsonExists) {
        console.warn('JSON soubory nejsou k dispozici');
        return res.status(503).json({ 
            error: 'Statistiky nejsou k dispozici',
            topKills: [],
            topDeaths: [],
            topKD: [],
            topStreaks: [],
            topDinos: [],
            overview: {}
        });
    }
    
    next();
});

// Autentizační routy s lepším error handlingem
app.get('/auth/steam', (req, res, next) => {
    try {
        console.log('🔄 Zahájení Steam autentizace, redirect URL:', `${APP_URL}/auth/steam/return`);
        next();
    } catch (error) {
        console.error('❌ Chyba při zahájení Steam autentizace:', error);
        res.status(500).json({ error: 'Chyba při zahájení autentizace' });
    }
}, passport.authenticate('steam', {
    failureRedirect: '/?error=steam_auth_failed'
}));

app.get('/auth/steam/return', (req, res, next) => {
    try {
        console.log('🔄 Steam callback obdržen, query keys:', Object.keys(req.query));
        console.log('🔄 OpenID mode:', req.query['openid.mode']);
        console.log('🔄 OpenID identity:', req.query['openid.identity']);
        next();
    } catch (error) {
        console.error('❌ Chyba při zpracování Steam callback:', error);
        res.redirect('/?error=callback_error');
    }
}, (req, res, next) => {
    // Custom error handler pro passport authenticate
    passport.authenticate('steam', (err, user, info) => {
        console.log('🔄 Passport authenticate callback:', {
            hasError: !!err,
            hasUser: !!user,
            hasInfo: !!info,
            errorMessage: err ? err.message : null,
            infoMessage: info ? JSON.stringify(info) : null
        });
        
        if (err) {
            console.error('❌ Passport authentication error:', err);
            return res.redirect('/?error=passport_error&message=' + encodeURIComponent(err.message));
        }
        
        if (!user) {
            console.error('❌ Žádný uživatel vrácen z passport');
            return res.redirect('/?error=no_user&info=' + encodeURIComponent(JSON.stringify(info)));
        }
        
        // Manuální přihlášení uživatele
        req.logIn(user, (loginErr) => {
            if (loginErr) {
                console.error('❌ Chyba při req.logIn:', loginErr);
                return res.redirect('/?error=login_error&message=' + encodeURIComponent(loginErr.message));
            }
            
            console.log('✅ Uživatel úspěšně přihlášen:', user.id);
            res.redirect('/?login=success');
        });
    })(req, res, next);
});

// NOVÝ webhook endpoint pro Discord bot kill feed notifikace
app.post('/webhook/kill', express.json(), (req, res) => {
    try {
        const { token, killData } = req.body;
        
        // Ověření tokenu (nastavit v .env jako WEBHOOK_TOKEN)
        if (token !== process.env.WEBHOOK_TOKEN) {
            console.warn('⚠️ Neplatný webhook token');
            return res.status(401).json({ error: 'Neplatný token' });
        }
        
        console.log('📡 Webhook kill obdržen:', killData);
        
        // Předat data bounty service pro okamžité zpracování
        if (bountyService && killData && !killData.is_natural_death && !killData.natural) {
            console.log('🎯 Předávám kill data bounty service');
            bountyService.processKillForBounty(killData).catch(error => {
                console.error('Chyba při zpracování webhook killu:', error);
            });
        } else {
            console.log('⏭️ Přeskakuji webhook - bounty service není připraven nebo je to natural death');
        }
        
        res.json({ success: true, message: 'Kill zpracován' });
        
    } catch (error) {
        console.error('Chyba webhook kill:', error);
        res.status(500).json({ error: 'Chyba serveru' });
    }
});

// Bounty API router - načte se až po inicializaci služby
setTimeout(() => {
    try {
        const bountyRouter = require('./api-routes/bounty');
        app.use('/api/bounty', bountyRouter);
        console.log('✅ Bounty API router načten');
    } catch (error) {
        console.error('❌ Chyba při načítání Bounty API routeru:', error);
    }
}, 4000);

// OPRAVENÝ kombinovaný endpoint pro zamezení RCON konfliktů
app.get('/api/combined-data', async (req, res) => {
    try {
        console.log('📡 Combined-data endpoint volán');
        
        // Získat data hráčů
        const result = await rconManager.getPlayerData();
        const players = result.players || [];
        
        // NOVÉ - uložit data pro bounty systém
        app.set('playersData', players);
        
        // Filtrovat data podle oprávnění (stejná logika jako v původním /api/playerlist)
        const isAuthenticated = req.isAuthenticated();
        const isAdmin = isAuthenticated && req.user && req.user.isAdmin;
        const userId = isAuthenticated ? req.user.id : null;
        
        let friendPerms = {};
        
        if (isAuthenticated && userId) {
            try {
                const friendships = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT 
                            CASE 
                                WHEN user_id = ? THEN friend_id 
                                ELSE user_id 
                            END as friend_steam_id,
                            CASE 
                                WHEN user_id = ? THEN friend_permissions 
                                ELSE user_permissions 
                            END as friend_permissions
                        FROM friends
                        WHERE (user_id = ? OR friend_id = ?)
                        AND status = 'accepted'
                    `, [userId, userId, userId, userId], (err, rows) => {
                        if (err) {
                            console.error('Chyba při získávání přátel:', err);
                            resolve([]);
                        } else {
                            resolve(rows || []);
                        }
                    });
                });
                
                friendships.forEach(f => {
                    friendPerms[f.friend_steam_id] = parsePermissions(f.friend_permissions);
                });
                
            } catch (error) {
                console.error('Chyba při získávání oprávnění přátel:', error);
            }
        }
        
        const playerInfo = players.map(player => {
            const info = {
                id: player.id,
                name: player.name,
                dino: player.dino,
                dinoType: player.dinoType,
                steamId: player.steamId,
                growth: player.growth
            };
            
            if (isAuthenticated) {
                if (player.steamId === userId) {
                    info.x = player.x;
                    info.y = player.y;
                    info.z = player.z;
                    info.health = player.health;
                    info.hunger = player.hunger;
                    info.thirst = player.thirst;
                    info.stamina = player.stamina;
                }
                else if (isAdmin) {
                    info.x = player.x;
                    info.y = player.y;
                    info.z = player.z;
                    info.health = player.health;
                    info.hunger = player.hunger;
                    info.thirst = player.thirst;
                    info.stamina = player.stamina;
                }
                else if (friendPerms[player.steamId]) {
                    const perms = friendPerms[player.steamId];
                    
                    if (perms.location) {
                        info.x = player.x;
                        info.y = player.y;
                        info.z = player.z;
                    }
                    
                    if (perms.stats) {
                        info.health = player.health;
                        info.hunger = player.hunger;
                        info.thirst = player.thirst;
                        info.stamina = player.stamina;
                    }
                }
            }
            
            return info;
        });
        
        console.log(`✅ Combined data: ${playerInfo.length} hráčů${result.fromCache ? ' (z cache)' : ''}`);
        
        res.json({ 
            success: true, 
            players: playerInfo,
            auth: { isAuthenticated, isAdmin },
            meta: {
                fromCache: result.fromCache,
                playerDataFromCache: result.fromCache,
                playerCacheAge: result.cacheAge,
                cacheValid: rconManager.isCacheValid(),
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Chyba při combined-data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API endpointy s cache podporou
app.get('/api/auth-test', (req, res) => {
    console.log('Test autentizačního stavu:', {
        isAuthenticated: req.isAuthenticated(),
        user: req.user ? {
            id: req.user.id,
            displayName: req.user.displayName,
            isAdmin: req.user.isAdmin
        } : null,
        sessionID: req.sessionID
    });
    
    res.json({
        isAuthenticated: req.isAuthenticated(),
        user: req.user ? {
            id: req.user.id,
            displayName: req.user.displayName,
            isAdmin: req.user.isAdmin
        } : null
    });
});

app.get('/api/test-database', async (req, res) => {
    try {
        console.log('Test JSON souborů a SQLite databáze');
        
        const results = {
            json: { exists: false, working: false },
            sqlite: { exists: false, working: false },
            bounty: { exists: false, working: false },
            paths: {
                killStats: KILL_STATS_FILE,
                killFeed: KILL_FEED_FILE,
                playtime: PLAYTIME_FILE,
                database: KILLFEED_DB_PATH
            }
        };
        
        // Test JSON souborů (pro statistiky)
        const jsonExists = fs.existsSync(KILL_STATS_FILE);
        results.json.exists = jsonExists;
        
        if (jsonExists) {
            try {
                const killStats = readJsonFile(KILL_STATS_FILE, {});
                const killFeed = readJsonFile(KILL_FEED_FILE, []);
                
                results.json.working = true;
                results.json.recordCounts = {
                    players: Object.keys(killStats).length,
                    kills: killFeed.length
                };
            } catch (error) {
                results.json.error = error.message;
            }
        }
        
        // Test SQLite databáze (pro kill feed)
        const sqliteExists = fs.existsSync(KILLFEED_DB_PATH);
        results.sqlite.exists = sqliteExists;
        
        if (sqliteExists) {
            try {
                const tables = await queryDatabase('SELECT name FROM sqlite_master WHERE type="table"');
                const killsCount = await queryDatabase('SELECT COUNT(*) as count FROM kills').catch(() => [{ count: 'Error' }]);
                
                results.sqlite.working = true;
                results.sqlite.tables = tables.map(t => t.name);
                results.sqlite.recordCounts = {
                    kills: killsCount[0]?.count || 0
                };
            } catch (error) {
                results.sqlite.error = error.message;
            }
        }
        
        // Test bounty systému
        try {
            if (bountyService) {
                const activeBounties = await bountyService.getActiveBounties();
                
                results.bounty.working = true;
                results.bounty.recordCounts = {
                    activeBounties: activeBounties.length
                };
            } else {
                results.bounty.error = 'Bounty service není inicializován';
            }
        } catch (error) {
            results.bounty.error = error.message;
        }
        
        // Test aktuálních API
        try {
            const stats = await getStatsFromDatabase();
            results.statsSource = stats.source;
            results.statsWorking = true;
        } catch (error) {
            results.statsError = error.message;
        }
        
        try {
            const killFeed = await getKillFeedFromDatabase(5);
            results.killFeedSource = killFeed.length > 0 ? 'sqlite' : 'empty';
            results.killFeedWorking = true;
        } catch (error) {
            results.killFeedError = error.message;
        }
        
        res.json({
            success: true,
            strategy: 'JSON pro statistiky, SQLite pro kill feed, bounty používá API killfeed',
            ...results
        });
    } catch (error) {
        console.error('Chyba při testu:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/test-rcon', async (req, res) => {
    try {
        console.log('Test RCON připojení');
        
        if (!rconManager.connected) {
            console.log('RCON není připojen, pokus o připojení');
            await rconManager.connect();
        }
        
        console.log('Odesílání příkazu serverinfo');
        const response = await rconManager.sendCommand('serverinfo');
        const serverInfo = rconManager.parseServerInfo(response);
        
        res.json({
            success: true,
            connected: rconManager.connected,
            serverInfo: serverInfo
        });
    } catch (error) {
        console.error('Chyba při RCON testu:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
        console.log('Uživatelské informace požadovány, uživatel přihlášen:', req.user.id);
        res.json({
            success: true,
            user: {
                id: req.user.id,
                displayName: req.user.displayName,
                photos: req.user.photos,
                isAdmin: req.user.isAdmin
            }
        });
    } else {
        console.log('Uživatelské informace požadovány, ale uživatel není přihlášen');
        res.json({
            success: false,
            message: 'Uživatel není přihlášen'
        });
    }
});

app.get('/api/logout', (req, res) => {
    console.log('Požadavek na odhlášení uživatele');
    req.logout(function(err) {
        if (err) {
            console.error('Chyba při odhlašování:', err);
            return res.status(500).json({ success: false, message: 'Chyba při odhlašování' });
        }
        console.log('Uživatel byl úspěšně odhlášen');
        res.json({ success: true });
    });
});

// API endpointy pro statistiky
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await getStatsFromDatabase();
        
        if (req.user) {
            const userStats = await searchPlayerInDatabase(req.user.id);
            if (userStats) {
                stats.userStats = userStats;
                
                const allPlayers = stats.topKills;
                const userRank = allPlayers.findIndex(p => p.id === req.user.id) + 1;
                stats.userStats.rank = userRank > 0 ? userRank : null;
            }
        }

        res.json(stats);
    } catch (error) {
        console.error('Chyba API /stats:', error);
        res.status(500).json({ error: 'Chyba serveru' });
    }
});

// OPRAVENÝ API endpoint pro kill feed s dodatečnými daty pro bounty
app.get('/api/killfeed', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const kills = await getKillFeedFromDatabase(limit);
        
        console.log(`📡 API killfeed: vráceno ${kills.length} killů`);
        
        res.json({ 
            kills,
            meta: {
                total: kills.length,
                playerKills: kills.filter(k => !k.natural).length,
                naturalDeaths: kills.filter(k => k.natural).length
            }
        });
    } catch (error) {
        console.error('Chyba API /killfeed:', error);
        res.status(500).json({ error: 'Chyba serveru' });
    }
});

app.get('/api/player-search', async (req, res) => {
    try {
        const searchTerm = req.query.search;
        if (!searchTerm) {
            return res.status(400).json({ error: 'Chybí vyhledávací termín' });
        }

        const player = await searchPlayerInDatabase(searchTerm);
        if (!player) {
            return res.status(404).json({ error: 'Hráč nenalezen' });
        }

        const stats = await getStatsFromDatabase();
        const allPlayers = stats.topKills;
        const playerRank = allPlayers.findIndex(p => p.id === player.id) + 1;
        player.rank = playerRank > 0 ? playerRank : null;

        res.json(player);
    } catch (error) {
        console.error('Chyba API /player-search:', error);
        res.status(500).json({ error: 'Chyba serveru' });
    }
});

app.get('/api/player-stats', async (req, res) => {
    try {
        const steamId = req.query.steamId;
        if (!steamId) {
            return res.status(400).json({ error: 'Chybí Steam ID' });
        }

        const player = await searchPlayerInDatabase(steamId);
        if (!player) {
            return res.status(404).json({ error: 'Hráč nenalezen' });
        }

        res.json(player);
    } catch (error) {
        console.error('Chyba API /player-stats:', error);
        res.status(500).json({ error: 'Chyba serveru' });
    }
});
// server.js KOMPLETNÍ - ČÁST E (finální část po části D)

// Statické soubory a SPA routing
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stats', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stats.html'));
});

app.get('/map', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/friends', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/bounty', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Friends router se načte zde, po inicializaci databáze
try {
    const friendsRouter = require('./api-routes/friends');
    app.use('/api/friends', requireAuth, friendsRouter);
    console.log('✅ Friends API router načten');
} catch (error) {
    console.error('❌ Chyba při načítání Friends API routeru:', error);
}

// Další API endpointy pro kompatibilitu
app.get('/api/serverinfo', async (req, res) => {
    try {
        const result = await rconManager.getServerInfoData();
        res.json({
            success: true,
            serverInfo: result.serverInfo,
            fromCache: result.fromCache,
            connectionStatus: rconManager.getConnectionStatus()
        });
    } catch (error) {
        console.error('Chyba API /serverinfo:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            serverInfo: rconManager.getDefaultServerInfo()
        });
    }
});

app.get('/api/connection-status', (req, res) => {
    try {
        const status = rconManager.getConnectionStatus();
        res.json({
            success: true,
            status: status
        });
    } catch (error) {
        console.error('Chyba API /connection-status:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// API endpoint pro admin reload
app.post('/api/admin/reload-rcon', ensureAdmin, async (req, res) => {
    try {
        console.log('🔄 Admin reload RCON požadavek od:', req.user.displayName);
        
        await rconManager.close();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Počkat 1 sekundu
        
        const connected = await rconManager.connect();
        
        res.json({
            success: true,
            message: 'RCON připojení restartováno',
            connected: connected,
            status: rconManager.getConnectionStatus()
        });
    } catch (error) {
        console.error('Chyba při admin reload RCON:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint pro manuální refresh player dat
app.post('/api/admin/refresh-players', ensureAdmin, async (req, res) => {
    try {
        console.log('🔄 Admin refresh players požadavek od:', req.user.displayName);
        
        const result = await rconManager.getPlayerData();
        
        res.json({
            success: true,
            message: 'Data hráčů aktualizována',
            players: result.players,
            fromCache: result.fromCache,
            cacheAge: result.cacheAge
        });
    } catch (error) {
        console.error('Chyba při admin refresh players:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint pro získání systémových informací
app.get('/api/system-info', ensureAdmin, (req, res) => {
    try {
        const systemInfo = {
            server: {
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                env: process.env.NODE_ENV || 'development'
            },
            rcon: rconManager.getConnectionStatus(),
            database: {
                killStatsExists: fs.existsSync(KILL_STATS_FILE),
                playtimeExists: fs.existsSync(PLAYTIME_FILE),
                killfeedDbExists: fs.existsSync(KILLFEED_DB_PATH)
            },
            bounty: {
                serviceInitialized: !!bountyService,
                timestamp: new Date().toISOString()
            }
        };
        
        res.json({
            success: true,
            systemInfo: systemInfo
        });
    } catch (error) {
        console.error('Chyba API /system-info:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        rcon: {
            connected: rconManager.connected,
            cacheValid: rconManager.isCacheValid()
        },
        bounty: {
            initialized: !!bountyService
        }
    };
    
    res.json(health);
});

// Metrics endpoint pro monitoring
app.get('/api/metrics', (req, res) => {
    try {
        const metrics = {
            server: {
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage()
            },
            rcon: rconManager.getConnectionStatus(),
            timestamp: new Date().toISOString()
        };
        
        res.json({
            success: true,
            metrics: metrics
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *
Allow: /
Sitemap: ${APP_URL}/sitemap.xml`);
});

// Sitemap.xml pro SEO
app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${APP_URL}/</loc>
        <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
        <priority>1.0</priority>
    </url>
    <url>
        <loc>${APP_URL}/stats</loc>
        <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>${APP_URL}/map</loc>
        <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
        <priority>0.8</priority>
    </url>
</urlset>`);
});

// SPA fallback - všechny ostatní routy
app.get('*', (req, res) => {
    // Zkontrolovat, zda požadavek není pro API endpoint
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            success: false,
            error: 'API endpoint nenalezen',
            path: req.path
        });
    }
    
    // Pro všechny ostatní routy vrátit hlavní SPA soubor
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    
    // Log error details pro debugging
    console.error('Error stack:', err.stack);
    console.error('Request details:', {
        method: req.method,
        path: req.path,
        query: req.query,
        user: req.user ? req.user.id : 'anonymous',
        timestamp: new Date().toISOString()
    });
    
    res.status(500).json({ 
        success: false, 
        error: 'Vnitřní chyba serveru',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Chyba serveru',
        timestamp: new Date().toISOString()
    });
});

// 404 handler pro neexistující routy
app.use((req, res) => {
    console.log(`404 - Neexistující route: ${req.method} ${req.path}`);
    
    if (req.path.startsWith('/api/')) {
        res.status(404).json({
            success: false,
            error: 'API endpoint nenalezen',
            path: req.path,
            availableEndpoints: [
                '/api/user', '/api/stats', '/api/killfeed', '/api/combined-data',
                '/api/friends/*', '/api/bounty/*', '/api/test-database', '/api/test-rcon'
            ]
        });
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', '404.html'), (err) => {
            if (err) {
                res.status(404).send('404 - Stránka nenalezena');
            }
        });
    }
});

// Graceful shutdown handlers
async function gracefulShutdown(signal) {
    console.log(`\n🛑 Přijat ${signal} signal. Ukončuji server...`);
    
    try {
        // Uzavřít RCON připojení
        await rconManager.close();
        console.log('✅ RCON připojení uzavřeno');
    } catch (error) {
        console.error('⚠️ Chyba při uzavírání RCON:', error);
    }
    
    try {
        // Uzavřít hlavní databázi
        if (db) {
            db.close();
            console.log('✅ Hlavní databáze uzavřena');
        }
    } catch (error) {
        console.error('⚠️ Chyba při uzavírání hlavní databáze:', error);
    }
    
    try {
        // Uzavřít bounty databázi
        if (bountyService && bountyService.db) {
            bountyService.db.close();
            console.log('✅ Bounty databáze uzavřena');
        }
    } catch (error) {
        console.error('⚠️ Chyba při uzavírání bounty databáze:', error);
    }
    
    console.log('👋 Server ukončen');
    process.exit(0);
}

// Registrace signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Uncaught exception handler
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    console.error('Stack:', err.stack);
    
    // Pokusit se o graceful shutdown
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    
    // Pokusit se o graceful shutdown
    gracefulShutdown('UNHANDLED_REJECTION');
});

// Spuštění serveru
const server = app.listen(port, () => {
    console.log('🎉 ===== SERVER ÚSPĚŠNĚ SPUŠTĚN =====');
    console.log(`🚀 Server běží na portu ${port}`);
    console.log(`🌐 Aplikace dostupná na: ${APP_URL}`);
    console.log(`🔗 Steam autentizace: ${APP_URL}/auth/steam`);
    console.log(`📊 API test databáze: ${APP_URL}/api/test-database`);
    console.log(`🎯 RCON test: ${APP_URL}/api/test-rcon`);
    console.log(`💰 Bounty webhook: ${APP_URL}/webhook/kill`);
    console.log(`❤️ Health check: ${APP_URL}/health`);
    console.log(`📈 Metrics: ${APP_URL}/api/metrics`);
    
    if (process.env.NODE_ENV === 'development') {
        console.log('🔧 Development mode - dodatečné logy zapnuty');
        console.log(`🐛 System info: ${APP_URL}/api/system-info`);
    }
    
    console.log('=====================================');
});

// Server timeout nastavení
server.timeout = 30000; // 30 sekund timeout

// Keep-alive nastavení
server.keepAliveTimeout = 65000; // 65 sekund
server.headersTimeout = 66000; // 66 sekund

console.log('✅ Server.js načten úspěšně - s bounty a friends integrací');
console.log('🔥 KOMPLETNÍ VERZE - všechny funkce aktivní');
console.log(`📦 Celkem řádků kódu: ${__filename ? require('fs').readFileSync(__filename, 'utf8').split('\n').length : 'N/A'}`);
console.log('🎯 Ready for production!');