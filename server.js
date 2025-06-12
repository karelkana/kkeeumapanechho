// server.js - hlavní soubor backend aplikace s RCON cache
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
APP_URL=http://jursky.karelkana.eu`;
    
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
console.log("🔄 STRATEGIE: JSON pro statistiky, SQLite pro kill feed");
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
const friendsRouter = require('./api-routes/friends');
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
    console.error("VAROVÁNÍ: STEAM_API_KEY není definováno v .env souboru");
    console.error("Steam přihlášení nebude fungovat bez platného API klíče");
}

// Seznam admin Steam ID
const adminSteamIds = (ADMIN_STEAM_IDS || '').split(',').map(id => id.trim());

// Konfigurace aplikace
const app = express();
const port = process.env.PORT || 7682;

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

// Hlavní funkce pro kill feed - MUSÍ číst z SQLite databáze
async function getKillFeedFromDatabase(limit = 20) {
    try {
        console.log('Načítám kill feed z SQLite databáze (jediný zdroj)');
        
        // Kill feed existuje pouze v SQLite databázi
        if (fs.existsSync(KILLFEED_DB_PATH)) {
            const kills = await queryDatabase(`
                SELECT timestamp, killer_name as killer, killer_dino as killerDino, 
                       victim_name as victim, victim_dino as victimDino, is_natural_death as natural,
                       created_at
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
app.use('/api/friends', friendsRouter);

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

// Passport konfigurace
app.use(passport.initialize());
app.use(passport.session());

passport.use(new SteamStrategy({
    returnURL: `${APP_URL}/auth/steam/return`,
    realm: APP_URL,
    apiKey: STEAM_API_KEY
}, (identifier, profile, done) => {
    console.log('Steam autentizace úspěšná:', {
        id: profile.id,
        displayName: profile.displayName
    });
    
    const steamId = profile.id;
    const isAdmin = adminSteamIds.includes(steamId);
    
    profile.isAdmin = isAdmin;
    console.log('Uživatelská role:', isAdmin ? 'admin' : 'běžný uživatel');
    
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
    console.log('Serializace uživatele:', user.id);
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    console.log('Deserializace uživatele');
    done(null, obj);
});

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

// Autentizační routy
app.get('/auth/steam', (req, res, next) => {
    console.log('Zahájení Steam autentizace, redirect URL:', `${APP_URL}/auth/steam/return`);
    next();
}, passport.authenticate('steam'));

app.get('/auth/steam/return', (req, res, next) => {
    console.log('Steam callback obdržen, data:', req.query);
    next();
}, passport.authenticate('steam', { failureRedirect: '/' }), (req, res) => {
    console.log('Uživatel úspěšně přihlášen:', req.user ? req.user.id : 'neznámý');
    res.redirect('/');
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
            strategy: 'JSON pro statistiky, SQLite pro kill feed',
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

app.get('/api/killfeed', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const kills = await getKillFeedFromDatabase(limit);
        res.json({ kills });
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
        const searchTerm = req.query.search;
        if (!searchTerm) {
            return res.status(400).json({ error: 'Chybí parametr search' });
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
        console.error('Chyba API /player-stats:', error);
        res.status(500).json({ error: 'Chyba serveru' });
    }
});

// AKTUALIZOVANÉ API endpointy s cache podporou
app.get('/api/players', ensureAuthenticated, async (req, res) => {
    try {
        console.log(`API požadavek na hráče od uživatele: ${req.user.id}`);
        
        const result = await rconManager.getPlayerData();
        let players = result.players;
        
        if (!req.user.isAdmin) {
            console.log(`Filtrování dat pro běžného uživatele ${req.user.id}`);
            players = players.filter(player => player.steamId === req.user.id);
        }
        
        console.log(`Vracím ${players.length} hráčů${result.fromCache ? ' (z cache)' : ''}`);
        res.json({ 
            success: true, 
            players,
            meta: {
                fromCache: result.fromCache,
                cacheAge: result.cacheAge,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Chyba při získávání dat o hráčích:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/playerlist', async (req, res) => {
    try {
        console.log('API požadavek na veřejný seznam hráčů');
        
        const result = await rconManager.getPlayerData();
        const players = result.players;
        
        const isAuthenticated = req.isAuthenticated();
        const isAdmin = isAuthenticated && req.user && req.user.isAdmin;
        const userId = isAuthenticated ? req.user.id : null;
        
        console.log('Stav autentizace:', { isAuthenticated, isAdmin, userId });
        
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
                
                console.log(`Nalezeno ${friendships.length} přátelství pro uživatele ${userId}`);
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
                steamId: player.steamId
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
                    info.growth = player.growth;
                }
                else if (isAdmin) {
                    info.x = player.x;
                    info.y = player.y;
                    info.z = player.z;
                    info.health = player.health;
                    info.hunger = player.hunger;
                    info.thirst = player.thirst;
                    info.stamina = player.stamina;
                    info.growth = player.growth;
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
                        info.growth = player.growth;
                    }
                }
            }
            
            return info;
        });
        
        const withCoords = playerInfo.filter(p => p.x !== undefined).length;
        const withStats = playerInfo.filter(p => p.health !== undefined).length;
        console.log(`Vracím info o ${playerInfo.length} hráčích, ${withCoords} se souřadnicemi, ${withStats} se statistikami${result.fromCache ? ' (z cache)' : ''}`);
        
        res.json({ 
            success: true, 
            players: playerInfo,
            auth: { isAuthenticated, isAdmin },
            meta: {
                fromCache: result.fromCache,
                cacheAge: result.cacheAge,
                cacheValid: rconManager.isCacheValid(),
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Chyba při získávání seznamu hráčů:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// NOVÝ kombinovaný endpoint pro data hráčů bez serverInfo
app.get('/api/combined-data', async (req, res) => {
    try {
        console.log('API požadavek na kombinovaná data (bez serverInfo)');
        
        const result = await rconManager.getPlayerData();
        const players = result.players;
        
        const isAuthenticated = req.isAuthenticated();
        const isAdmin = isAuthenticated && req.user && req.user.isAdmin;
        const userId = isAuthenticated ? req.user.id : null;
        
        console.log('Stav autentizace:', { isAuthenticated, isAdmin, userId });
        
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
                
                console.log(`Nalezeno ${friendships.length} přátelství pro uživatele ${userId}`);
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
                growth: player.growth // Vždy posílat growth, frontend provede přepočet
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
        
        const withCoords = playerInfo.filter(p => p.x !== undefined).length;
        const withStats = playerInfo.filter(p => p.health !== undefined).length;
        console.log(`Vracím info o ${playerInfo.length} hráčích, ${withCoords} se souřadnicemi, ${withStats} se statistikami${result.fromCache ? ' (z cache)' : ''}`);
        
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
        console.error('Chyba při získávání kombinovaných dat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/myplayer', ensureAuthenticated, async (req, res) => {
    try {
        console.log(`Požadavek na informace o přihlášeném hráči: ${req.user.id}`);
        
        const player = await rconManager.getPlayerInfoBySteamId(req.user.id);
        
        if (!player) {
            return res.json({
                success: false,
                message: 'Hráč není na serveru'
            });
        }
        
        res.json({
            success: true,
            player: {
                id: player.id,
                name: player.name,
                dino: player.dino,
                dinoType: player.dinoType,
                growth: player.growth,
                steamId: player.steamId,
                x: player.x,
                y: player.y,
                z: player.z,
                health: player.health,
                hunger: player.hunger,
                thirst: player.thirst,
                stamina: player.stamina
            }
        });
    } catch (error) {
        console.error('Chyba při získávání informací o hráči:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/server-info', async (req, res) => {
    try {
        console.log('API požadavek na informace o serveru');
        const result = await rconManager.getServerInfoData();
        
        console.log(`Vracím informace o serveru${result.fromCache ? ' (z cache)' : ''}:`, result.serverInfo);
        res.json({ 
            success: true, 
            serverInfo: result.serverInfo,
            meta: {
                fromCache: result.fromCache,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Chyba při získávání informací o serveru:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/players', ensureAdmin, async (req, res) => {
    try {
        console.log('Admin API požadavek na hráče');
        const result = await rconManager.getPlayerData();
        const players = result.players;
        
        console.log(`Admin: Vracím data o ${players.length} hráčích${result.fromCache ? ' (z cache)' : ''}`);
        res.json({ 
            success: true, 
            players,
            meta: {
                fromCache: result.fromCache,
                cacheAge: result.cacheAge,
                cacheValid: rconManager.isCacheValid(),
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Chyba při získávání admin dat o hráčích:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// NOVÝ endpoint pro debug RCON stavu
app.get('/api/rcon-status', async (req, res) => {
    try {
        const status = rconManager.getConnectionStatus();
        res.json({
            success: true,
            status: status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/update-playtime', (req, res) => {
    try {
        const { steamId, playtime } = req.body;
        
        if (!steamId || playtime === undefined) {
            return res.status(400).json({ error: 'Chybí steamId nebo playtime' });
        }

        const playtimeStats = readJsonFile(PLAYTIME_FILE, {});
        playtimeStats[steamId] = parseInt(playtime);

        if (writeJsonFile(PLAYTIME_FILE, playtimeStats)) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Chyba při ukládání' });
        }

    } catch (error) {
        console.error('Chyba při aktualizaci playtime:', error);
        res.status(500).json({ error: 'Chyba při aktualizaci playtime' });
    }
});

app.post('/api/refresh-stats', requireAuth, (req, res) => {
    try {
        res.json({ 
            success: true, 
            message: 'Statistiky byly aktualizovány',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Chyba při refresh statistik:', error);
        res.status(500).json({ error: 'Chyba při refresh statistik' });
    }
});

app.get('/stats', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stats.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handlers
app.use('/api/*', (err, req, res, next) => {
    console.error('API Error:', err);
    res.status(500).json({ 
        error: 'Chyba serveru při načítání dat',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({
        success: false,
        message: 'Došlo k chybě serveru',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Interní chyba serveru'
    });
});

console.log('API endpointy pro statistiky inicializovány');

// Spuštění serveru
const server = app.listen(port, () => {
    console.log(`Server běží na portu ${port}`);
    console.log(`Aplikace je dostupná na: ${APP_URL}`);
});

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function shutdown() {
    console.log('Ukončování serveru...');
    await rconManager.close();
    server.close(() => {
        console.log('Server ukončen');
        process.exit(0);
    });
}