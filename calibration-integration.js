/**
 * Integrace kalibračního systému s mapovým rozhraním
 * Tento soubor propojuje kalibrační systém s hlavní aplikací
 */

// Počkat na načtení DOMu a kalibračního systému
document.addEventListener('DOMContentLoaded', function() {
    // Počkat na inicializaci mapCalibration
    if (typeof window.mapCalibration === 'undefined') {
        console.log('Čekám na inicializaci kalibračního systému...');
        setTimeout(() => {
            initializeCalibrationIntegration();
        }, 100);
    } else {
        initializeCalibrationIntegration();
    }
});

function initializeCalibrationIntegration() {
    console.log('Inicializace integrace kalibračního systému...');
    
    // Přepsat původní funkci positionMarker pro použití kalibračního systému
    if (typeof window.positionMarker !== 'undefined') {
        const originalPositionMarker = window.positionMarker;
        
        window.positionMarker = function(marker, gameX, gameY) {
            if (!marker || gameX === undefined || gameY === undefined) {
                console.warn('Neplatné parametry pro positionMarker', { marker, gameX, gameY });
                return;
            }
            
            try {
                // Použít kalibrační systém pro převod souřadnic
                const mapCoords = window.mapCalibration.gameToMapCoordinates(gameX, gameY);
                
                // Nastavení pozice markeru
                marker.style.left = `${mapCoords.x}%`;
                marker.style.top = `${mapCoords.y}%`;
                
                // Debug informace
                console.debug(`Game(${gameX}, ${gameY}) -> Map(${mapCoords.x.toFixed(2)}%, ${mapCoords.y.toFixed(2)}%)`);
            } catch (error) {
                console.error('Chyba při pozicování markeru pomocí kalibrace:', error);
                // Fallback na původní funkci
                if (originalPositionMarker) {
                    originalPositionMarker(marker, gameX, gameY);
                }
            }
        };
        
        console.log('Funkce positionMarker integrována s kalibračním systémem');
    }
    
    // Přidat UI pro správu kalibrace (pouze pro adminy)
    if (window.user && window.user.isAdmin) {
        addCalibrationUI();
    }
    
    // Event listener pro změny v přihlášení
    document.addEventListener('userLoginChanged', function(event) {
        if (event.detail.user && event.detail.user.isAdmin) {
            addCalibrationUI();
        } else {
            removeCalibrationUI();
        }
    });
}

