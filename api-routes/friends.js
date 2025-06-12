// api-routes/friends.js - Kompletní API pro správu přátel s user managementem
const express = require('express');
const router = express.Router();
const { db, parsePermissions, getUserBySteamId, searchUsersByName } = require('../services/database');

// Middleware pro kontrolu přihlášení
const requireAuth = (req, res, next) => {
    if (!req.user || !req.user.id) {
        console.log('🚫 Nepřihlášený pokus o přístup k friends API:', {
            hasUser: !!req.user,
            userId: req.user ? req.user.id : null,
            path: req.path,
            method: req.method
        });
        
        return res.status(401).json({ 
            success: false, 
            error: 'Musíte být přihlášeni',
            loginUrl: '/auth/steam'
        });
    }
    
    console.log(`👤 Auth OK pro friends API: ${req.user.displayName} (${req.user.id})`);
    next();
};

// Pomocná funkce pro serializaci permissions
const serializePermissions = (permissions) => {
    const perms = permissions || { location: true, stats: false };
    return JSON.stringify(perms);
};

// Pomocná funkce pro získání jména uživatele
const getUserDisplayName = async (steamId) => {
    try {
        const user = await getUserBySteamId(steamId);
        return user ? user.display_name : `Player ${steamId}`;
    } catch (error) {
        console.error('Chyba při získávání jména uživatele:', error);
        return `Player ${steamId}`;
    }
};

// GET /api/friends/friends - Načtení všech přátel a žádostí
router.get('/friends', requireAuth, (req, res) => {
    const userId = req.user.id;
    
    console.log(`📋 Načítám přátele a žádosti pro uživatele: ${req.user.displayName} (${userId})`);
    
    // Získat všechny přátele s rozšířenými informacemi
    db.all(`
        SELECT 
            f.*,
            CASE 
                WHEN f.user_id = ? THEN f.friend_id 
                ELSE f.user_id 
            END as friend_steam_id,
            CASE 
                WHEN f.user_id = ? THEN f.friend_name 
                ELSE f.user_name 
            END as friend_name,
            CASE 
                WHEN f.user_id = ? THEN f.friend_permissions 
                ELSE f.user_permissions 
            END as friend_permissions,
            u.display_name as friend_display_name,
            u.avatar_url as friend_avatar_url,
            u.last_login as friend_last_login,
            u.last_seen_online as friend_last_seen_online
        FROM friends f
        LEFT JOIN users u ON (
            CASE 
                WHEN f.user_id = ? THEN f.friend_id 
                ELSE f.user_id 
            END = u.steam_id
        )
        WHERE (f.user_id = ? OR f.friend_id = ?)
        AND f.status = 'accepted'
        ORDER BY u.last_login DESC
    `, [userId, userId, userId, userId, userId, userId], (err, friends) => {
        if (err) {
            console.error('❌ Chyba při načítání přátel:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Chyba při načítání přátel' 
            });
        }
        
        // Získat příchozí žádosti (žádosti adresované mně)
        db.all(`
            SELECT 
                f.id, f.user_id as requester_steam_id, f.user_name as requester_name, 
                f.user_permissions, f.created_at,
                u.display_name as requester_display_name,
                u.avatar_url as requester_avatar_url,
                u.last_login as requester_last_login
            FROM friends f
            LEFT JOIN users u ON f.user_id = u.steam_id
            WHERE f.friend_id = ? AND f.status = 'pending'
            ORDER BY f.created_at DESC
        `, [userId], (err, incomingRequests) => {
            if (err) {
                console.error('❌ Chyba při načítání příchozích žádostí:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Chyba při načítání žádostí' 
                });
            }
            
            // Získat odchozí žádosti (žádosti které jsem poslal)
            db.all(`
                SELECT 
                    f.id, f.friend_id, f.friend_name, f.friend_permissions, f.created_at,
                    u.display_name as friend_display_name,
                    u.avatar_url as friend_avatar_url,
                    u.last_login as friend_last_login
                FROM friends f
                LEFT JOIN users u ON f.friend_id = u.steam_id
                WHERE f.user_id = ? AND f.status = 'pending'
                ORDER BY f.created_at DESC
            `, [userId], (err, outgoingRequests) => {
                if (err) {
                    console.error('❌ Chyba při načítání odchozích žádostí:', err);
                    return res.status(500).json({ 
                        success: false, 
                        error: 'Chyba při načítání odchozích žádostí' 
                    });
                }
                
                console.log(`✅ Načteno: ${friends.length} přátel, ${incomingRequests.length} příchozích, ${outgoingRequests.length} odchozích žádostí`);
                
                // Přidat computed properties pro lepší frontend handling
                const enhancedFriends = friends.map(f => ({
                    ...f,
                    friend_name: f.friend_display_name || f.friend_name || `Player ${f.friend_steam_id}`,
                    permissions: parsePermissions(f.friend_permissions),
                    isOnline: false, // TODO: Implementovat real-time online status
                    lastSeen: f.friend_last_seen_online || f.friend_last_login
                }));
                
                const enhancedIncoming = incomingRequests.map(r => ({
                    ...r,
                    requester_name: r.requester_display_name || r.requester_name || `Player ${r.requester_steam_id}`,
                    permissions: parsePermissions(r.user_permissions)
                }));
                
                const enhancedOutgoing = outgoingRequests.map(r => ({
                    ...r,
                    friend_name: r.friend_display_name || r.friend_name || `Player ${r.friend_id}`,
                    permissions: parsePermissions(r.friend_permissions)
                }));
                
                res.json({
                    success: true,
                    friends: enhancedFriends,
                    incomingRequests: enhancedIncoming,
                    outgoingRequests: enhancedOutgoing,
                    summary: {
                        totalFriends: enhancedFriends.length,
                        pendingIncoming: enhancedIncoming.length,
                        pendingOutgoing: enhancedOutgoing.length
                    }
                });
            });
        });
    });
});

