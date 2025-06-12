// player-manager.js - Správa hráčů a markerů

class PlayerManager {
    constructor(markersContainer, tooltip, mapController, calibration) {
        this.markersContainer = markersContainer;
        this.tooltip = tooltip;
        this.mapController = mapController;
        this.calibration = calibration;
        this.markers = new Map(); // Map pro rychlejší přístup k markerům
        
        // DOM elementy
        this.playersContainer = document.getElementById('players-container');
        this.playerCount = document.getElementById('player-count');
        this.noPlayersMessage = document.getElementById('no-players-message');
        this.searchPlayer = document.getElementById('search-player');
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Vyhledávání hráčů
        if (this.searchPlayer) {
            this.searchPlayer.addEventListener('input', () => {
                this.filterPlayers();
            });
        }
        
        // Filtry dinosaurů
        document.querySelectorAll('.dino-filter').forEach(filter => {
            filter.addEventListener('change', () => {
                this.filterMarkers();
            });
        });
    }
    
    // Aktualizace seznamu hráčů v UI
    updatePlayerList(players) {
        window.players = players || [];
        
        if (!window.players || window.players.length === 0) {
            this.showNoPlayersMessage();
            return;
        }
        
        this.hideNoPlayersMessage();
        this.playerCount.textContent = `(${window.players.length})`;
        
        let playerListHTML = '';
        
        // Seřadit hráče abecedně
        window.players.sort((a, b) => a.name.localeCompare(b.name));
        
        window.players.forEach(player => {
            // Určení barvy podle typu dinosaura
            let dinoColor = '#2196F3'; // other
            if (player.dinoType === 'carnivore') {
                dinoColor = '#f44336';
            } else if (player.dinoType === 'herbivore') {
                dinoColor = '#4CAF50';
            }
            
            // Určení, zda je to vlastní hráč
            const isSelfPlayer = window.user && player.steamId === window.user.id;
            
            // Určení, zda je to přítel
            const isFriend = window.user && player.steamId && 
                         window.friendsManager && window.friendsManager.isFriend(player.steamId);
            
            // Sestavení tříd pro položku hráče
            const classes = ['player-item'];
            if (isSelfPlayer) classes.push('player-self');
            if (isFriend) classes.push('player-friend');
            
            playerListHTML += `
                <div class="${classes.join(' ')}" data-player-id="${player.id}" data-steam-id="${player.steamId}">
                    <div class="player-name">
                        ${player.name} 
                        ${isSelfPlayer ? '(Vy)' : ''}
                        ${isFriend ? '<i class="friend-icon fa-solid fa-heart"></i>' : ''}
                    </div>
                    <div class="player-details">
                        <span style="color: ${dinoColor}"><i class="fa-solid fa-paw"></i> ${player.dino}</span>
                        ${player.growth && (isSelfPlayer || isFriend) ? `<span><i class="fa-solid fa-seedling"></i> ${Math.round(player.growth * 100)}%</span>` : ''}
                        ${(window.user && (isSelfPlayer || window.user.isAdmin || isFriend) && player.x) ? `<span><i class="fa-solid fa-location-dot"></i> ${Math.round(player.x)}, ${Math.round(player.y)}</span>` : ''}
                    </div>
            `;
            
            // Přidat statistiky (zdraví, hlad, žízeň), pokud jsou dostupné a je to vlastní hráč nebo přítel
            if ((isSelfPlayer || isFriend) && (player.health !== undefined || player.hunger !== undefined || player.thirst !== undefined)) {
                playerListHTML += this.generatePlayerStats(player);
            }
            
            playerListHTML += `</div>`;
        });
        
        this.playersContainer.innerHTML = playerListHTML;
        this.attachPlayerListEvents();
        this.filterPlayers();
    }
    
