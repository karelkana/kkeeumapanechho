// api-routes/bounty.js - Bounty API endpointy
const express = require('express');
const router = express.Router();
const BountyService = require('../services/bounty');

const bountyService = new BountyService();

// Middleware pro kontrolu přihlášení
const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ 
            success: false, 
            error: 'Musíte být přihlášeni' 
        });
    }
    next();
};

// === EKONOMIKA ===

// GET /api/bounty/economy/:steamId - získání ekonomiky hráče
router.get('/economy/:steamId', async (req, res) => {
    try {
        const { steamId } = req.params;
        
        // Kontrola oprávnění - pouze vlastní data nebo admin
        if (req.user && req.user.id !== steamId && !req.user.isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Nedostatečná oprávnění'
            });
        }
        
        const economy = await bountyService.getPlayerEconomy(steamId);
        
        if (!economy) {
            return res.status(404).json({
                success: false,
                error: 'Hráč nenalezen'
            });
        }
        
        res.json({
            success: true,
            economy: economy
        });
        
    } catch (error) {
        console.error('API Error - economy:', error);
        res.status(500).json({
            success: false,
            error: 'Chyba serveru'
        });
    }
});

// GET /api/bounty/economy - získání vlastní ekonomiky
router.get('/economy', requireAuth, async (req, res) => {
    try {
        const economy = await bountyService.getPlayerEconomy(req.user.id);
        
        res.json({
            success: true,
            economy: economy
        });
        
    } catch (error) {
        console.error('API Error - my economy:', error);
        res.status(500).json({
            success: false,
            error: 'Chyba serveru'
        });
    }
});

// GET /api/bounty/leaderboard - ekonomické žebříčky
router.get('/leaderboard', async (req, res) => {
    try {
        const leaderboards = await bountyService.getLeaderboards();
        
        res.json({
            success: true,
            leaderboards: leaderboards
        });
        
    } catch (error) {
        console.error('API Error - leaderboard:', error);
        res.status(500).json({
            success: false,
            error: 'Chyba serveru'
        });
    }
});

// === BOUNTY MANAGEMENT ===

// GET /api/bounty/active - seznam aktivních bounty
router.get('/active', async (req, res) => {
    try {
        const bounties = await bountyService.getActiveBounties();
        
        res.json({
            success: true,
            bounties: bounties
        });
        
    } catch (error) {
        console.error('API Error - active bounties:', error);
        res.status(500).json({
            success: false,
            error: 'Chyba serveru'
        });
    }
});

// GET /api/bounty/locations - bounty pozice pro mapu
router.get('/locations', async (req, res) => {
    try {
        // Získat aktuální data hráčů z hlavní aplikace
        const playersData = req.app.get('playersData') || [];
        
        const bountyLocations = await bountyService.getBountyLocations(playersData);
        
        res.json({
            success: true,
            bountyLocations: bountyLocations
        });
        
    } catch (error) {
        console.error('API Error - bounty locations:', error);
        res.status(500).json({
            success: false,
            error: 'Chyba serveru'
        });
    }
});

// POST /api/bounty/create - vytvoření manuálního bounty
router.post('/create', requireAuth, async (req, res) => {
    try {
        const { targetSteamId, targetName, amount } = req.body;
        
        if (!targetSteamId || !targetName || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Chybí povinné parametry'
            });
        }
        
        if (typeof amount !== 'number' || amount < 100) {
            return res.status(400).json({
                success: false,
                error: 'Minimální bounty je 100 bodů'
            });
        }
        
        await bountyService.createManualBounty(
            req.user.id,
            req.user.displayName || req.user.name,
            targetSteamId,
            targetName,
            amount
        );
        
        res.json({
            success: true,
            message: `Bounty ${amount} bodů na ${targetName} bylo vyhlášeno`
        });
        
    } catch (error) {
        console.error('API Error - create bounty:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// DELETE /api/bounty/:bountyId - zrušení bounty
router.delete('/:bountyId', requireAuth, async (req, res) => {
    try {
        const { bountyId } = req.params;
        
        if (!bountyId || isNaN(bountyId)) {
            return res.status(400).json({
                success: false,
                error: 'Neplatné ID bounty'
            });
        }
        
        await bountyService.cancelBounty(parseInt(bountyId), req.user.id);
        
        res.json({
            success: true,
            message: 'Bounty bylo zrušeno'
        });
        
    } catch (error) {
        console.error('API Error - cancel bounty:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/bounty/my - moje bounty (vyhlášené a na mě)
router.get('/my', requireAuth, async (req, res) => {
    try {
        const bounties = await bountyService.getActiveBounties();
        
        const myBounties = {
            placed: bounties.filter(b => b.placed_by_steam_id === req.user.id),
            targeting: bounties.filter(b => b.target_steam_id === req.user.id)
        };
        
        res.json({
            success: true,
            bounties: myBounties
        });
        
    } catch (error) {
        console.error('API Error - my bounties:', error);
        res.status(500).json({
            success: false,
            error: 'Chyba serveru'
        });
    }
});

// === ADMIN FUNKCE ===

// POST /api/bounty/admin/points - přidání/odebrání bodů (admin only)
router.post('/admin/points', requireAuth, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Pouze pro administrátory'
            });
        }
        
        const { steamId, amount, reason } = req.body;
        
        if (!steamId || !amount || !reason) {
            return res.status(400).json({
                success: false,
                error: 'Chybí povinné parametry'
            });
        }
        
        // Implementace admin funkcí...
        // TODO: Přidat admin funkce pro správu ekonomiky
        
        res.json({
            success: true,
            message: 'Body upraveny'
        });
        
    } catch (error) {
        console.error('API Error - admin points:', error);
        res.status(500).json({
            success: false,
            error: 'Chyba serveru'
        });
    }
});

// GET /api/bounty/admin/stats - admin statistiky
router.get('/admin/stats', requireAuth, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Pouze pro administrátory'
            });
        }
        
        // TODO: Implementovat admin statistiky
        // - Celkové body v ekonomice
        // - Počet aktivních bounty
        // - Top transakce
        // - atd.
        
        res.json({
            success: true,
            stats: {
                // placeholder data
                totalPointsInEconomy: 0,
                activeBounties: 0,
                totalTransactions: 0
            }
        });
        
    } catch (error) {
        console.error('API Error - admin stats:', error);
        res.status(500).json({
            success: false,
            error: 'Chyba serveru'
        });
    }
});

// === UTILITY FUNKCE ===

// POST /api/bounty/clean - vyčistění vypršených bounty (automatické)
router.post('/clean', async (req, res) => {
    try {
        await bountyService.cleanExpiredBounties();
        
        res.json({
            success: true,
            message: 'Vypršená bounty vyčištěna'
        });
        
    } catch (error) {
        console.error('API Error - clean bounties:', error);
        res.status(500).json({
            success: false,
            error: 'Chyba serveru'
        });
    }
});

module.exports = router;