// Přidání UI pro kalibraci (pouze pro adminy)
function addCalibrationUI() {
    // Kontrola, zda UI již neexistuje
    if (document.getElementById('calibration-ui')) {
        return;
    }
    
    const calibrationUI = document.createElement('div');
    calibrationUI.id = 'calibration-ui';
    calibrationUI.className = 'calibration-ui';
    calibrationUI.style.display = 'none'; // Skryté ve výchozím stavu
    
    calibrationUI.innerHTML = `
        <div style="border-bottom: 1px solid #555; padding-bottom: 10px; margin-bottom: 15px;">
            <h4 style="margin: 0; color: #ff9800;">
                <i class="fa-solid fa-crosshairs"></i> Kalibrace mapy
            </h4>
            <button id="toggle-calibration" style="margin-top: 5px; padding: 5px 10px; font-size: 12px;">
                Zapnout kalibraci
            </button>
        </div>
        
        <div id="calibration-controls" style="display: none;">
            <div style="margin-bottom: 15px;">
                <h5 style="margin: 0 0 10px 0;">Aktuální body (${window.mapCalibration.calibrationPoints.length})</h5>
                <div id="calibration-points-list" style="max-height: 150px; overflow-y: auto; margin-bottom: 10px;">
                    <!-- Body se vygenerují dynamicky -->
                </div>
                <button id="refresh-points" style="width: 100%; padding: 5px; font-size: 12px;">
                    <i class="fa-solid fa-refresh"></i> Obnovit seznam
                </button>
            </div>
            
            <div style="margin-bottom: 15px;">
                <h5 style="margin: 0 0 10px 0;">Přidat nový bod</h5>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 10px;">
                    <input type="number" id="cal-game-x" placeholder="Herní X" style="padding: 5px; font-size: 12px;">
                    <input type="number" id="cal-game-y" placeholder="Herní Y" style="padding: 5px; font-size: 12px;">
                    <input type="number" id="cal-map-x" placeholder="Mapa X%" min="0" max="100" style="padding: 5px; font-size: 12px;">
                    <input type="number" id="cal-map-y" placeholder="Mapa Y%" min="0" max="100" style="padding: 5px; font-size: 12px;">
                </div>
                <input type="text" id="cal-point-name" placeholder="Název bodu (volitelné)" style="width: 100%; padding: 5px; font-size: 12px; margin-bottom: 10px; box-sizing: border-box;">
                <button id="add-calibration-point" style="width: 100%; padding: 5px; font-size: 12px;">
                    <i class="fa-solid fa-plus"></i> Přidat bod
                </button>
            </div>
            
            <div style="margin-bottom: 15px;">
                <h5 style="margin: 0 0 10px 0;">Správa</h5>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
                    <button id="reset-calibration" style="padding: 5px; font-size: 12px; background-color: #f44336;">
                        <i class="fa-solid fa-undo"></i> Reset
                    </button>
                    <button id="test-calibration" style="padding: 5px; font-size: 12px; background-color: #2196F3;">
                        <i class="fa-solid fa-vial"></i> Test
                    </button>
                </div>
            </div>
            
            <div style="margin-bottom: 15px;">
                <h5 style="margin: 0 0 10px 0;">Import/Export</h5>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
                    <button id="export-calibration" style="padding: 5px; font-size: 12px;">
                        <i class="fa-solid fa-download"></i> Export
                    </button>
                    <label for="import-calibration" style="padding: 5px; font-size: 12px; background-color: var(--accent-color); color: white; text-align: center; cursor: pointer; border-radius: 4px;">
                        <i class="fa-solid fa-upload"></i> Import
                    </label>
                    <input type="file" id="import-calibration" accept=".json" style="display: none;">
                </div>
            </div>
            
            <div id="calibration-stats" style="font-size: 11px; color: #aaa; border-top: 1px solid #555; padding-top: 10px;">
                <!-- Statistiky se vygenerují dynamicky -->
            </div>
        </div>
    `;
    
    // Přidat UI na konec body
    document.body.appendChild(calibrationUI);
    
    // Přidat event listenery
    setupCalibrationEventListeners();
    
    // Aktualizovat seznam bodů
    updateCalibrationPointsList();
    updateCalibrationStats();
    
    console.log('Kalibrační UI přidáno');
}

// Odebrání kalibračního UI
function removeCalibrationUI() {
    const calibrationUI = document.getElementById('calibration-ui');
    if (calibrationUI) {
        calibrationUI.remove();
        console.log('Kalibrační UI odebráno');
    }
}