// POST /api/friends/request - Odeslání žádosti o přátelství
router.post('/request', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const userName = req.user.displayName || `Player ${userId}`;
    const { friendId, shareLocation = true, shareStats = false } = req.body;
    
    if (!friendId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Chybí friendId (Steam ID cílového uživatele)' 
        });
    }
    
    if (friendId === userId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Nemůžete přidat sebe jako přítele' 
        });
    }
    
    console.log(`📤 Odesílám žádost o přátelství: ${userName} (${userId}) -> ${friendId}`);
    
    try {
        // Ověřit, že cílový uživatel existuje v našé databázi
        const targetUser = await getUserBySteamId(friendId);
        const targetName = targetUser ? targetUser.display_name : `Player ${friendId}`;
        
        if (!targetUser) {
            console.log(`⚠️ Cílový uživatel ${friendId} neexistuje v databázi, ale pokračuji`);
        }
        
        // Kontrola, zda už žádost nebo přátelství neexistuje
        db.get(`
            SELECT id, status FROM friends
            WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
        `, [userId, friendId, friendId, userId], (err, existing) => {
            if (err) {
                console.error('❌ Chyba při kontrole existující žádosti:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Chyba při kontrole žádosti' 
                });
            }
            
            if (existing) {
                if (existing.status === 'accepted') {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Již jste přátelé' 
                    });
                } else if (existing.status === 'pending') {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Žádost již byla odeslána nebo čeká na vaše schválení' 
                    });
                }
            }
            
            const userPermissions = serializePermissions({ location: shareLocation, stats: shareStats });
            const friendPermissions = serializePermissions({ location: true, stats: false }); // Výchozí pro přítele
            
            // Vytvoření nové žádosti
            db.run(`
                INSERT INTO friends (
                    user_id, friend_id, user_name, friend_name,
                    user_permissions, friend_permissions, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
            `, [userId, friendId, userName, targetName, userPermissions, friendPermissions], function(err) {
                if (err) {
                    console.error('❌ Chyba při vytváření žádosti o přátelství:', err);
                    return res.status(500).json({ 
                        success: false, 
                        error: 'Chyba při odesílání žádosti' 
                    });
                }
                
                console.log(`✅ Žádost o přátelství vytvořena s ID: ${this.lastID}`);
                
                res.json({
                    success: true,
                    message: `Žádost o přátelství byla odeslána uživateli ${targetName}`,
                    requestId: this.lastID,
                    targetUser: {
                        steamId: friendId,
                        name: targetName,
                        exists: !!targetUser
                    }
                });
            });
        });
        
    } catch (error) {
        console.error('❌ Chyba při zpracování žádosti o přátelství:', error);
        res.status(500).json({
            success: false,
            error: 'Chyba při zpracování žádosti'
        });
    }
});

