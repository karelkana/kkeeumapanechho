// services/database.js - Databázový servis pro friends management
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Cesta k databázi
const DB_PATH = path.join(__dirname, '..', 'data', 'friends.db');

// Ujistit se, že složka data existuje
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('Vytvořena složka pro databázi:', dataDir);
}

// Vytvoření databáze
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Chyba při připojování k databázi friends:', err);
    } else {
        console.log('✅ Připojeno k SQLite databázi friends:', DB_PATH);
        initializeDatabase();
    }
});

// Inicializace databázových tabulek
function initializeDatabase() {
    console.log('🔄 Inicializace databázových tabulek...');
    
    // Tabulka pro uživatele (pro cache Steam dat)
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            steam_id TEXT PRIMARY KEY,
            display_name TEXT,
            avatar_url TEXT,
            profile_url TEXT,
            last_login DATETIME,
            last_seen_online DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Chyba při vytváření tabulky users:', err);
        } else {
            console.log('✅ Tabulka users je připravena');
        }
    });
    
    // Tabulka pro přátelé a žádosti o přátelství
    db.run(`
        CREATE TABLE IF NOT EXISTS friends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            friend_id TEXT NOT NULL,
            user_name TEXT,
            friend_name TEXT,
            user_permissions TEXT DEFAULT '{"location":true,"stats":false}',
            friend_permissions TEXT DEFAULT '{"location":true,"stats":false}',
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(steam_id),
            FOREIGN KEY (friend_id) REFERENCES users(steam_id)
        )
    `, (err) => {
        if (err) {
            console.error('Chyba při vytváření tabulky friends:', err);
        } else {
            console.log('✅ Tabulka friends je připravena');
        }
    });
    
    // Indexy pro rychlé vyhledávání
    db.run(`CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_friends_status ON friends(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login)`);
    
    // Trigger pro automatické update updated_at
    db.run(`
        CREATE TRIGGER IF NOT EXISTS friends_updated_at 
        AFTER UPDATE ON friends
        BEGIN
            UPDATE friends SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END
    `);
    
    db.run(`
        CREATE TRIGGER IF NOT EXISTS users_updated_at 
        AFTER UPDATE ON users
        BEGIN
            UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE steam_id = NEW.steam_id;
        END
    `);
    
    console.log('✅ Databázové indexy a triggery vytvořeny');
}

// Funkce pro parsování permissions z JSON stringu
function parsePermissions(permissionsString) {
    try {
        if (!permissionsString) {
            return { location: true, stats: false };
        }
        
        const permissions = JSON.parse(permissionsString);
        
        // Ujistit se, že máme všechny potřebné klíče
        return {
            location: Boolean(permissions.location !== undefined ? permissions.location : true),
            stats: Boolean(permissions.stats !== undefined ? permissions.stats : false)
        };
    } catch (error) {
        console.error('Chyba při parsování permissions:', error);
        return { location: true, stats: false };
    }
}

// Funkce pro serializaci permissions do JSON stringu
function serializePermissions(permissions) {
    try {
        const perms = permissions || { location: true, stats: false };
        return JSON.stringify({
            location: Boolean(perms.location),
            stats: Boolean(perms.stats)
        });
    } catch (error) {
        console.error('Chyba při serializaci permissions:', error);
        return JSON.stringify({ location: true, stats: false });
    }
}

// NOVÁ funkce - získání uživatele podle Steam ID
function getUserBySteamId(steamId) {
    return new Promise((resolve, reject) => {
        if (!steamId) {
            resolve(null);
            return;
        }
        
        db.get(
            'SELECT * FROM users WHERE steam_id = ?',
            [steamId],
            (err, row) => {
                if (err) {
                    console.error('Chyba při načítání uživatele:', err);
                    reject(err);
                } else {
                    resolve(row || null);
                }
            }
        );
    });
}

