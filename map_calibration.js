/**
 * Mapová kalibrace pro převod herních souřadnic na pozice na mapě
 * Tento soubor obsahuje pokročilé funkce pro kalibraci a správu kalibračních bodů
 */

// Konfigurace kalibrace
const MAP_CALIBRATION_CONFIG = {
    // Výchozí kalibrační body pro The Isle mapu
    defaultPoints: [
        { gameX: -280000, gameY: -400000, mapX: 10, mapY: 10, name: "Levý horní roh" },
        { gameX: 280000, gameY: 400000, mapX: 90, mapY: 90, name: "Pravý dolní roh" },
        { gameX: 0, gameY: 0, mapX: 50, mapY: 50, name: "Střed mapy" },
        { gameX: -140000, gameY: 0, mapX: 30, mapY: 50, name: "Levý střed" },
        { gameX: 140000, gameY: 0, mapX: 70, mapY: 50, name: "Pravý střed" }
    ],
    
    // Minimální a maximální hodnoty pro validaci
    validation: {
        gameX: { min: -500000, max: 500000 },
        gameY: { min: -500000, max: 500000 },
        mapX: { min: 0, max: 100 },
        mapY: { min: 0, max: 100 }
    }
};

// Třída pro správu kalibrace mapy
class MapCalibration {
    constructor() {
        this.calibrationPoints = [];
        this.isCalibrating = false;
        this.loadCalibrationPoints();
    }

    // Načtení kalibračních bodů
    loadCalibrationPoints() {
        try {
            const savedPoints = localStorage.getItem('mapCalibrationPoints');
            if (savedPoints) {
                this.calibrationPoints = JSON.parse(savedPoints);
                console.log('Načteny kalibrační body:', this.calibrationPoints.length);
            } else {
                this.calibrationPoints = [...MAP_CALIBRATION_CONFIG.defaultPoints];
                this.saveCalibrationPoints();
                console.log('Použity výchozí kalibrační body');
            }
        } catch (error) {
            console.error('Chyba při načítání kalibračních bodů:', error);
            this.calibrationPoints = [...MAP_CALIBRATION_CONFIG.defaultPoints];
        }
    }

    // Uložení kalibračních bodů
    saveCalibrationPoints() {
        try {
            localStorage.setItem('mapCalibrationPoints', JSON.stringify(this.calibrationPoints));
            console.log('Kalibrační body uloženy');
        } catch (error) {
            console.error('Chyba při ukládání kalibračních bodů:', error);
        }
    }

    // Přidání nového kalibračního bodu
    addCalibrationPoint(gameX, gameY, mapX, mapY, name = '') {
        if (!this.validateCoordinates(gameX, gameY, mapX, mapY)) {
            throw new Error('Neplatné souřadnice pro kalibrační bod');
        }

        const point = {
            gameX: parseFloat(gameX),
            gameY: parseFloat(gameY),
            mapX: parseFloat(mapX),
            mapY: parseFloat(mapY),
            name: name || `Bod ${this.calibrationPoints.length + 1}`,
            timestamp: new Date().toISOString()
        };

        this.calibrationPoints.push(point);
        this.saveCalibrationPoints();
        return point;
    }

    // Odebrání kalibračního bodu
    removeCalibrationPoint(index) {
        if (index >= 0 && index < this.calibrationPoints.length) {
            const removed = this.calibrationPoints.splice(index, 1);
            this.saveCalibrationPoints();
            return removed[0];
        }
        return null;
    }

    // Validace souřadnic
    validateCoordinates(gameX, gameY, mapX, mapY) {
        const config = MAP_CALIBRATION_CONFIG.validation;
        return (
            gameX >= config.gameX.min && gameX <= config.gameX.max &&
            gameY >= config.gameY.min && gameY <= config.gameY.max &&
            mapX >= config.mapX.min && mapX <= config.mapX.max &&
            mapY >= config.mapY.min && mapY <= config.mapY.max
        );
    }