// POST /api/friends/accept - Přijetí žádosti o přátelství
router.post('/accept', requireAuth, (req, res) => {
    const userId = req.user.id;
    const userName = req.user.displayName || `Player ${userId}`;
    const { requestId, shareLocation = true, shareStats = false } = req.body;
    
    if (!requestId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Chybí requestId' 
        });
    }
    
    console.log(`✅ Přijímám žádost o přátelství: requestId ${requestId}, uživatel: ${userName}`);
    
    // Najít žádost a ověřit, že je adresována mně
    db.get(`
        SELECT f.*, u.display_name as requester_display_name
        FROM friends f
        LEFT JOIN users u ON f.user_id = u.steam_id
        WHERE f.id = ? AND f.friend_id = ? AND f.status = 'pending'
    `, [requestId, userId], (err, request) => {
        if (err) {
            console.error('❌ Chyba při načítání žádosti:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Chyba při načítání žádosti' 
            });
        }
        
        if (!request) {
            return res.status(404).json({ 
                success: false, 
                error: 'Žádost nenalezena nebo nemáte oprávnění ji přijmout' 
            });
        }
        
        // Aktualizovat permissions pro příjemce (já)
        const myPermissions = serializePermissions({ location: shareLocation, stats: shareStats });
        const requesterName = request.requester_display_name || request.user_name || `Player ${request.user_id}`;
        
        // Přijmout žádost - změnit status na 'accepted' a aktualizovat permissions
        db.run(`
            UPDATE friends 
            SET status = 'accepted', 
                friend_permissions = ?,
                friend_name = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `, [myPermissions, userName, requestId], function(err) {
            if (err) {
                console.error('❌ Chyba při přijímání žádosti:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Chyba při přijímání žádosti' 
                });
            }
            
            console.log(`✅ Žádost o přátelství přijata: ${requesterName} <-> ${userName}`);
            
            res.json({
                success: true,
                message: `Jste nyní přátelé s ${requesterName}`,
                friendship: {
                    friendSteamId: request.user_id,
                    friendName: requesterName,
                    myPermissions: parsePermissions(myPermissions),
                    friendPermissions: parsePermissions(request.user_permissions)
                }
            });
        });
    });
});