// NOVÁ funkce - vyhledání uživatelů podle jména
function searchUsersByName(searchTerm, limit = 10) {
    return new Promise((resolve, reject) => {
        if (!searchTerm || searchTerm.trim().length < 2) {
            resolve([]);
            return;
        }
        
        const term = `%${searchTerm.trim()}%`;
        
        db.all(
            'SELECT * FROM users WHERE display_name LIKE ? ORDER BY last_login DESC LIMIT ?',
            [term, limit],
            (err, rows) => {
                if (err) {
                    console.error('Chyba při vyhledávání uživatelů:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            }
        );
    });
}

// OPRAVENÁ funkce - vytvoření nebo aktualizace uživatele
function createOrUpdateUser(userData) {
    return new Promise((resolve, reject) => {
        if (!userData || !userData.id) {
            reject(new Error('Chybí uživatelská data nebo ID'));
            return;
        }
        
        const { id, displayName, photos } = userData;
        const avatarUrl = photos && photos.length > 0 ? photos[0].value : null;
        const profileUrl = `https://steamcommunity.com/profiles/${id}`;
        
        // Vložit nebo aktualizovat uživatele
        db.run(`
            INSERT OR REPLACE INTO users 
            (steam_id, display_name, avatar_url, profile_url, last_login, last_seen_online) 
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [id, displayName, avatarUrl, profileUrl], function(err) {
            if (err) {
                console.error('Chyba při ukládání uživatele:', err);
                reject(err);
            } else {
                console.log(`✅ Uživatel ${displayName} (${id}) uložen/aktualizován`);
                resolve({
                    steam_id: id,
                    display_name: displayName,
                    avatar_url: avatarUrl,
                    profile_url: profileUrl
                });
            }
        });
    });
}

// NOVÁ funkce pro aktualizaci online statusu
function updateUserOnlineStatus(steamId) {
    return new Promise((resolve, reject) => {
        if (!steamId) {
            reject(new Error('Chybí Steam ID'));
            return;
        }
        
        db.run(
            'UPDATE users SET last_seen_online = CURRENT_TIMESTAMP WHERE steam_id = ?',
            [steamId],
            function(err) {
                if (err) {
                    console.error('Chyba při aktualizaci online statusu:', err);
                    reject(err);
                } else {
                    console.log(`✅ Online status aktualizován pro uživatele ${steamId}`);
                    resolve(this.changes > 0);
                }
            }
        );
    });
}

// OPRAVENÁ funkce - alias pro createOrUpdateUser
function saveUser(userData) {
    return createOrUpdateUser(userData);
}

// NOVÁ funkce pro aktualizaci last_seen_online
function updateUserLastSeen(steamId) {
    return updateUserOnlineStatus(steamId);
}

// Funkce pro vyčištění starých pending requestů (starších než 30 dní)
function cleanupOldRequests() {
    db.run(`
        DELETE FROM friends 
        WHERE status = 'pending' 
        AND created_at < datetime('now', '-30 days')
    `, function(err) {
        if (err) {
            console.error('Chyba při čištění starých žádostí:', err);
        } else if (this.changes > 0) {
            console.log(`🧹 Vyčištěno ${this.changes} starých žádostí o přátelství`);
        }
    });
}

// Spustit cleanup každých 24 hodin
setInterval(cleanupOldRequests, 24 * 60 * 60 * 1000);

// Debug funkce pro výpis obsahu databáze
function debugDatabase() {
    db.all('SELECT * FROM friends ORDER BY created_at DESC LIMIT 10', (err, rows) => {
        if (err) {
            console.error('Debug chyba:', err);
        } else {
            console.log('🔍 Posledních 10 záznamů v friends tabulce:');
            rows.forEach(row => {
                console.log(`  ${row.id}: ${row.user_name} -> ${row.friend_name} (${row.status})`);
            });
        }
    });
    
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        if (err) {
            console.error('Debug chyba users:', err);
        } else {
            console.log(`👥 Celkem uživatelů v databázi: ${row.count}`);
        }
    });
}

// Export funkcí a databáze
module.exports = {
    db,
    parsePermissions,
    serializePermissions,
    getUserBySteamId,        // API potřebuje tuto funkci
    searchUsersByName,       // API potřebuje tuto funkci  
    createOrUpdateUser,      // Hlavní funkce pro vytvoření/aktualizaci
    saveUser,                // Alias pro kompatibilitu
    updateUserOnlineStatus,  // Hlavní funkce pro online status
    updateUserLastSeen,      // Alias pro kompatibilitu
    cleanupOldRequests,
    debugDatabase
};

// Debug vypis při startu serveru
setTimeout(() => {
    debugDatabase();
}, 2000);