    // Převod herních souřadnic na mapové pozice (hlavní funkce)
    gameToMapCoordinates(gameX, gameY) {
        if (this.calibrationPoints.length < 2) {
            console.warn('Nedostatek kalibračních bodů, používám základní lineární mapování');
            return this.basicLinearMapping(gameX, gameY);
        }

        // Pro více než 2 body použijeme interpolaci
        if (this.calibrationPoints.length >= 4) {
            return this.bilinearInterpolation(gameX, gameY);
        } else {
            return this.linearInterpolation(gameX, gameY);
        }
    }

    // Základní lineární mapování (fallback)
    basicLinearMapping(gameX, gameY) {
        const point1 = { gameX: -280000, gameY: -400000, mapX: 10, mapY: 10 };
        const point2 = { gameX: 280000, gameY: 400000, mapX: 90, mapY: 90 };

        const mapX = this.linearMap(gameX, point1.gameX, point2.gameX, point1.mapX, point2.mapX);
        const mapY = this.linearMap(gameY, point1.gameY, point2.gameY, point1.mapY, point2.mapY);

        return { x: Math.max(0, Math.min(100, mapX)), y: Math.max(0, Math.min(100, mapY)) };
    }

    // Lineární interpolace mezi dvěma body
    linearInterpolation(gameX, gameY) {
        // Najít dva nejbližší body pro X a Y souřadnice
        const sortedByX = [...this.calibrationPoints].sort((a, b) => a.gameX - b.gameX);
        const sortedByY = [...this.calibrationPoints].sort((a, b) => a.gameY - b.gameY);

        // Interpolace X souřadnice
        let mapX, mapY;

        if (sortedByX.length >= 2) {
            const xPoints = this.findBoundingPoints(gameX, sortedByX, 'gameX');
            mapX = this.linearMap(gameX, xPoints.lower.gameX, xPoints.upper.gameX, 
                                 xPoints.lower.mapX, xPoints.upper.mapX);
        } else {
            mapX = sortedByX[0].mapX;
        }

        if (sortedByY.length >= 2) {
            const yPoints = this.findBoundingPoints(gameY, sortedByY, 'gameY');
            mapY = this.linearMap(gameY, yPoints.lower.gameY, yPoints.upper.gameY, 
                                 yPoints.lower.mapY, yPoints.upper.mapY);
        } else {
            mapY = sortedByY[0].mapY;
        }

        return { x: Math.max(0, Math.min(100, mapX)), y: Math.max(0, Math.min(100, mapY)) };
    }

    // Bilineární interpolace (pro 4+ bodů)
    bilinearInterpolation(gameX, gameY) {
        // Najít čtyři nejbližší body tvořící obdélník
        const corners = this.findBoundingRectangle(gameX, gameY);
        
        if (!corners) {
            return this.linearInterpolation(gameX, gameY);
        }

        // Bilineární interpolace
        const { topLeft, topRight, bottomLeft, bottomRight } = corners;

        // Normalizované souřadnice v obdélníku (0-1)
        const tx = (gameX - topLeft.gameX) / (topRight.gameX - topLeft.gameX);
        const ty = (gameY - topLeft.gameY) / (bottomLeft.gameY - topLeft.gameY);

        // Interpolace
        const top = this.lerp(topLeft.mapX, topRight.mapX, tx);
        const bottom = this.lerp(bottomLeft.mapX, bottomRight.mapX, tx);
        const mapX = this.lerp(top, bottom, ty);

        const topY = this.lerp(topLeft.mapY, topRight.mapY, tx);
        const bottomY = this.lerp(bottomLeft.mapY, bottomRight.mapY, tx);
        const mapY = this.lerp(topY, bottomY, ty);

        return { x: Math.max(0, Math.min(100, mapX)), y: Math.max(0, Math.min(100, mapY)) };
    }

