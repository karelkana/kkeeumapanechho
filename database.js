// services/database.js - Rozšířený databázový servis s user management
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
    
    // Tabulka pro uživatele - NOVÁ!
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            steam_id TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            avatar_url TEXT,
            profile_url TEXT,
            is_admin BOOLEAN DEFAULT 0,
            first_login DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen_online DATETIME,
            total_logins INTEGER DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
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
    
    // Tabulka pro přátelé a žádosti o přátelství - ROZŠÍŘENÁ
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
    const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_users_steam_id ON users(steam_id)',
        'CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login)',
        'CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id)',
        'CREATE INDEX IF NOT EXISTS idx_friends_status ON friends(status)'
    ];
    
    indexes.forEach(indexSql => {
        db.run(indexSql, (err) => {
            if (err) console.error('Chyba při vytváření indexu:', err);
        });
    });
    
    // Triggery pro automatické update updated_at
    db.run(`
        CREATE TRIGGER IF NOT EXISTS users_updated_at 
        AFTER UPDATE ON users
        BEGIN
            UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END
    `);
    
    db.run(`
        CREATE TRIGGER IF NOT EXISTS friends_updated_at 
        AFTER UPDATE ON friends
        BEGIN
            UPDATE friends SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
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

// NOVÉ funkce pro správu uživatelů

// Vytvoření nebo aktualizace uživatele při přihlášení
function createOrUpdateUser(steamProfile, adminSteamIds = []) {
    return new Promise((resolve, reject) => {
        const steamId = steamProfile.id;
        const displayName = steamProfile.displayName || `Player ${steamId}`;
        const avatarUrl = steamProfile.photos && steamProfile.photos.length > 0 ? steamProfile.photos[0].value : null;
        const profileUrl = steamProfile.profileUrl || `https://steamcommunity.com/profiles/${steamId}`;
        const isAdmin = adminSteamIds.includes(steamId);
        
        console.log(`👤 Zpracovávám uživatele: ${displayName} (${steamId}), Admin: ${isAdmin}`);
        
        // Nejdříve zkusit najít existujícího uživatele
        db.get(`
            SELECT * FROM users WHERE steam_id = ?
        `, [steamId], (err, existingUser) => {
            if (err) {
                console.error('Chyba při hledání uživatele:', err);
                return reject(err);
            }
            
            if (existingUser) {
                // Aktualizovat existujícího uživatele
                console.log(`🔄 Aktualizuji existujícího uživatele: ${displayName}`);
                
                db.run(`
                    UPDATE users 
                    SET display_name = ?, 
                        avatar_url = ?, 
                        profile_url = ?,
                        is_admin = ?,
                        last_login = CURRENT_TIMESTAMP,
                        total_logins = total_logins + 1,
                        is_active = 1
                    WHERE steam_id = ?
                `, [displayName, avatarUrl, profileUrl, isAdmin, steamId], function(updateErr) {
                    if (updateErr) {
                        console.error('Chyba při aktualizaci uživatele:', updateErr);
                        return reject(updateErr);
                    }
                    
                    console.log(`✅ Uživatel aktualizován: ${displayName}`);
                    
                    // Vrátit aktualizovaného uživatele
                    db.get(`SELECT * FROM users WHERE steam_id = ?`, [steamId], (selectErr, updatedUser) => {
                        if (selectErr) {
                            return reject(selectErr);
                        }
                        resolve(updatedUser);
                    });
                });
            } else {
                // Vytvořit nového uživatele
                console.log(`✨ Vytvářím nového uživatele: ${displayName}`);
                
                db.run(`
                    INSERT INTO users (
                        steam_id, display_name, avatar_url, profile_url, is_admin,
                        first_login, last_login, total_logins, is_active
                    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1)
                `, [steamId, displayName, avatarUrl, profileUrl, isAdmin], function(insertErr) {
                    if (insertErr) {
                        console.error('Chyba při vytváření uživatele:', insertErr);
                        return reject(insertErr);
                    }
                    
                    console.log(`✅ Nový uživatel vytvořen: ${displayName} (ID: ${this.lastID})`);
                    
                    // Vrátit nového uživatele
                    db.get(`SELECT * FROM users WHERE id = ?`, [this.lastID], (selectErr, newUser) => {
                        if (selectErr) {
                            return reject(selectErr);
                        }
                        resolve(newUser);
                    });
                });
            }
        });
    });
}