// Nastavení event listenerů pro kalibrační UI
function setupCalibrationEventListeners() {
    const toggleBtn = document.getElementById('toggle-calibration');
    const controls = document.getElementById('calibration-controls');
    const calibrationUI = document.getElementById('calibration-ui');
    
    // Toggle zobrazení kalibrace
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            const isVisible = calibrationUI.style.display !== 'none';
            
            if (isVisible) {
                calibrationUI.style.display = 'none';
                window.mapCalibration.isCalibrating = false;
            } else {
                calibrationUI.style.display = 'block';
                if (controls.style.display === 'none') {
                    controls.style.display = 'block';
                    toggleBtn.textContent = 'Skrýt kalibraci';
                } else {
                    toggleBtn.textContent = 'Zapnout kalibraci';
                }
                window.mapCalibration.isCalibrating = true;
            }
        });
    }
    
    // Přidat kalibrační bod
    const addPointBtn = document.getElementById('add-calibration-point');
    if (addPointBtn) {
        addPointBtn.addEventListener('click', function() {
            const gameX = parseFloat(document.getElementById('cal-game-x').value);
            const gameY = parseFloat(document.getElementById('cal-game-y').value);
            const mapX = parseFloat(document.getElementById('cal-map-x').value);
            const mapY = parseFloat(document.getElementById('cal-map-y').value);
            const name = document.getElementById('cal-point-name').value;
            
            if (isNaN(gameX) || isNaN(gameY) || isNaN(mapX) || isNaN(mapY)) {
                alert('Prosím vyplňte všechny číselné hodnoty');
                return;
            }
            
            try {
                window.mapCalibration.addCalibrationPoint(gameX, gameY, mapX, mapY, name);
                updateCalibrationPointsList();
                updateCalibrationStats();
                
                // Vyčistit formulář
                document.getElementById('cal-game-x').value = '';
                document.getElementById('cal-game-y').value = '';
                document.getElementById('cal-map-x').value = '';
                document.getElementById('cal-map-y').value = '';
                document.getElementById('cal-point-name').value = '';
                
                // Zobrazit toast
                if (typeof showToast === 'function') {
                    showToast('Kalibrační bod přidán', 'success');
                }
            } catch (error) {
                alert('Chyba při přidávání bodu: ' + error.message);
            }
        });
    }
    
    // Reset kalibrace
    const resetBtn = document.getElementById('reset-calibration');
    if (resetBtn) {
        resetBtn.addEventListener('click', function() {
            if (confirm('Opravdu chcete resetovat kalibraci na výchozí hodnoty?')) {
                window.mapCalibration.resetToDefault();
                updateCalibrationPointsList();
                updateCalibrationStats();
                
                if (typeof showToast === 'function') {
                    showToast('Kalibrace resetována', 'info');
                }
            }
        });
    }
    
    // Test kalibrace
    const testBtn = document.getElementById('test-calibration');
    if (testBtn) {
        testBtn.addEventListener('click', function() {
            testCalibration();
        });
    }
    
    // Export kalibrace
    const exportBtn = document.getElementById('export-calibration');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            const data = window.mapCalibration.exportCalibration();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `map-calibration-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            if (typeof showToast === 'function') {
                showToast('Kalibrace exportována', 'success');
            }
        });
    }
    
    // Import kalibrace
    const importInput = document.getElementById('import-calibration');
    if (importInput) {
        importInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(event) {
                try {
                    const data = JSON.parse(event.target.result);
                    if (window.mapCalibration.importCalibration(data)) {
                        updateCalibrationPointsList();
                        updateCalibrationStats();
                        
                        if (typeof showToast === 'function') {
                            showToast('Kalibrace importována', 'success');
                        }
                    } else {
                        alert('Neplatný formát kalibračního souboru');
                    }
                } catch (error) {
                    alert('Chyba při načítání souboru: ' + error.message);
                }
            };
            reader.readAsText(file);
            
            // Reset input
            e.target.value = '';
        });
    }
    
    // Obnovit seznam bodů
    const refreshBtn = document.getElementById('refresh-points');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            updateCalibrationPointsList();
            updateCalibrationStats();
        });
    }
}

// Aktualizace seznamu kalibračních bodů
function updateCalibrationPointsList() {
    const pointsList = document.getElementById('calibration-points-list');
    if (!pointsList || !window.mapCalibration) return;
    
    const points = window.mapCalibration.calibrationPoints;
    
    if (points.length === 0) {
        pointsList.innerHTML = '<div style="text-align: center; color: #aaa; padding: 10px;">Žádné kalibrační body</div>';
        return;
    }
    
    let html = '';
    points.forEach((point, index) => {
        html += `
            <div style="background-color: rgba(255,255,255,0.05); padding: 8px; margin-bottom: 5px; border-radius: 3px; position: relative;">
                <div style="font-weight: bold; margin-bottom: 3px;">${point.name || `Bod ${index + 1}`}</div>
                <div style="font-size: 11px; color: #ccc;">
                    Hra: ${point.gameX}, ${point.gameY}<br>
                    Mapa: ${point.mapX}%, ${point.mapY}%
                </div>
                <button onclick="removeCalibrationPoint(${index})" 
                        style="position: absolute; top: 5px; right: 5px; background: #f44336; border: none; color: white; width: 20px; height: 20px; border-radius: 3px; font-size: 10px; cursor: pointer;">
                    ×
                </button>
            </div>
        `;
    });
    
    pointsList.innerHTML = html;
}

// Aktualizace statistik kalibrace
function updateCalibrationStats() {
    const statsDiv = document.getElementById('calibration-stats');
    if (!statsDiv || !window.mapCalibration) return;
    
    const stats = window.mapCalibration.getCalibrationStats();
    
    statsDiv.innerHTML = `
        <div><strong>Statistiky kalibrace:</strong></div>
        <div>Počet bodů: ${stats.pointCount}</div>
        <div>Herní rozsah X: ${stats.gameXRange.min.toLocaleString()} až ${stats.gameXRange.max.toLocaleString()}</div>
        <div>Herní rozsah Y: ${stats.gameYRange.min.toLocaleString()} až ${stats.gameYRange.max.toLocaleString()}</div>
        <div>Mapový rozsah X: ${stats.mapXRange.min}% až ${stats.mapXRange.max}%</div>
        <div>Mapový rozsah Y: ${stats.mapYRange.min}% až ${stats.mapYRange.max}%</div>
    `;
}

// Odebrání kalibračního bodu
function removeCalibrationPoint(index) {
    if (confirm('Opravdu chcete odebrat tento kalibrační bod?')) {
        const removed = window.mapCalibration.removeCalibrationPoint(index);
        if (removed) {
            updateCalibrationPointsList();
            updateCalibrationStats();
            
            if (typeof showToast === 'function') {
                showToast(`Bod "${removed.name}" byl odebrán`, 'info');
            }
        }
    }
}

// Test kalibrace
function testCalibration() {
    const testPoints = [
        { gameX: 0, gameY: 0, expectedX: 50, expectedY: 50, name: "Střed" },
        { gameX: -280000, gameY: -400000, expectedX: 10, expectedY: 10, name: "Levý horní" },
        { gameX: 280000, gameY: 400000, expectedX: 90, expectedY: 90, name: "Pravý dolní" }
    ];
    
    let results = 'Výsledky testu kalibrace:\n\n';
    let maxError = 0;
    
    testPoints.forEach(test => {
        const result = window.mapCalibration.gameToMapCoordinates(test.gameX, test.gameY);
        const errorX = Math.abs(result.x - test.expectedX);
        const errorY = Math.abs(result.y - test.expectedY);
        const totalError = Math.sqrt(errorX * errorX + errorY * errorY);
        
        maxError = Math.max(maxError, totalError);
        
        results += `${test.name}:\n`;
        results += `  Vstup: (${test.gameX}, ${test.gameY})\n`;
        results += `  Výsledek: (${result.x.toFixed(2)}%, ${result.y.toFixed(2)}%)\n`;
        results += `  Očekáváno: (${test.expectedX}%, ${test.expectedY}%)\n`;
        results += `  Chyba: ${totalError.toFixed(2)}%\n\n`;
    });
    
    results += `Maximální chyba: ${maxError.toFixed(2)}%\n`;
    results += `Kvalita kalibrace: ${maxError < 5 ? 'Výborná' : maxError < 10 ? 'Dobrá' : maxError < 20 ? 'Průměrná' : 'Špatná'}`;
    
    alert(results);
}

// Pomocná funkce pro kliknutí na mapu (pro snadné přidávání kalibračních bodů)
function setupMapClickHandler() {
    const mapContainer = document.getElementById('map-container');
    if (!mapContainer) return;
    
    mapContainer.addEventListener('click', function(e) {
        // Pouze pokud je zapnutý kalibrační režim a uživatel drží Ctrl
        if (!window.mapCalibration.isCalibrating || !e.ctrlKey) {
            return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        
        const rect = mapContainer.getBoundingClientRect();
        const mapX = ((e.clientX - rect.left) / rect.width) * 100;
        const mapY = ((e.clientY - rect.top) / rect.height) * 100;
        
        // Zobrazit dialog pro zadání herních souřadnic
        const gameX = prompt(`Zadejte herní X souřadnici pro pozici na mapě (${mapX.toFixed(1)}%, ${mapY.toFixed(1)}%):`);
        if (gameX === null) return;
        
        const gameY = prompt(`Zadejte herní Y souřadnici:`);
        if (gameY === null) return;
        
        const name = prompt(`Název bodu (volitelné):`) || `Kliknutí ${Date.now()}`;
        
        try {
            const gameXNum = parseFloat(gameX);
            const gameYNum = parseFloat(gameY);
            
            if (isNaN(gameXNum) || isNaN(gameYNum)) {
                alert('Neplatné číselné hodnoty');
                return;
            }
            
            window.mapCalibration.addCalibrationPoint(gameXNum, gameYNum, mapX, mapY, name);
            updateCalibrationPointsList();
            updateCalibrationStats();
            
            if (typeof showToast === 'function') {
                showToast('Kalibrační bod přidán kliknutím', 'success');
            }
        } catch (error) {
            alert('Chyba: ' + error.message);
        }
    });
}

// Vylepšená integrace s hlavní aplikací
function enhanceMainApplication() {
    // Přidat indikátor kalibrace do stavového řádku
    const statusIndicator = document.getElementById('status-indicator');
    if (statusIndicator && statusIndicator.parentNode) {
        const calibrationIndicator = document.createElement('div');
        calibrationIndicator.id = 'calibration-indicator';
        calibrationIndicator.style.cssText = `
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: #2196F3;
            margin-left: 10px;
            display: none;
            title: 'Kalibrační režim aktivní';
        `;
        statusIndicator.parentNode.appendChild(calibrationIndicator);
    }
    
    // Sledovat změny v kalibračním režimu
    Object.defineProperty(window.mapCalibration, 'isCalibrating', {
        get() { return this._isCalibrating || false; },
        set(value) {
            this._isCalibrating = value;
            const indicator = document.getElementById('calibration-indicator');
            if (indicator) {
                indicator.style.display = value ? 'block' : 'none';
            }
            
            const mapContainer = document.getElementById('map-container');
            if (mapContainer) {
                mapContainer.style.cursor = value ? 'crosshair' : 'move';
            }
        }
    });
    
    // Přidat klávesové zkratky
    document.addEventListener('keydown', function(e) {
        // Ctrl+K pro toggle kalibrace (pouze pro adminy)
        if (e.ctrlKey && e.key === 'k' && window.user && window.user.isAdmin) {
            e.preventDefault();
            const toggleBtn = document.getElementById('toggle-calibration');
            if (toggleBtn) {
                toggleBtn.click();
            }
        }
        
        // Escape pro ukončení kalibračního režimu
        if (e.key === 'Escape' && window.mapCalibration.isCalibrating) {
            window.mapCalibration.isCalibrating = false;
            const calibrationUI = document.getElementById('calibration-ui');
            if (calibrationUI) {
                calibrationUI.style.display = 'none';
            }
        }
    });
    
    // Přidat tooltip pro kalibrační režim
    const mapContainer = document.getElementById('map-container');
    if (mapContainer) {
        const calibrationTooltip = document.createElement('div');
        calibrationTooltip.id = 'calibration-tooltip';
        calibrationTooltip.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: rgba(0,0,0,0.8);
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-size: 14px;
            z-index: 1000;
            display: none;
        `;
        calibrationTooltip.innerHTML = 'Ctrl+Klik pro přidání kalibračního bodu';
        mapContainer.appendChild(calibrationTooltip);
        
        // Zobrazit tooltip v kalibračním režimu
        const observer = new MutationObserver(function() {
            calibrationTooltip.style.display = window.mapCalibration.isCalibrating ? 'block' : 'none';
        });
        
        observer.observe(document.body, { subtree: true, attributes: true });
    }
}

// Inicializace po načtení všech komponent
function finalizeCalibrationIntegration() {
    setupMapClickHandler();
    enhanceMainApplication();
    
    // Event pro informování o změnách kalibrace
    document.addEventListener('calibrationChanged', function() {
        // Znovu aplikovat pozice všech markerů
        if (typeof updateMarkers === 'function') {
            updateMarkers();
        }
    });
    
    console.log('Kalibrace plně integrována do aplikace');
}

// Spustit finalizaci po krátkém zpoždění
setTimeout(finalizeCalibrationIntegration, 500);

// Export funkcí pro globální použití
window.removeCalibrationPoint = removeCalibrationPoint;
window.updateCalibrationPointsList = updateCalibrationPointsList;
window.updateCalibrationStats = updateCalibrationStats;
window.testCalibration = testCalibration;