    generatePlayerStats(player) {
        let statsHTML = '<div class="player-stats">';
        
        if (player.health !== undefined) {
            const healthPercent = Math.round(player.health * 100);
            statsHTML += `
                <div class="stat-bar health-bar">
                    <div class="stat-bar-fill" style="width: ${healthPercent}%"></div>
                </div>
                <div class="stat-label">
                    <span>Zdraví</span>
                    <span>${healthPercent}%</span>
                </div>
            `;
        }
        
        if (player.hunger !== undefined) {
            const hungerPercent = Math.round(player.hunger * 100);
            statsHTML += `
                <div class="stat-bar hunger-bar">
                    <div class="stat-bar-fill" style="width: ${hungerPercent}%"></div>
                </div>
                <div class="stat-label">
                    <span>Hlad</span>
                    <span>${hungerPercent}%</span>
                </div>
            `;
        }
        
        if (player.thirst !== undefined) {
            const thirstPercent = Math.round(player.thirst * 100);
            statsHTML += `
                <div class="stat-bar thirst-bar">
                    <div class="stat-bar-fill" style="width: ${thirstPercent}%"></div>
                </div>
                <div class="stat-label">
                    <span>Žízeň</span>
                    <span>${thirstPercent}%</span>
                </div>
            `;
        }
        
        statsHTML += '</div>';
        return statsHTML;
    }
    
    attachPlayerListEvents() {
        // Event listenery pro zvýraznění markeru
        document.querySelectorAll('.player-item').forEach(item => {
            item.addEventListener('mouseenter', () => {
                const playerId = item.getAttribute('data-player-id');
                this.highlightMarker(playerId);
            });
            
            item.addEventListener('mouseleave', () => {
                const playerId = item.getAttribute('data-player-id');
                this.unhighlightMarker(playerId);
            });
            
            item.addEventListener('click', (e) => {
                const playerId = item.getAttribute('data-player-id');
                this.centerOnPlayer(playerId);
            });
        });
    }
    
    // Aktualizace markerů na mapě
    updateMarkers(players) {
        this.clearMarkers();
        
        if (!players || players.length === 0) {
            return;
        }
        
        // Filtrovat hráče, kteří mají souřadnice
        const playersWithCoords = players.filter(player => 
            player.x !== undefined && player.y !== undefined
        );
        
        playersWithCoords.forEach(player => {
            // Pro nepřihlášeného uživatele nebudeme přidávat markery
            if (!window.user) {
                return;
            }
            
            // Pro běžného uživatele přidáme jen jeho vlastní marker a markery přátel
            if (!window.user.isAdmin && 
                player.steamId !== window.user.id && 
                !(window.friendsManager && window.friendsManager.isFriend(player.steamId))) {
                return;
            }
            
            this.addPlayerMarker(player);
        });
        
        this.filterMarkers();
    }
    
    // Přidání markeru hráče na mapu
    addPlayerMarker(player) {
        if (!player || !player.x || !player.y || !this.markersContainer) return;
        
        const marker = document.createElement('div');
        marker.classList.add('player-marker');
        marker.setAttribute('data-player-id', player.id);
        marker.setAttribute('data-steam-id', player.steamId || '');
        marker.setAttribute('data-dino-type', player.dinoType);
        
        // Přidání CSS třídy podle typu dinosaura
        marker.classList.add(`marker-${player.dinoType}`);
        
        // Pokud je to vlastní hráč, přidáme speciální vzhled
        if (window.user && player.steamId === window.user.id) {
            marker.classList.add('marker-self');
        }
        
        // Pokud je to přítel, přidáme speciální vzhled
        if (window.user && player.steamId && 
            window.friendsManager && window.friendsManager.isFriend(player.steamId)) {
            marker.classList.add('marker-friend');
        }
        
        // Pozice markeru
        this.positionMarker(marker, player.x, player.y);
        
        // Tooltip events
        marker.addEventListener('mouseenter', (e) => {
            this.showPlayerTooltip(player, e);
        });
        
        marker.addEventListener('mousemove', (e) => {
            this.positionTooltip(e);
        });
        
        marker.addEventListener('mouseleave', () => {
            this.hideTooltip();
        });
        
        // Click event pro centrování
        marker.addEventListener('click', () => {
            this.centerOnPlayer(player.id);
        });
        
        // Přidání markeru do kontejneru a mapy
        this.markersContainer.appendChild(marker);
        this.markers.set(player.id, marker);
    }
    
    // Pozicování markeru pomocí kalibrace
    positionMarker(marker, gameX, gameY) {
        if (!marker || gameX === undefined || gameY === undefined) {
            console.warn('Neplatné parametry pro positionMarker', { marker, gameX, gameY });
            return;
        }
        
        try {
            // Použít kalibrační systém pokud je dostupný
            if (this.calibration && typeof this.calibration.gameToMapCoords === 'function') {
                const mapCoords = this.calibration.gameToMapCoords(gameX, gameY);
                marker.style.left = `${mapCoords.x}%`;
                marker.style.top = `${mapCoords.y}%`;
            } else {
                // Fallback na základní mapování
                const percentX = this.gameCoordToMapPercent(gameX, 'x');
                const percentY = this.gameCoordToMapPercent(gameY, 'y');
                marker.style.left = `${percentX}%`;
                marker.style.top = `${percentY}%`;
            }
        } catch (error) {
            console.error('Chyba při pozicování markeru:', error);
        }
    }
    
