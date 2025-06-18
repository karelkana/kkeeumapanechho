// services/bounty.js - KOMPLETNÍ NOVÁ VERZE kompatibilní s webovou stránkou
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Cesty k databázím
const DISCORD_BOT_PATH = '/mnt/data/evrimabot';
const KILLFEED_DB_PATH = path.join(DISCORD_BOT_PATH, 'killfeed.db');
const KILL_STATS_FILE = path.join(DISCORD_BOT_PATH, 'kill_stats.json');

class BountyService {
    constructor() {
        this.dbPath = KILLFEED_DB_PATH;
        this.initialized = false;
        this.lastProcessedKillId = 0;
        this.init();
        
        // Auto-refresh bounty systému každých 2 minuty
        setInterval(() => {
            this.processNewKills();
        }, 2 * 60 * 1000);
        
        // Cleanup každou hodinu
        setInterval(() => {
            this.cleanupExpiredData();
        }, 60 * 60 * 1000);
    }

    async init() {
        try {
            console.log('🎯 Inicializace Bounty Service...');
            
            if (!fs.existsSync(this.dbPath)) {
                console.error('❌ Killfeed databáze neexistuje:', this.dbPath);
                return;
            }

            // Vytvoř bounty tabulky kompatibilní s webovou stránkou
            await this.createBountyTables();
            
            // Naplň systém daty z JSON pokud je prázdný
            await this.populateFromJSON();
            
            // Načti poslední zpracovaný kill
            await this.loadLastProcessedKill();
            
            console.log('✅ Bounty Service inicializován s webovou kompatibilitou');
            this.initialized = true;
        } catch (error) {
            console.error('❌ Chyba při inicializaci Bounty Service:', error);
        }
    }

