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
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Chyba při vytváření tabulky friends:', err);
        } else {
            console.log('✅ Tabulka friends je připravena');
        }
    });
    
    // Index pro rychlé vyhledávání
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id)
    `);
    
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id)
    `);
    
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_friends_status ON friends(status)
    `);
    
    // Trigger pro automatické update updated_at
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
}

// Export funkcí a databáze
module.exports = {
    db,
    parsePermissions,
    serializePermissions,
    cleanupOldRequests,
    debugDatabase
};

// Debug vypis při startu serveru
setTimeout(() => {
    debugDatabase();
}, 2000);