// Získání uživatele podle Steam ID
function getUserBySteamId(steamId) {
    return new Promise((resolve, reject) => {
        db.get(`
            SELECT * FROM users WHERE steam_id = ? AND is_active = 1
        `, [steamId], (err, user) => {
            if (err) {
                console.error('Chyba při načítání uživatele:', err);
                return reject(err);
            }
            resolve(user);
        });
    });
}

// Aktualizace posledního online času uživatele
function updateUserLastSeen(steamId) {
    return new Promise((resolve, reject) => {
        db.run(`
            UPDATE users 
            SET last_seen_online = CURRENT_TIMESTAMP 
            WHERE steam_id = ?
        `, [steamId], function(err) {
            if (err) {
                console.error('Chyba při aktualizaci last_seen:', err);
                return reject(err);
            }
            resolve(this.changes > 0);
        });
    });
}

// Vyhledání uživatelů podle jména (pro friend requests)
function searchUsersByName(searchTerm, limit = 10) {
    return new Promise((resolve, reject) => {
        const searchPattern = `%${searchTerm}%`;
        
        db.all(`
            SELECT steam_id, display_name, avatar_url, last_login, last_seen_online
            FROM users 
            WHERE display_name LIKE ? 
            AND is_active = 1
            ORDER BY last_login DESC 
            LIMIT ?
        `, [searchPattern, limit], (err, users) => {
            if (err) {
                console.error('Chyba při vyhledávání uživatelů:', err);
                return reject(err);
            }
            resolve(users || []);
        });
    });
}

// Získání všech aktivních uživatelů (pro admin)
function getAllActiveUsers(limit = 100) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT steam_id, display_name, avatar_url, is_admin, 
                   first_login, last_login, last_seen_online, total_logins
            FROM users 
            WHERE is_active = 1
            ORDER BY last_login DESC 
            LIMIT ?
        `, [limit], (err, users) => {
            if (err) {
                console.error('Chyba při načítání všech uživatelů:', err);
                return reject(err);
            }
            resolve(users || []);
        });
    });
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

// Vyčištění neaktivních uživatelů (neviděni déle než 6 měsíců)
function cleanupInactiveUsers() {
    db.run(`
        UPDATE users 
        SET is_active = 0 
        WHERE last_login < datetime('now', '-6 months')
        AND is_active = 1
    `, function(err) {
        if (err) {
            console.error('Chyba při označování neaktivních uživatelů:', err);
        } else if (this.changes > 0) {
            console.log(`🧹 Označeno ${this.changes} uživatelů jako neaktivní`);
        }
    });
}

// Spustit cleanup každých 24 hodin
setInterval(() => {
    cleanupOldRequests();
    cleanupInactiveUsers();
}, 24 * 60 * 60 * 1000);

// Debug funkce pro výpis obsahu databáze
function debugDatabase() {
    // Debug uživatelé
    db.all('SELECT steam_id, display_name, is_admin, last_login FROM users WHERE is_active = 1 ORDER BY last_login DESC LIMIT 5', (err, users) => {
        if (err) {
            console.error('Debug chyba (users):', err);
        } else {
            console.log('🔍 Posledních 5 aktivních uživatelů:');
            users.forEach(user => {
                console.log(`  ${user.display_name} (${user.steam_id}) - Admin: ${user.is_admin ? 'Ano' : 'Ne'} - Poslední login: ${user.last_login}`);
            });
        }
    });
    
    // Debug přátelství
    db.all(`
        SELECT f.*, 
               u1.display_name as user_display_name,
               u2.display_name as friend_display_name
        FROM friends f
        LEFT JOIN users u1 ON f.user_id = u1.steam_id
        LEFT JOIN users u2 ON f.friend_id = u2.steam_id
        ORDER BY f.created_at DESC LIMIT 5
    `, (err, friends) => {
        if (err) {
            console.error('Debug chyba (friends):', err);
        } else {
            console.log('🔍 Posledních 5 záznamů přátelství:');
            friends.forEach(friend => {
                console.log(`  ${friend.user_display_name || friend.user_name} -> ${friend.friend_display_name || friend.friend_name} (${friend.status})`);
            });
        }
    });
}

// Export funkcí a databáze
module.exports = {
    db,
    parsePermissions,
    serializePermissions,
    createOrUpdateUser,
    getUserBySteamId,
    updateUserLastSeen,
    searchUsersByName,
    getAllActiveUsers,
    cleanupOldRequests,
    cleanupInactiveUsers,
    debugDatabase
};

// Debug vypis při startu serveru
setTimeout(() => {
    debugDatabase();
}, 2000);