    // Najít ohraničující body
    findBoundingPoints(value, sortedPoints, coord) {
        for (let i = 0; i < sortedPoints.length - 1; i++) {
            if (value >= sortedPoints[i][coord] && value <= sortedPoints[i + 1][coord]) {
                return { lower: sortedPoints[i], upper: sortedPoints[i + 1] };
            }
        }

        // Pokud je hodnota mimo rozsah, použij krajní body
        if (value < sortedPoints[0][coord]) {
            return { lower: sortedPoints[0], upper: sortedPoints[1] };
        } else {
            return { lower: sortedPoints[sortedPoints.length - 2], upper: sortedPoints[sortedPoints.length - 1] };
        }
    }

    // Najít ohraničující obdélník
    findBoundingRectangle(gameX, gameY) {
        // Jednoduchá implementace - najít 4 nejbližší body
        const distances = this.calibrationPoints.map(point => ({
            point,
            distance: Math.sqrt(Math.pow(gameX - point.gameX, 2) + Math.pow(gameY - point.gameY, 2))
        }));

        distances.sort((a, b) => a.distance - b.distance);

        if (distances.length < 4) return null;

        // Vzít 4 nejbližší body a pokusit se z nich udělat obdélník
        const points = distances.slice(0, 4).map(d => d.point);

        // Seřadit body pro vytvoření obdélníku
        points.sort((a, b) => {
            if (a.gameY !== b.gameY) return a.gameY - b.gameY;
            return a.gameX - b.gameX;
        });

        return {
            topLeft: points[0],
            topRight: points[1],
            bottomLeft: points[2],
            bottomRight: points[3]
        };
    }

    // Lineární mapování hodnoty z jednoho rozsahu do druhého
    linearMap(value, inMin, inMax, outMin, outMax) {
        if (inMax === inMin) return outMin;
        return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
    }

    // Lineární interpolace
    lerp(a, b, t) {
        return a + (b - a) * Math.max(0, Math.min(1, t));
    }

    // Reset na výchozí body
    resetToDefault() {
        this.calibrationPoints = [...MAP_CALIBRATION_CONFIG.defaultPoints];
        this.saveCalibrationPoints();
        console.log('Kalibrační body resetovány na výchozí');
    }

    // Export kalibračních bodů
    exportCalibration() {
        return {
            points: this.calibrationPoints,
            timestamp: new Date().toISOString(),
            version: "1.0"
        };
    }

    // Import kalibračních bodů
    importCalibration(data) {
        if (data && data.points && Array.isArray(data.points)) {
            this.calibrationPoints = data.points.filter(point => 
                this.validateCoordinates(point.gameX, point.gameY, point.mapX, point.mapY)
            );
            this.saveCalibrationPoints();
            console.log(`Importováno ${this.calibrationPoints.length} kalibračních bodů`);
            return true;
        }
        return false;
    }

    // Získání statistik kalibrace
    getCalibrationStats() {
        return {
            pointCount: this.calibrationPoints.length,
            gameXRange: {
                min: Math.min(...this.calibrationPoints.map(p => p.gameX)),
                max: Math.max(...this.calibrationPoints.map(p => p.gameX))
            },
            gameYRange: {
                min: Math.min(...this.calibrationPoints.map(p => p.gameY)),
                max: Math.max(...this.calibrationPoints.map(p => p.gameY))
            },
            mapXRange: {
                min: Math.min(...this.calibrationPoints.map(p => p.mapX)),
                max: Math.max(...this.calibrationPoints.map(p => p.mapX))
            },
            mapYRange: {
                min: Math.min(...this.calibrationPoints.map(p => p.mapY)),
                max: Math.max(...this.calibrationPoints.map(p => p.mapY))
            }
        };
    }
}

// Globální instance kalibrace
window.mapCalibration = new MapCalibration();

// Export pro použití v jiných souborech
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MapCalibration, MAP_CALIBRATION_CONFIG };
}