// POST /api/friends/reject - Odmítnutí žádosti o přátelství
router.post('/reject', requireAuth, (req, res) => {
    const userId = req.user.id;
    const { requestId } = req.body;
    
    if (!requestId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Chybí requestId' 
        });
    }
    
    console.log(`❌ Odmítám žádost o přátelství: requestId ${requestId}, uživatel: ${req.user.displayName}`);
    
    // Najít žádost pro získání informací před smazáním
    db.get(`
        SELECT f.*, u.display_name as requester_display_name
        FROM friends f
        LEFT JOIN users u ON f.user_id = u.steam_id
        WHERE f.id = ? AND f.friend_id = ? AND f.status = 'pending'
    `, [requestId, userId], (err, request) => {
        if (err) {
            console.error('❌ Chyba při načítání žádosti:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Chyba při načítání žádosti' 
            });
        }
        
        if (!request) {
            return res.status(404).json({ 
                success: false, 
                error: 'Žádost nenalezena nebo nemáte oprávnění' 
            });
        }
        
        const requesterName = request.requester_display_name || request.user_name || `Player ${request.user_id}`;
        
        // Smazat žádost
        db.run(`
            DELETE FROM friends
            WHERE id = ? AND friend_id = ? AND status = 'pending'
        `, [requestId, userId], function(err) {
            if (err) {
                console.error('❌ Chyba při odmítání žádosti:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Chyba při odmítání žádosti' 
                });
            }
            
            console.log(`✅ Žádost o přátelství odmítnuta a smazána: ${requesterName}`);
            
            res.json({
                success: true,
                message: `Žádost od ${requesterName} byla odmítnuta`
            });
        });
    });
});

// POST /api/friends/cancel - Zrušení vlastní žádosti
router.post('/cancel', requireAuth, (req, res) => {
    const userId = req.user.id;
    const { friendId } = req.body;
    
    if (!friendId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Chybí friendId' 
        });
    }
    
    console.log(`🗑️ Ruším žádost o přátelství: ${req.user.displayName} (${userId}) -> ${friendId}`);
    
    // Najít žádost pro získání informací před smazáním
    db.get(`
        SELECT f.*, u.display_name as friend_display_name
        FROM friends f
        LEFT JOIN users u ON f.friend_id = u.steam_id
        WHERE f.user_id = ? AND f.friend_id = ? AND f.status = 'pending'
    `, [userId, friendId], (err, request) => {
        if (err) {
            console.error('❌ Chyba při načítání žádosti:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Chyba při načítání žádosti' 
            });
        }
        
        if (!request) {
            return res.status(404).json({ 
                success: false, 
                error: 'Žádost nenalezena' 
            });
        }
        
        const friendName = request.friend_display_name || request.friend_name || `Player ${friendId}`;
        
        // Smazat žádost
        db.run(`
            DELETE FROM friends
            WHERE user_id = ? AND friend_id = ? AND status = 'pending'
        `, [userId, friendId], function(err) {
            if (err) {
                console.error('❌ Chyba při rušení žádosti:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Chyba při rušení žádosti' 
                });
            }
            
            console.log(`✅ Žádost o přátelství zrušena: -> ${friendName}`);
            
            res.json({
                success: true,
                message: `Žádost pro ${friendName} byla zrušena`
            });
        });
    });
});

// DELETE /api/friends/:steamId - Odstranění přítele
router.delete('/:steamId', requireAuth, (req, res) => {
    const userId = req.user.id;
    const friendId = req.params.steamId;
    
    if (!friendId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Chybí Steam ID přítele' 
        });
    }
    
    console.log(`🗑️ Odebírám přítele: ${req.user.displayName} (${userId}) <-> ${friendId}`);
    
    // Najít přátelství pro získání informací před smazáním
    db.get(`
        SELECT 
            f.*,
            CASE 
                WHEN f.user_id = ? THEN u2.display_name 
                ELSE u1.display_name 
            END as friend_display_name
        FROM friends f
        LEFT JOIN users u1 ON f.user_id = u1.steam_id
        LEFT JOIN users u2 ON f.friend_id = u2.steam_id
        WHERE ((f.user_id = ? AND f.friend_id = ?) OR (f.user_id = ? AND f.friend_id = ?))
        AND f.status = 'accepted'
    `, [userId, userId, friendId, friendId, userId], (err, friendship) => {
        if (err) {
            console.error('❌ Chyba při načítání přátelství:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Chyba při načítání přátelství' 
            });
        }
        
        if (!friendship) {
            return res.status(404).json({ 
                success: false, 
                error: 'Přátelství nenalezeno' 
            });
        }
        
        const friendName = friendship.friend_display_name || 
                          (friendship.user_id === userId ? friendship.friend_name : friendship.user_name) || 
                          `Player ${friendId}`;
        
        // Smazat přátelství (funguje v obou směrech)
        db.run(`
            DELETE FROM friends
            WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
            AND status = 'accepted'
        `, [userId, friendId, friendId, userId], function(err) {
            if (err) {
                console.error('❌ Chyba při odebírání přítele:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Chyba při odebírání přítele' 
                });
            }
            
            console.log(`✅ Přátelství odebráno: <-> ${friendName}`);
            
            res.json({
                success: true,
                message: `${friendName} byl odebrán ze seznamu přátel`
            });
        });
    });
});