    async createBountyTables() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath);
            
            db.serialize(() => {
                // Hlavní bounty stats tabulka (kompatibilní s webovou stránkou)
                db.run(`
                    CREATE TABLE IF NOT EXISTS player_bounty_stats (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        player_id TEXT NOT NULL UNIQUE,
                        player_name TEXT NOT NULL,
                        kills INTEGER DEFAULT 0,
                        deaths INTEGER DEFAULT 0,
                        bounty_points INTEGER DEFAULT 0,
                        bounty_spent INTEGER DEFAULT 0,
                        bounty_earned_total INTEGER DEFAULT 0,
                        kd_ratio REAL DEFAULT 0.0,
                        diversity_score INTEGER DEFAULT 0,
                        last_kill_timestamp TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Bounty transakce
                db.run(`
                    CREATE TABLE IF NOT EXISTS bounty_transactions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        player_id TEXT NOT NULL,
                        transaction_type TEXT NOT NULL, -- 'earned', 'spent', 'bonus', 'kill_reward'
                        amount INTEGER NOT NULL,
                        reason TEXT,
                        related_kill_id INTEGER,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (player_id) REFERENCES player_bounty_stats(player_id)
                    )
                `);

                // Dinosaur mastery
                db.run(`
                    CREATE TABLE IF NOT EXISTS player_dino_mastery (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        player_id TEXT NOT NULL,
                        dino_name TEXT NOT NULL,
                        kills INTEGER DEFAULT 0,
                        mastery_level TEXT DEFAULT 'Novice', -- Novice, Amateur, Expert, Master, Legend
                        bounty_bonus INTEGER DEFAULT 0,
                        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(player_id, dino_name),
                        FOREIGN KEY (player_id) REFERENCES player_bounty_stats(player_id)
                    )
                `);

                // Aktivní bounty contracts
                db.run(`
                    CREATE TABLE IF NOT EXISTS active_bounties (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        target_player_id TEXT NOT NULL,
                        target_name TEXT NOT NULL,
                        reward_amount INTEGER NOT NULL,
                        placed_by_player_id TEXT NOT NULL,
                        placed_by_name TEXT NOT NULL,
                        reason TEXT,
                        contract_type TEXT DEFAULT 'manual', -- 'manual', 'auto', 'system'
                        status TEXT DEFAULT 'active', -- 'active', 'completed', 'cancelled', 'expired'
                        completed_by_player_id TEXT,
                        completed_by_name TEXT,
                        completed_at DATETIME,
                        expires_at DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (target_player_id) REFERENCES player_bounty_stats(player_id)
                    )
                `);

                // Bounty history pro tracking
                db.run(`
                    CREATE TABLE IF NOT EXISTS bounty_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        event_type TEXT NOT NULL, -- 'bounty_placed', 'bounty_completed', 'kill_processed', 'auto_bounty'
                        player_id TEXT NOT NULL,
                        details TEXT, -- JSON s detaily
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            });

            db.close((err) => {
                if (err) {
                    console.error('Chyba při vytváření bounty tabulek:', err);
                    reject(err);
                } else {
                    console.log('✅ Bounty tabulky vytvořeny/ověřeny');
                    resolve();
                }
            });
        });
    }

    // NOVÁ metoda - naplnění systému z JSON kill_stats
    async populateFromJSON() {
        try {
            // Zkontroluj, jestli už máme data
            const existingCount = await this.getPlayerCount();
            if (existingCount > 0) {
                console.log(`📊 Bounty systém už obsahuje ${existingCount} hráčů, přeskakuji JSON import`);
                return;
            }

            if (!fs.existsSync(KILL_STATS_FILE)) {
                console.warn('⚠️ Kill stats JSON nenalezen, bounty systém bude prázdný');
                return;
            }

            console.log('📊 Naplňuji bounty systém z JSON kill_stats...');
            
            const killStatsData = JSON.parse(fs.readFileSync(KILL_STATS_FILE, 'utf8'));
            let processedPlayers = 0;

            const db = new sqlite3.Database(this.dbPath);

            for (const [steamId, playerData] of Object.entries(killStatsData)) {
                const kills = parseInt(playerData.kills || 0);
                const deaths = parseInt(playerData.deaths || 0);
                const playerName = playerData.player_name || `Player_${steamId}`;
                const dinos = playerData.dinos || {};

                if (kills === 0 && deaths === 0) continue; // Přeskoč neaktivní hráče

                // Vypočítej bounty body podle našeho algoritmu
                const bountyPoints = this.calculateBountyPoints(kills, deaths, dinos);
                const kdRatio = kills / Math.max(deaths, 1);
                const diversityScore = Object.keys(dinos).length;

                // Vlož do player_bounty_stats
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT OR REPLACE INTO player_bounty_stats 
                        (player_id, player_name, kills, deaths, bounty_points, bounty_earned_total, 
                         kd_ratio, diversity_score, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    `, [steamId, playerName, kills, deaths, bountyPoints, bountyPoints, kdRatio, diversityScore], 
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                });

                // Vlož dinosaur mastery data
                for (const [dinoName, dinoKills] of Object.entries(dinos)) {
                    const masteryLevel = this.calculateMasteryLevel(dinoKills);
                    const masteryBonus = this.calculateMasteryBonus(masteryLevel);

                    await new Promise((resolve, reject) => {
                        db.run(`
                            INSERT OR REPLACE INTO player_dino_mastery 
                            (player_id, dino_name, kills, mastery_level, bounty_bonus, last_updated)
                            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                        `, [steamId, dinoName, dinoKills, masteryLevel, masteryBonus], 
                        function(err) {
                            if (err) reject(err);
                            else resolve(this.lastID);
                        });
                    });
                }

                // Zaznamenej initial transakci
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO bounty_transactions 
                        (player_id, transaction_type, amount, reason)
                        VALUES (?, 'earned', ?, 'Initial calculation from kill stats')
                    `, [steamId, bountyPoints], function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                });

                processedPlayers++;

                // Progress každých 25 hráčů
                if (processedPlayers % 25 === 0) {
                    console.log(`⏳ Zpracováno ${processedPlayers} hráčů...`);
                }
            }

            db.close();

            console.log(`✅ Bounty systém naplněn: ${processedPlayers} hráčů importováno z JSON`);

        } catch (error) {
            console.error('❌ Chyba při naplňování z JSON:', error);
        }
    }

    // Bounty kalkulační algoritmy
    calculateBountyPoints(kills, deaths, dinos) {
        if (kills === 0) return 0;

        // Základní body za kills
        const basePoints = kills * 10;

        // K/D ratio bonus
        const kdRatio = kills / Math.max(deaths, 1);
        let ratioBonus = 0;
        if (kdRatio >= 3.0) ratioBonus = kills * 20;      // 200% bonus
        else if (kdRatio >= 2.0) ratioBonus = kills * 15; // 150% bonus
        else if (kdRatio >= 1.5) ratioBonus = kills * 10; // 100% bonus
        else if (kdRatio >= 1.0) ratioBonus = kills * 5;  // 50% bonus

        // Perfect record bonus
        if (deaths === 0 && kills >= 5) ratioBonus += kills * 25;

        // Activity bonus
        const totalEncounters = kills + deaths;
        let activityBonus = 0;
        if (totalEncounters >= 100) activityBonus = 300;
        else if (totalEncounters >= 75) activityBonus = 200;
        else if (totalEncounters >= 50) activityBonus = 150;
        else if (totalEncounters >= 25) activityBonus = 100;
        else if (totalEncounters >= 10) activityBonus = 50;

        // Diversity bonus
        const uniqueDinos = Object.keys(dinos).length;
        let diversityBonus = 0;
        if (uniqueDinos >= 10) diversityBonus = 250;
        else if (uniqueDinos >= 8) diversityBonus = 200;
        else if (uniqueDinos >= 6) diversityBonus = 150;
        else if (uniqueDinos >= 4) diversityBonus = 100;
        else if (uniqueDinos >= 2) diversityBonus = 50;

        // Mastery bonus (nejvyšší kills s jedním dinem)
        const maxDinoKills = Math.max(...Object.values(dinos), 0);
        let masteryBonus = 0;
        if (maxDinoKills >= 50) masteryBonus = 200;
        else if (maxDinoKills >= 30) masteryBonus = 150;
        else if (maxDinoKills >= 20) masteryBonus = 100;
        else if (maxDinoKills >= 10) masteryBonus = 50;

        // Volume bonus
        let volumeBonus = 0;
        if (kills >= 100) volumeBonus = 500;
        else if (kills >= 75) volumeBonus = 300;
        else if (kills >= 50) volumeBonus = 200;
        else if (kills >= 25) volumeBonus = 100;

        const totalBounty = basePoints + ratioBonus + activityBonus + diversityBonus + masteryBonus + volumeBonus;
        return Math.max(totalBounty, 10);
    }

    calculateMasteryLevel(kills) {
        if (kills >= 50) return 'Legend';
        if (kills >= 30) return 'Master';
        if (kills >= 20) return 'Expert';
        if (kills >= 10) return 'Amateur';
        return 'Novice';
    }

    calculateMasteryBonus(level) {
        switch (level) {
            case 'Legend': return 100;
            case 'Master': return 75;
            case 'Expert': return 50;
            case 'Amateur': return 25;
            default: return 0;
        }
    }

    // API metody pro webovou stránku
    async getBountyLeaderboard(limit = 50) {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath);
            
            db.all(`
                SELECT 
                    player_name, player_id, kills, deaths, bounty_points, 
                    kd_ratio, diversity_score, bounty_earned_total, bounty_spent
                FROM player_bounty_stats 
                WHERE bounty_points > 0
                ORDER BY bounty_points DESC 
                LIMIT ?
            `, [limit], (err, rows) => {
                db.close();
                
                if (err) {
                    console.error('Chyba při získávání bounty leaderboard:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    async getBountyOverview() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath);
            
            db.get(`
                SELECT 
                    COUNT(*) as totalPlayers,
                    SUM(bounty_points) as totalBounty,
                    AVG(bounty_points) as averageBounty,
                    MAX(bounty_points) as maxBounty,
                    MIN(bounty_points) as minBounty,
                    SUM(bounty_spent) as totalSpent
                FROM player_bounty_stats
                WHERE bounty_points > 0
            `, [], (err, row) => {
                db.close();
                
                if (err) {
                    console.error('Chyba při získávání bounty overview:', err);
                    reject(err);
                } else {
                    resolve(row || {});
                }
            });
        });
    }

    async getPlayerBountyDetails(playerId) {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath);
            
            // Základní player data
            db.get(`
                SELECT * FROM player_bounty_stats 
                WHERE player_id = ?
            `, [playerId], (err, playerRow) => {
                if (err) {
                    db.close();
                    reject(err);
                    return;
                }

                if (!playerRow) {
                    db.close();
                    resolve(null);
                    return;
                }

                // Dinosaur mastery
                db.all(`
                    SELECT dino_name, kills, mastery_level, bounty_bonus
                    FROM player_dino_mastery 
                    WHERE player_id = ?
                    ORDER BY kills DESC
                `, [playerId], (err2, dinoRows) => {
                    if (err2) {
                        db.close();
                        reject(err2);
                        return;
                    }

                    // Recent transactions
                    db.all(`
                        SELECT transaction_type, amount, reason, timestamp
                        FROM bounty_transactions 
                        WHERE player_id = ?
                        ORDER BY timestamp DESC
                        LIMIT 10
                    `, [playerId], (err3, transRows) => {
                        db.close();
                        
                        if (err3) {
                            reject(err3);
                        } else {
                            resolve({
                                player: playerRow,
                                dinoMastery: dinoRows || [],
                                transactions: transRows || []
                            });
                        }
                    });
                });
            });
        });
    }

    async getActiveBounties() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath);
            
            db.all(`
                SELECT player_name, player_id, bounty_points 
                FROM player_bounty_stats 
                WHERE bounty_points > 0 
                ORDER BY bounty_points DESC
            `, [], (err, rows) => {
                db.close();
                
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    async getPlayerCount() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath);
            
            db.get('SELECT COUNT(*) as count FROM player_bounty_stats', [], (err, row) => {
                db.close();
                
                if (err) {
                    reject(err);
                } else {
                    resolve(row?.count || 0);
                }
            });
        });
    }

    // Kill feed monitoring
    async loadLastProcessedKill() {
        try {
            const db = new sqlite3.Database(this.dbPath);
            
            return new Promise((resolve) => {
                db.get(
                    'SELECT MAX(id) as maxId FROM kills WHERE is_natural_death = 0',
                    [],
                    (err, row) => {
                        db.close();
                        
                        if (err) {
                            console.error('Chyba při načítání posledního kill ID:', err);
                            this.lastProcessedKillId = 0;
                        } else {
                            this.lastProcessedKillId = row?.maxId || 0;
                            console.log(`📊 Poslední zpracovaný kill ID: ${this.lastProcessedKillId}`);
                        }
                        resolve();
                    }
                );
            });
        } catch (error) {
            console.error('Chyba při načítání kill ID:', error);
            this.lastProcessedKillId = 0;
        }
    }

    async processNewKills() {
        try {
            if (!this.initialized) return;

            console.log('🔍 Kontrola nových killů pro bounty systém...');
            
            const newKills = await this.getNewKillsFromDatabase();
            
            if (newKills.length === 0) {
                console.log('📊 Žádné nové player killy k zpracování');
                return;
            }

            console.log(`📊 Zpracovávám ${newKills.length} nových player killů pro bounty`);

            for (const kill of newKills) {
                await this.processKillForBounty(kill);
            }

            // Aktualizovat poslední zpracovaný kill
            if (newKills.length > 0) {
                const killIds = newKills.map(k => k.id).filter(id => id > 0);
                if (killIds.length > 0) {
                    this.lastProcessedKillId = Math.max(...killIds);
                    console.log(`✅ Bounty: Aktualizován poslední zpracovaný kill ID: ${this.lastProcessedKillId}`);
                }
            }

        } catch (error) {
            console.error('❌ Chyba při zpracování nových killů pro bounty:', error);
        }
    }

    async getNewKillsFromDatabase() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath);
            
            db.all(`
                SELECT id, killer_name, killer_id, victim_name, victim_id,
                       killer_dino, victim_dino, is_natural_death, timestamp, created_at
                FROM kills 
                WHERE id > ? 
                AND is_natural_death = 0  
                AND victim_id IS NOT NULL
                ORDER BY id ASC
                LIMIT 100
            `, [this.lastProcessedKillId], (err, rows) => {
                db.close();
                
                if (err) {
                    console.error('Chyba při načítání nových killů pro bounty:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    async processKillForBounty(kill) {
        try {
            // Pouze player vs player killy
            if (kill.is_natural_death || !kill.victim_id) {
                return;
            }

            const killerSteamId = kill.killer_id;
            const victimSteamId = kill.victim_id;
            const killerName = kill.killer_name;
            const victimName = kill.victim_name;

            console.log(`🎯 Bounty: Zpracovávám kill ${killerName} -> ${victimName}`);

            // Základní bounty odměna za kill (5-15 bodů podle náhodnosti)
            const baseKillReward = Math.floor(Math.random() * 11) + 5; // 5-15 bodů

            // Bonus za streak (každý 5. kill v řadě)
            const streakBonus = await this.calculateStreakBonus(killerSteamId);
            
            const totalReward = baseKillReward + streakBonus;

            // Přidej body killerovi
            await this.addBountyPoints(killerSteamId, killerName, totalReward, 
                `Kill reward: ${victimName}${streakBonus > 0 ? ` +${streakBonus} streak bonus` : ''}`, kill.id);

            // Zkontroluj auto-bounty na killera pokud má moc killů
            await this.checkAutoBountyCreation(killerSteamId, killerName);

        } catch (error) {
            console.error('Chyba při zpracování killu pro bounty:', error);
        }
    }

    async calculateStreakBonus(killerSteamId) {
        try {
            // Spočítej recent killy (posledních 24 hodin)
            const db = new sqlite3.Database(this.dbPath);
            
            return new Promise((resolve) => {
                db.get(`
                    SELECT COUNT(*) as killCount 
                    FROM kills 
                    WHERE killer_id = ?
                    AND is_natural_death = 0 
                    AND victim_id IS NOT NULL
                    AND created_at > datetime('now', '-24 hours')
                `, [killerSteamId], (err, row) => {
                    db.close();
                    
                    if (err) {
                        resolve(0);
                        return;
                    }

                    const killCount = row?.killCount || 0;
                    
                    // Streak bonus každých 5 killů
                    if (killCount >= 20) return resolve(100); // Killing machine
                    if (killCount >= 15) return resolve(75);  // Very dangerous
                    if (killCount >= 10) return resolve(50);  // Dangerous
                    if (killCount >= 5) return resolve(25);   // Active hunter
                    
                    resolve(0);
                });
            });
        } catch (error) {
            return 0;
        }
    }

    async addBountyPoints(playerId, playerName, amount, reason, killId = null) {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath);
            
            db.serialize(() => {
                // Ujisti se, že hráč existuje
                db.run(`
                    INSERT OR IGNORE INTO player_bounty_stats 
                    (player_id, player_name, kills, deaths, bounty_points) 
                    VALUES (?, ?, 0, 0, 0)
                `, [playerId, playerName]);

                // Přidej body
                db.run(`
                    UPDATE player_bounty_stats 
                    SET bounty_points = bounty_points + ?,
                        bounty_earned_total = bounty_earned_total + ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE player_id = ?
                `, [amount, amount, playerId], function(err) {
                    if (err) {
                        db.close();
                        reject(err);
                        return;
                    }

                    // Zaznamenej transakci
                    db.run(`
                        INSERT INTO bounty_transactions 
                        (player_id, transaction_type, amount, reason, related_kill_id)
                        VALUES (?, 'earned', ?, ?, ?)
                    `, [playerId, amount, reason, killId], function(err2) {
                        db.close();
                        
                        if (err2) {
                            reject(err2);
                        } else {
                            console.log(`💰 ${playerName} získal ${amount} bounty bodů: ${reason}`);
                            resolve();
                        }
                    });
                });
            });
        });
    }

    async checkAutoBountyCreation(killerSteamId, killerName) {
        // TODO: Implementace automatického vytváření bounty na dangerous playery
        // Prozatím pouze log
        console.log(`🎯 Checking auto-bounty for ${killerName}`);
    }

    async cleanupExpiredData() {
        try {
            // Cleanup starých transakcí (starších než 30 dní)
            const db = new sqlite3.Database(this.dbPath);
            
            return new Promise((resolve) => {
                db.run(`
                    DELETE FROM bounty_transactions 
                    WHERE timestamp < datetime('now', '-30 days')
                `, [], function(err) {
                    db.close();
                    
                    if (err) {
                        console.error('Chyba při cleanup bounty transakcí:', err);
                    } else if (this.changes > 0) {
                        console.log(`🧹 Vyčištěno ${this.changes} starých bounty transakcí`);
                    }
                    resolve();
                });
            });
        } catch (error) {
            console.error('Chyba při cleanup:', error);
        }
    }

    // Debug metody
    async getSystemStats() {
        try {
            const db = new sqlite3.Database(this.dbPath);
            
            return new Promise((resolve, reject) => {
                const stats = {};
                
                // Player count
                db.get('SELECT COUNT(*) as count FROM player_bounty_stats', [], (err, row) => {
                    if (err) {
                        db.close();
                        reject(err);
                        return;
                    }
                    
                    stats.totalPlayers = row.count;
                    
                    // Transaction count
                    db.get('SELECT COUNT(*) as count FROM bounty_transactions', [], (err2, row2) => {
                        if (err2) {
                            db.close();
                            reject(err2);
                            return;
                        }
                        
                        stats.totalTransactions = row2.count;
                        
                        // Total bounty in circulation
                        db.get('SELECT SUM(bounty_points) as total FROM player_bounty_stats', [], (err3, row3) => {
                            db.close();
                            
                            if (err3) {
                                reject(err3);
                            } else {
                                stats.totalBountyPoints = row3.total || 0;
                                stats.lastProcessedKillId = this.lastProcessedKillId;
                                stats.initialized = this.initialized;
                                resolve(stats);
                            }
                        });
                    });
                });
            });
        } catch (error) {
            throw error;
        }
    }
}

module.exports = BountyService;