    // Základní konverze souřadnic z původní konfigurace
    gameCoordToMapPercent(gameX, gameY) {
        // Použití původních kalibračních hodnot jako fallback
        const calibrationPoints = [
            [-280000, -400000, 20, 20],  // Levý horní roh
            [280000, 400000, 80, 80]     // Pravý dolní roh
        ];
        
        const [gameX1, gameY1, mapX1, mapY1] = calibrationPoints[0];
        const [gameX2, gameY2, mapX2, mapY2] = calibrationPoints[1];
        
        // Mapování souřadnic pomocí lineární interpolace
        const percentX = this.mapValue(gameX, gameX1, gameX2, mapX1, mapX2);
        const percentY = this.mapValue(gameY, gameY1, gameY2, mapY1, mapY2);
        
        return { x: Math.max(0, Math.min(100, percentX)), y: Math.max(0, Math.min(100, percentY)) };
    }
    
    // Pomocná funkce pro mapování hodnot z jednoho rozsahu do druhého
    mapValue(value, inMin, inMax, outMin, outMax) {
        return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
    }
    
    // Zobrazení tooltipu
    showPlayerTooltip(player, event) {
        if (!this.tooltip) return;
        
        const isSelfPlayer = window.user && player.steamId === window.user.id;
        const isFriend = window.user && player.steamId && 
                        window.friendsManager && window.friendsManager.isFriend(player.steamId);
        
        let tooltipHTML = `
            <div class="tooltip-title">
                ${player.name}
                ${isSelfPlayer ? '(Vy)' : ''}
                ${isFriend ? '<i class="friend-icon fa-solid fa-heart"></i>' : ''}
            </div>
            <div>Druh: ${player.dino}</div>
        `;
        
        if (player.growth && (isSelfPlayer || isFriend)) {
            tooltipHTML += `<div>Růst: ${Math.round(player.growth * 100)}%</div>`;
        }
        
        if (window.user && (isSelfPlayer || window.user.isAdmin || isFriend) && player.x) {
            tooltipHTML += `<div>Pozice: ${Math.round(player.x)}, ${Math.round(player.y)}</div>`;
        }
        
        // Přidat statistiky pokud jsou dostupné
        if ((isSelfPlayer || isFriend) && 
            (player.health !== undefined || player.hunger !== undefined || player.thirst !== undefined)) {
            tooltipHTML += '<div class="tooltip-stats visible">';
            
            if (player.health !== undefined) {
                const healthPercent = Math.round(player.health * 100);
                tooltipHTML += `
                    <div class="stat-bar health-bar">
                        <div class="stat-bar-fill" style="width: ${healthPercent}%"></div>
                    </div>
                    <div class="stat-label">
                        <span>Zdraví</span>
                        <span>${healthPercent}%</span>
                    </div>
                `;
            }
            
            if (player.hunger !== undefined) {
                const hungerPercent = Math.round(player.hunger * 100);
                tooltipHTML += `
                    <div class="stat-bar hunger-bar">
                        <div class="stat-bar-fill" style="width: ${hungerPercent}%"></div>
                    </div>
                    <div class="stat-label">
                        <span>Hlad</span>
                        <span>${hungerPercent}%</span>
                    </div>
                `;
            }
            
            if (player.thirst !== undefined) {
                const thirstPercent = Math.round(player.thirst * 100);
                tooltipHTML += `
                    <div class="stat-bar thirst-bar">
                        <div class="stat-bar-fill" style="width: ${thirstPercent}%"></div>
                    </div>
                    <div class="stat-label">
                        <span>Žízeň</span>
                        <span>${thirstPercent}%</span>
                    </div>
                `;
            }
            
            tooltipHTML += '</div>';
        }
        
        this.tooltip.innerHTML = tooltipHTML;
        this.tooltip.style.opacity = '1';
        this.positionTooltip(event);
    }
    
