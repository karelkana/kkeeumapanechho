// friends-manager.js - Správa přátel s rozšířeným API podporou a lepším error handlingem

class FriendsManager {
    constructor() {
        this.friends = [];
        this.incomingRequests = [];
        this.outgoingRequests = [];
        this.searchResults = [];
        this.isLoading = false;
        this.lastError = null;
        
        // DOM elementy
        this.friendsPanel = document.getElementById('friends-panel');
        this.friendsList = document.getElementById('friends-list');
        this.noFriendsMessage = document.getElementById('no-friends-message');
        this.addFriendBtn = document.getElementById('add-friend-btn');
        this.friendDialog = document.getElementById('friend-dialog');
        this.friendDialogOverlay = document.getElementById('friend-dialog-overlay');
        this.playerListDialog = document.getElementById('player-list-dialog');
        this.friendRequestsBadge = document.getElementById('friend-requests-badge');
        
        this.init();
    }
    
    async init() {
        console.log('🚀 Inicializace FriendsManager');
        this.setupEventListeners();
        
        // Počkat na uživatelské přihlášení a pak načíst data
        await this.waitForUser();
        await this.loadFriendsFromAPI();
        this.updateFriendsList();
        this.startPeriodicUpdates();
    }
    
    async waitForUser() {
        // Počkat až se uživatel přihlásí (max 10 sekund)
        for (let i = 0; i < 20; i++) {
            if (window.user && window.user.id) {
                console.log('✅ Uživatel detekován:', window.user.displayName);
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        console.log('⚠️ Timeout při čekání na uživatelské přihlášení');
    }
    
    setupEventListeners() {
        if (this.addFriendBtn) {
            this.addFriendBtn.addEventListener('click', () => {
                this.showAddFriendDialog();
            });
        }
        
        const cancelBtn = document.getElementById('friend-dialog-cancel');
        const addBtn = document.getElementById('friend-dialog-add');
        const searchInput = document.getElementById('friend-search-input');
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.hideAddFriendDialog();
            });
        }
        
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this.addSelectedFriends();
            });
        }
        
        if (this.friendDialogOverlay) {
            this.friendDialogOverlay.addEventListener('click', () => {
                this.hideAddFriendDialog();
            });
        }
        
        // Vyhledávání uživatelů
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                const query = e.target.value.trim();
                
                if (query.length >= 2) {
                    searchTimeout = setTimeout(() => {
                        this.searchUsers(query);
                    }, 300);
                } else {
                    this.clearSearchResults();
                }
            });
        }
    }
    
    // Načtení přátel z API s lepším error handlingem
    async loadFriendsFromAPI() {
        if (!window.user || !window.user.id) {
            console.log('⏭️ Uživatel není přihlášen, přeskakuji načtení přátel');
            this.hideFriendsPanel();
            return;
        }
        
        try {
            this.isLoading = true;
            this.lastError = null;
            
            console.log('📡 Načítám přátele z API...');
            
            const response = await fetch('/api/friends/friends', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    console.warn('🚫 Neautorizováno - možná vypršela session');
                    this.showLoginRequired();
                    return;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.friends = data.friends || [];
                this.incomingRequests = data.incomingRequests || [];
                this.outgoingRequests = data.outgoingRequests || [];
                
                console.log(`✅ Načteno z API:`, {
                    friends: this.friends.length,
                    incoming: this.incomingRequests.length,
                    outgoing: this.outgoingRequests.length
                });
                
                this.showFriendsPanel();
                this.updateFriendRequestsBadge();
                
                // Zobrazit notifikaci o čekajících žádostech
                if (this.incomingRequests.length > 0) {
                    this.showPendingRequestsNotification();
                }
                
            } else {
                throw new Error(data.error || 'Neznámá chyba API');
            }
            
        } catch (error) {
            console.error('❌ Chyba při načítání přátel z API:', error);
            this.lastError = error.message;
            
            // Fallback na localStorage
            this.fallbackToLocalStorage();
            this.showError('Chyba při načítání přátel: ' + error.message);
            
        } finally {
            this.isLoading = false;
        }
    }
    
    // Fallback na localStorage pokud API selže
    fallbackToLocalStorage() {
        try {
            const stored = localStorage.getItem('jursky_masakr_friends');
            this.friends = stored ? JSON.parse(stored) : [];
            this.incomingRequests = [];
            this.outgoingRequests = [];
            console.log('📋 Používám localStorage fallback');
            this.showWarning('Offline režim - některé funkce nebudou dostupné');
        } catch (error) {
            console.error('❌ Chyba při načítání z localStorage:', error);
            this.friends = [];
            this.incomingRequests = [];
            this.outgoingRequests = [];
        }
    }
    
    // Vyhledání uživatelů
    async searchUsers(query) {
        if (!window.user || !window.user.id) {
            console.log('⏭️ Není přihlášen, nemůžu vyhledávat');
            return;
        }
        
        try {
            console.log(`🔍 Vyhledávám uživatele: "${query}"`);
            
            const response = await fetch(`/api/friends/search?q=${encodeURIComponent(query)}&limit=10`, {
                method: 'GET',
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.searchResults = data.users || [];
                console.log(`📤 Nalezeno ${this.searchResults.length} uživatelů`);
                this.updateSearchResults();
            } else {
                throw new Error(data.error || 'Chyba při vyhledávání');
            }
            
        } catch (error) {
            console.error('❌ Chyba při vyhledávání uživatelů:', error);
            this.searchResults = [];
            this.updateSearchResults();
            this.showError('Chyba při vyhledávání: ' + error.message);
        }
    }
    
    clearSearchResults() {
        this.searchResults = [];
        this.updateSearchResults();
    }
    
    updateSearchResults() {
        if (!this.playerListDialog) return;
        
        let html = '';
        
        if (this.searchResults.length === 0) {
            html = '<div class="search-message">Zadejte alespoň 2 znaky pro vyhledání...</div>';
        } else {
            this.searchResults.forEach(user => {
                const lastSeenText = this.formatLastSeen(user.lastLogin, user.lastSeenOnline);
                
                html += `
                    <label class="user-search-result" data-steam-id="${user.steamId}">
                        <input type="checkbox" value="${user.steamId}" data-name="${user.displayName}">
                        <div class="user-info">
                            ${user.avatarUrl ? `<img src="${user.avatarUrl}" alt="Avatar" class="user-avatar">` : ''}
                            <div class="user-details">
                                <div class="user-name">${user.displayName}</div>
                                <div class="user-last-seen">${lastSeenText}</div>
                            </div>
                        </div>
                    </label>
                `;
            });
        }
        
        this.playerListDialog.innerHTML = html;
    }
    
    formatLastSeen(lastLogin, lastSeenOnline) {
        const lastActivity = lastSeenOnline || lastLogin;
        if (!lastActivity) return 'Neznámé';
        
        const date = new Date(lastActivity);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return 'Dnes';
        if (diffDays === 1) return 'Včera';
        if (diffDays < 7) return `Před ${diffDays} dny`;
        if (diffDays < 30) return `Před ${Math.floor(diffDays / 7)} týdny`;
        return `Před ${Math.floor(diffDays / 30)} měsíci`;
    }
    
    // Žádost o přátelství přes API
    async addFriend(steamId, name, shareLocation = true, shareStats = false) {
        if (!steamId || !name) {
            this.showError('Neplatné parametry pro přidání přítele');
            return false;
        }
        
        if (!window.user || !window.user.id) {
            this.showError('Musíte být přihlášeni pro přidání přátel');
            return false;
        }
        
        if (steamId === window.user.id) {
            this.showError('Nemůžete přidat sebe jako přítele');
            return false;
        }
        
        // Kontrola, zda už není přítelem
        if (this.isFriend(steamId)) {
            this.showInfo(`${name} je již v seznamu přátel`);
            return false;
        }
        
        try {
            console.log(`📤 Odesílám žádost o přátelství: ${name} (${steamId})`);
            
            const response = await fetch('/api/friends/request', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    friendId: steamId,
                    shareLocation: shareLocation,
                    shareStats: shareStats
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showSuccess(`✅ ${data.message}`);
                await this.loadFriendsFromAPI(); // Refresh dat
                this.updateFriendsList();
                return true;
            } else {
                this.showError(data.error || 'Chyba při odesílání žádosti');
                return false;
            }
        } catch (error) {
            console.error('❌ Chyba při odesílání žádosti o přátelství:', error);
            
            // Fallback na localStorage
            const friend = {
                steamId: steamId,
                name: name,
                addedAt: new Date().toISOString()
            };
            
            this.friends.push(friend);
            this.saveFriendsToStorage();
            this.updateFriendsList();
            
            this.showInfo(`${name} přidán (offline režim)`);
            return true;
        }
    }
    
    // Přijetí žádosti o přátelství
    async acceptFriendRequest(requestId, shareLocation = true, shareStats = false) {
        try {
            console.log(`✅ Přijímám žádost o přátelství: ${requestId}`);
            
            const response = await fetch('/api/friends/accept', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    requestId: requestId,
                    shareLocation: shareLocation,
                    shareStats: shareStats
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showSuccess(`✅ ${data.message}`);
                await this.loadFriendsFromAPI();
                this.updateFriendsList();
                return true;
            } else {
                this.showError(data.error || 'Chyba při přijímání žádosti');
                return false;
            }
        } catch (error) {
            console.error('❌ Chyba při přijímání žádosti:', error);
            this.showError('Chyba při přijímání žádosti: ' + error.message);
            return false;
        }
    }
    
    // Odmítnutí žádosti
    async rejectFriendRequest(requestId) {
        try {
            console.log(`❌ Odmítám žádost o přátelství: ${requestId}`);
            
            const response = await fetch('/api/friends/reject', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    requestId: requestId
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showInfo(`ℹ️ ${data.message}`);
                await this.loadFriendsFromAPI();
                this.updateFriendsList();
                return true;
            } else {
                this.showError(data.error || 'Chyba při odmítání žádosti');
                return false;
            }
        } catch (error) {
            console.error('❌ Chyba při odmítání žádosti:', error);
            this.showError('Chyba při odmítání žádosti: ' + error.message);
            return false;
        }
    }
    
    // Odstranění přítele přes API
    async removeFriend(steamId) {
        const friend = this.getFriend(steamId);
        if (!friend) return false;
        
        const friendName = friend.friend_name || friend.name || 'neznámý';
        
        if (!confirm(`Opravdu chcete odebrat ${friendName} ze seznamu přátel?`)) {
            return false;
        }
        
        try {
            console.log(`🗑️ Odebírám přítele: ${friendName} (${steamId})`);
            
            const response = await fetch(`/api/friends/${steamId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showInfo(`🗑️ ${data.message}`);
                await this.loadFriendsFromAPI();
                this.updateFriendsList();
                
                // Aktualizovat seznam hráčů a markery
                if (typeof updatePlayersList === 'function') {
                    updatePlayersList();
                }
                if (typeof filterMarkers === 'function') {
                    filterMarkers();
                }
                
                return true;
            } else {
                this.showError(data.error || 'Chyba při odebírání přítele');
                return false;
            }
        } catch (error) {
            console.error('❌ Chyba při odebírání přítele:', error);
            
            // Fallback na localStorage
            const index = this.friends.findIndex(f => (f.friend_steam_id || f.steamId) === steamId);
            if (index > -1) {
                this.friends.splice(index, 1);
                this.saveFriendsToStorage();
                this.updateFriendsList();
                this.showInfo(`Přítel odebrán (offline režim)`);
                return true;
            }
            return false;
        }
    }
    
    saveFriendsToStorage() {
        try {
            localStorage.setItem('jursky_masakr_friends', JSON.stringify(this.friends));
        } catch (error) {
            console.error('❌ Chyba při ukládání přátel do localStorage:', error);
        }
    }
    
    isFriend(steamId) {
        return this.friends.some(f => (f.friend_steam_id || f.steamId) === steamId);
    }
    
    getFriend(steamId) {
        return this.friends.find(f => (f.friend_steam_id || f.steamId) === steamId);
    }
    
    // Zobrazuje i friend requests s rozšířenými informacemi
    updateFriendsList() {
        if (!this.friendsList) return;
        
        if (!window.user || !window.user.id) {
            this.hideFriendsPanel();
            return;
        } else {
            this.showFriendsPanel();
        }
        
        let contentHTML = '';
        
        // Příchozí žádosti o přátelství
        if (this.incomingRequests.length > 0) {
            contentHTML += `
                <div class="friend-requests-section incoming-requests">
                    <h4 style="margin: 0 0 10px 0; color: #ffc107; font-size: 14px;">
                        <i class="fa-solid fa-user-clock"></i> Příchozí žádosti (${this.incomingRequests.length})
                    </h4>
            `;
            
            this.incomingRequests.forEach(request => {
                const requesterName = request.requester_name || `Hráč ${request.requester_steam_id}`;
                const timeAgo = this.formatTimeAgo(request.created_at);
                
                contentHTML += `
                    <div class="friend-request-item incoming-request">
                        <div class="request-header">
                            ${request.requester_avatar_url ? `<img src="${request.requester_avatar_url}" alt="Avatar" class="request-avatar">` : ''}
                            <div class="request-info">
                                <div class="request-name">${requesterName}</div>
                                <div class="request-time">${timeAgo}</div>
                            </div>
                        </div>
                        <div class="friend-request-buttons">
                            <button onclick="window.friendsManager.acceptFriendRequest(${request.id})" 
                                    class="friend-request-btn accept">
                                <i class="fa-solid fa-check"></i> Přijmout
                            </button>
                            <button onclick="window.friendsManager.rejectFriendRequest(${request.id})" 
                                    class="friend-request-btn reject">
                                <i class="fa-solid fa-times"></i> Odmítnout
                            </button>
                        </div>
                    </div>
                `;
            });
            
            contentHTML += `</div>`;
        }
        
        // Odchozí žádosti o přátelství
        if (this.outgoingRequests.length > 0) {
            contentHTML += `
                <div class="friend-requests-section outgoing-requests">
                    <h4 style="margin: 0 0 10px 0; color: #2196F3; font-size: 14px;">
                        <i class="fa-solid fa-paper-plane"></i> Odeslané žádosti (${this.outgoingRequests.length})
                    </h4>
            `;
            
            this.outgoingRequests.forEach(request => {
                const friendName = request.friend_name || `Hráč ${request.friend_id}`;
                const timeAgo = this.formatTimeAgo(request.created_at);
                
                contentHTML += `
                    <div class="friend-request-item outgoing-request">
                        <div class="request-header">
                            ${request.friend_avatar_url ? `<img src="${request.friend_avatar_url}" alt="Avatar" class="request-avatar">` : ''}
                            <div class="request-info">
                                <div class="request-name">${friendName}</div>
                                <div class="request-time">${timeAgo}</div>
                                <div class="request-status">Čeká na odpověď</div>
                            </div>
                        </div>
                        <div class="friend-request-buttons">
                            <button onclick="window.friendsManager.cancelFriendRequest('${request.friend_id}')" 
                                    class="friend-request-btn cancel">
                                <i class="fa-solid fa-times"></i> Zrušit
                            </button>
                        </div>
                    </div>
                `;
            });
            
            contentHTML += `</div>`;
        }
        
        // Současní přátelé
        if (this.friends.length === 0) {
            if (this.incomingRequests.length === 0 && this.outgoingRequests.length === 0) {
                contentHTML += '<div style="text-align: center; color: #aaa; padding: 20px;">Zatím nemáte žádné přátele ani žádosti</div>';
            }
        } else {
            contentHTML += `
                <div class="friends-section">
                    <h4 style="margin: 15px 0 10px 0; color: #4CAF50; font-size: 14px;">
                        <i class="fa-solid fa-users"></i> Přátelé (${this.friends.length})
                    </h4>
            `;
            
            const players = this.getCurrentPlayersData();
            
            this.friends.forEach(friend => {
                const friendSteamId = friend.friend_steam_id || friend.steamId;
                const friendName = friend.friend_name || friend.name || friendSteamId;
                
                const isOnline = players && players.some(p => p.steamId === friendSteamId);
                const onlinePlayer = isOnline ? players.find(p => p.steamId === friendSteamId) : null;
                
                const lastSeen = this.formatLastSeen(friend.friend_last_login, friend.friend_last_seen_online);
                
                contentHTML += `
                    <div class="friend-item" data-steam-id="${friendSteamId}">
                        <div class="friend-header">
                            ${friend.friend_avatar_url ? `<img src="${friend.friend_avatar_url}" alt="Avatar" class="friend-avatar">` : ''}
                            <div class="friend-info">
                                <div class="friend-name">
                                    <span class="friend-online ${isOnline ? 'online' : 'offline'}"></span>
                                    ${friendName}
                                </div>
                                <div class="friend-details">
                                    ${isOnline && onlinePlayer ? 
                                        `<span style="color: #4CAF50;"><i class="fa-solid fa-gamepad"></i> ${onlinePlayer.dino}</span>` : 
                                        `<span style="color: #666;"><i class="fa-solid fa-clock"></i> ${lastSeen}</span>`
                                    }
                                </div>
                            </div>
                            <div class="friend-actions">
                                <button class="friend-action-btn" onclick="window.friendsManager.centerOnFriend('${friendSteamId}')" 
                                        title="Najít na mapě" ${!isOnline ? 'disabled' : ''}>
                                    <i class="fa-solid fa-crosshairs"></i>
                                </button>
                                <button class="friend-action-btn remove" onclick="window.friendsManager.removeFriend('${friendSteamId}')" 
                                        title="Odebrat přítele">
                                    <i class="fa-solid fa-times"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            contentHTML += `</div>`;
        }
        
        this.friendsList.innerHTML = contentHTML;
        this.updateFriendRequestsBadge();
    }
    
    formatTimeAgo(timestamp) {
        if (!timestamp) return 'neznámo';
        
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffMinutes < 1) return 'právě teď';
        if (diffMinutes < 60) return `před ${diffMinutes} min`;
        if (diffHours < 24) return `před ${diffHours} h`;
        if (diffDays < 7) return `před ${diffDays} dny`;
        return date.toLocaleDateString('cs-CZ');
    }
    
    // Zrušení vlastní žádosti
    async cancelFriendRequest(friendId) {
        try {
            console.log(`🗑️ Ruším žádost o přátelství: ${friendId}`);
            
            const response = await fetch('/api/friends/cancel', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    friendId: friendId
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showInfo(`🗑️ ${data.message}`);
                await this.loadFriendsFromAPI();
                this.updateFriendsList();
                return true;
            } else {
                this.showError(data.error || 'Chyba při rušení žádosti');
                return false;
            }
        } catch (error) {
            console.error('❌ Chyba při rušení žádosti:', error);
            this.showError('Chyba při rušení žádosti: ' + error.message);
            return false;
        }
    }
    
    // OPRAVENO - získání aktuálních dat hráčů z různých zdrojů
    getCurrentPlayersData() {
        const sources = [
            window.players,
            window.playersData, 
            typeof playersData !== 'undefined' ? playersData : null,
            window.app?.players,
            document.getElementById('players-container')?.playersData
        ];
        
        for (const source of sources) {
            if (source && Array.isArray(source) && source.length > 0) {
                return source;
            }
        }
        
        return [];
    }
    
    // Notifikace o čekajících žádostech
    showPendingRequestsNotification() {
        if (this.incomingRequests.length > 0) {
            this.showInfo(`📬 Máte ${this.incomingRequests.length} čekajících žádostí o přátelství`);
        }
    }
    
    // Aktualizace badge pro friend requests
    updateFriendRequestsBadge() {
        if (!this.friendRequestsBadge) return;
        
        const requestCount = this.incomingRequests.length;
        
        if (requestCount > 0) {
            this.friendRequestsBadge.textContent = requestCount;
            this.friendRequestsBadge.style.display = 'inline';
        } else {
            this.friendRequestsBadge.style.display = 'none';
        }
    }
    
    centerOnFriend(steamId) {
        const players = this.getCurrentPlayersData();
        
        if (!players || !window.centerOnPlayer) {
            console.warn('⚠️ Nemohu najít funkci centerOnPlayer nebo data hráčů');
            return;
        }
        
        const player = players.find(p => p.steamId === steamId);
        if (!player || !player.x || !player.y) {
            const friend = this.getFriend(steamId);
            const friendName = friend ? (friend.friend_name || friend.friend_steam_id) : 'Přítel';
            this.showInfo(`${friendName} není momentálně online`);
            return;
        }
        
        console.log(`🎯 Centrování na přítele: ${player.name}`);
        window.centerOnPlayer(player);
        
        if (typeof highlightMarker === 'function') {
            highlightMarker(player);
            setTimeout(() => {
                if (typeof unhighlightMarker === 'function') {
                    unhighlightMarker(player);
                }
            }, 3000);
        }
    }
    
    showAddFriendDialog() {
        if (!window.user || !window.user.id) {
            this.showLoginRequired();
            return;
        }
        
        console.log('🔍 Otevírám dialog pro přidání přátel');
        
        if (this.friendDialog && this.friendDialogOverlay) {
            this.friendDialog.style.display = 'block';
            this.friendDialogOverlay.style.display = 'block';
            
            // Focus na vyhledávací pole
            const searchInput = document.getElementById('friend-search-input');
            if (searchInput) {
                searchInput.focus();
                searchInput.value = '';
            }
            
            this.clearSearchResults();
        }
    }
    
    hideAddFriendDialog() {
        if (this.friendDialog && this.friendDialogOverlay) {
            this.friendDialog.style.display = 'none';
            this.friendDialogOverlay.style.display = 'none';
        }
        
        // Vyčistit formulář
        const searchInput = document.getElementById('friend-search-input');
        if (searchInput) {
            searchInput.value = '';
        }
        
        this.clearSearchResults();
        
        if (this.playerListDialog) {
            this.playerListDialog.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
        }
    }
    
    async addSelectedFriends() {
        if (!this.playerListDialog) return;
        
        const checkboxes = this.playerListDialog.querySelectorAll('input[type="checkbox"]:checked');
        let addedCount = 0;
        
        const shareLocationCheckbox = document.getElementById('share-location');
        const shareStatsCheckbox = document.getElementById('share-stats');
        
        const shareLocation = shareLocationCheckbox ? shareLocationCheckbox.checked : true;
        const shareStats = shareStatsCheckbox ? shareStatsCheckbox.checked : false;
        
        for (const checkbox of checkboxes) {
            const steamId = checkbox.value;
            const name = checkbox.getAttribute('data-name');
            
            if (await this.addFriend(steamId, name, shareLocation, shareStats)) {
                addedCount++;
            }
        }
        
        if (addedCount > 0) {
            this.showSuccess(`📤 Odesláno ${addedCount} žádostí o přátelství`);
            
            // Aktualizovat seznam hráčů a markery
            if (typeof updatePlayersList === 'function') {
                updatePlayersList();
            }
            if (typeof filterMarkers === 'function') {
                filterMarkers();
            }
        }
        
        this.hideAddFriendDialog();
    }
    
    // UI pomocné funkce
    showFriendsPanel() {
        if (this.friendsPanel) {
            this.friendsPanel.style.display = 'block';
        }
    }
    
    hideFriendsPanel() {
        if (this.friendsPanel) {
            this.friendsPanel.style.display = 'none';
        }
    }
    
    showLoginRequired() {
        this.showWarning('Musíte být přihlášeni pro správu přátel. <a href="/auth/steam">Přihlásit se</a>');
    }
    
    // Toast notifikace
    showSuccess(message) {
        this.showToast(message, 'success');
    }
    
    showError(message) {
        this.showToast(message, 'error');
    }
    
    showWarning(message) {
        this.showToast(message, 'warning');
    }
    
    showInfo(message) {
        this.showToast(message, 'info');
    }
    
    showToast(message, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(message, type);
        } else {
            console.log(`${type.toUpperCase()}: ${message}`);
            
            // Fallback alert pro kritické chyby
            if (type === 'error') {
                alert(message);
            }
        }
    }
    
    // Metody pro kompatibilitu s původním kódem
    updateFriendsDisplay() {
        this.updateFriendsList();
    }
    
    async loadPendingRequests() {
        // Data jsou už načtena v loadFriendsFromAPI()
        return this.incomingRequests;
    }
    
    // Metoda pro export seznamu přátel
    exportFriends() {
        const data = {
            friends: this.friends,
            incomingRequests: this.incomingRequests,
            outgoingRequests: this.outgoingRequests,
            exportedAt: new Date().toISOString(),
            version: '3.0',
            user: {
                id: window.user ? window.user.id : null,
                displayName: window.user ? window.user.displayName : null
            }
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `jursky_masakr_friends_${window.user ? window.user.id : 'export'}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showSuccess('💾 Seznam přátel exportován');
    }
    
    // Metoda pro import seznamu přátel
    importFriends(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.friends && Array.isArray(data.friends)) {
                    // Pro import používáme localStorage fallback
                    this.friends = [...this.friends, ...data.friends];
                    this.saveFriendsToStorage();
                    this.updateFriendsList();
                    
                    this.showSuccess(`📥 Importováno ${data.friends.length} přátel (offline režim)`);
                } else {
                    this.showError('❌ Neplatný formát souboru');
                }
            } catch (error) {
                console.error('❌ Chyba při importu přátel:', error);
                this.showError('❌ Chyba při importu souboru');
            }
        };
        reader.readAsText(file);
    }
    
    // Periodická aktualizace friend requests
    startPeriodicUpdates() {
        if (!window.user || !window.user.id) return;
        
        // Aktualizace každé 2 minuty
        setInterval(async () => {
            try {
                if (!this.isLoading && window.user && window.user.id) {
                    const oldIncomingCount = this.incomingRequests.length;
                    await this.loadFriendsFromAPI();
                    
                    // Pokud přibyly nové žádosti, zobrazit notifikaci
                    if (this.incomingRequests.length > oldIncomingCount) {
                        this.showPendingRequestsNotification();
                    }
                    
                    this.updateFriendRequestsBadge();
                }
            } catch (error) {
                console.error('⚠️ Chyba při periodické aktualizaci přátel:', error);
            }
        }, 120000); // 2 minuty
        
        console.log('🔄 Spuštěna periodická aktualizace friend requests (každé 2 minuty)');
    }
    
    // Debug metody
    getDebugInfo() {
        return {
            user: window.user ? {
                id: window.user.id,
                displayName: window.user.displayName,
                isAdmin: window.user.isAdmin
            } : null,
            friendsCount: this.friends.length,
            incomingRequestsCount: this.incomingRequests.length,
            outgoingRequestsCount: this.outgoingRequests.length,
            isLoading: this.isLoading,
            lastError: this.lastError,
            searchResultsCount: this.searchResults.length,
            timestamp: new Date().toISOString()
        };
    }
    
    async debugAPI() {
        if (!window.user || !window.user.id) {
            console.log('❌ Nelze debugovat - uživatel není přihlášen');
            return;
        }
        
        try {
            const response = await fetch('/api/friends/debug', {
                method: 'GET',
                credentials: 'include'
            });
            
            const data = await response.json();
            console.log('🔍 Friends API Debug:', data);
            return data;
        } catch (error) {
            console.error('❌ Chyba při debug API:', error);
            return null;
        }
    }
}

// Export pro použití v jiných souborech
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FriendsManager;
}

// Globální přístup pro debug a kompatibilitu
window.FriendsManager = FriendsManager;