// GET /api/friends/search - Vyhledání uživatelů pro přidání
router.get('/search', requireAuth, async (req, res) => {
    try {
        const { q: searchTerm, limit = 10 } = req.query;
        
        if (!searchTerm || searchTerm.trim().length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Hledaný termín musí mít alespoň 2 znaky'
            });
        }
        
        const currentUserId = req.user.id;
        console.log(`🔍 Vyhledávání uživatelů pro ${req.user.displayName}: "${searchTerm}"`);
        
        const users = await searchUsersByName(searchTerm.trim(), Math.min(parseInt(limit), 20));
        
        // Získat seznam již existujících vztahů
        const existingRelations = await new Promise((resolve, reject) => {
            db.all(`
                SELECT DISTINCT
                    CASE 
                        WHEN user_id = ? THEN friend_id 
                        ELSE user_id 
                    END as related_user_id,
                    status
                FROM friends
                WHERE (user_id = ? OR friend_id = ?)
            `, [currentUserId, currentUserId, currentUserId], (err, rows) => {
                if (err) {
                    console.error('❌ Chyba při načítání vztahů:', err);
                    resolve([]);
                } else {
                    resolve(rows || []);
                }
            });
        });
        
        const relatedUserIds = existingRelations.map(r => r.related_user_id);
        
        const filteredUsers = users
            .filter(user => user.steam_id !== currentUserId && !relatedUserIds.includes(user.steam_id))
            .map(user => ({
                steamId: user.steam_id,
                displayName: user.display_name,
                avatarUrl: user.avatar_url,
                lastLogin: user.last_login,
                lastSeenOnline: user.last_seen_online
            }));
        
        console.log(`📤 Nalezeno ${filteredUsers.length} dostupných uživatelů z ${users.length} celkem`);
        
        res.json({
            success: true,
            users: filteredUsers,
            searchTerm: searchTerm,
            totalFound: users.length,
            availableCount: filteredUsers.length,
            excludedCount: users.length - filteredUsers.length
        });
        
    } catch (error) {
        console.error('❌ Chyba při vyhledávání uživatelů:', error);
        res.status(500).json({
            success: false,
            error: 'Chyba při vyhledávání uživatelů'
        });
    }
});

// GET /api/friends/debug - Debug endpoint pro testování
router.get('/debug', requireAuth, (req, res) => {
    const userId = req.user.id;
    
    console.log(`🔍 Debug friends pro: ${req.user.displayName} (${userId})`);
    
    db.all(`
        SELECT f.*, 
               u1.display_name as user_display_name,
               u2.display_name as friend_display_name
        FROM friends f
        LEFT JOIN users u1 ON f.user_id = u1.steam_id
        LEFT JOIN users u2 ON f.friend_id = u2.steam_id
        WHERE f.user_id = ? OR f.friend_id = ?
        ORDER BY f.created_at DESC
    `, [userId, userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                error: err.message 
            });
        }
        
        res.json({
            success: true,
            userId: userId,
            userName: req.user.displayName,
            isAdmin: req.user.isAdmin,
            allFriendRecords: rows,
            recordCount: rows.length,
            timestamp: new Date().toISOString()
        });
    });
});

module.exports = router;