    // Pozicování tooltipu
    positionTooltip(event) {
        if (!this.tooltip) return;
        
        const rect = this.markersContainer.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        this.tooltip.style.left = `${x + 15}px`;
        this.tooltip.style.top = `${y - 10}px`;
        
        // Ujistit se, že tooltip nezůstane mimo obrazovku
        const tooltipRect = this.tooltip.getBoundingClientRect();
        const containerRect = this.markersContainer.getBoundingClientRect();
        
        if (tooltipRect.right > containerRect.right) {
            this.tooltip.style.left = `${x - tooltipRect.width - 15}px`;
        }
        
        if (tooltipRect.bottom > containerRect.bottom) {
            this.tooltip.style.top = `${y - tooltipRect.height + 10}px`;
        }
    }
    
    // Skrytí tooltipu
    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.opacity = '0';
        }
    }
    
    // Zvýraznění markeru
    highlightMarker(playerId) {
        const marker = this.markers.get(playerId);
        if (marker) {
            marker.style.transform = 'translate(-50%, -50%) scale(1.3)';
            marker.style.zIndex = '20';
            marker.style.boxShadow = '0 0 15px white';
        }
    }
    
    // Zrušení zvýraznění markeru
    unhighlightMarker(playerId) {
        const marker = this.markers.get(playerId);
        if (marker) {
            marker.style.transform = 'translate(-50%, -50%) scale(1)';
            marker.style.zIndex = '10';
            marker.style.boxShadow = '0 0 8px rgba(0, 0, 0, 0.5)';
        }
    }
    
    // Vycentrování mapy na hráče
    centerOnPlayer(playerId) {
        if (!window.players || !this.mapController) return;
        
        const player = window.players.find(p => p.id == playerId);
        if (!player || !player.x || !player.y) return;
        
        // Převést herní souřadnice na procenta
        let coords;
        
        if (this.calibration && typeof this.calibration.gameToMapCoords === 'function') {
            coords = this.calibration.gameToMapCoords(player.x, player.y);
        } else {
            coords = this.gameCoordToMapPercent(player.x, player.y);
        }
        
        const percentX = coords.x;
        const percentY = coords.y;
        
        // Vycentrovat na pozici hráče
        this.mapController.centerOnPosition(percentX, percentY, 2);
        
        // Zvýraznit marker na chvíli
        this.highlightMarker(playerId);
        setTimeout(() => this.unhighlightMarker(playerId), 2000);
    }
    
    // Vyčištění všech markerů
    clearMarkers() {
        if (this.markersContainer) {
            this.markersContainer.innerHTML = '';
        }
        this.markers.clear();
    }
    
    // Filtrování hráčů podle vyhledávání
    filterPlayers() {
        const searchTerm = this.searchPlayer ? this.searchPlayer.value.toLowerCase() : '';
        
        document.querySelectorAll('.player-item').forEach(item => {
            const playerName = item.querySelector('.player-name').textContent.toLowerCase();
            const dinoDetails = item.querySelector('.player-details span:first-child');
            const dinoName = dinoDetails ? dinoDetails.textContent.toLowerCase() : '';
            
            const isMatch = playerName.includes(searchTerm) || dinoName.includes(searchTerm);
            item.style.display = isMatch ? 'block' : 'none';
        });
    }
    
    // Filtrování markerů podle aktivních filtrů
    filterMarkers() {
        const activeFiltersElements = document.querySelectorAll('.dino-filter:checked');
        if (!activeFiltersElements || activeFiltersElements.length === 0) {
            return;
        }
        
        const activeFilters = Array.from(activeFiltersElements).map(checkbox => checkbox.value);
        
        this.markers.forEach((marker, playerId) => {
            const dinoType = marker.getAttribute('data-dino-type');
            const isVisible = activeFilters.includes(dinoType);
            marker.style.display = isVisible ? 'block' : 'none';
        });
    }
    
    // Zobrazení zprávy o žádných hráčích
    showNoPlayersMessage() {
        if (this.noPlayersMessage) {
            this.noPlayersMessage.style.display = 'block';
        }
        if (this.playerCount) {
            this.playerCount.textContent = '(0)';
        }
        if (this.playersContainer) {
            this.playersContainer.innerHTML = '';
        }
    }
    
    // Skrytí zprávy o žádných hráčích
    hideNoPlayersMessage() {
        if (this.noPlayersMessage) {
            this.noPlayersMessage.style.display = 'none';
        }
    }
}