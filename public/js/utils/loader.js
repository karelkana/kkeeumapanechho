// loader.js - Optimalizované načítání dat
class DataLoader {
    constructor() {
        this.loadedModules = new Set();
        this.pendingLoads = new Map();
        this.errorRetries = new Map();
        this.maxRetries = 3;
    }
    
    // Načtení konkrétního dinosaura
    async loadDinosaur(species) {
        // Check cache first
        if (DataRegistry.cache.dinosaurs[species]) {
            return DataRegistry.cache.dinosaurs[species];
        }
        
        // Check if already loading
        if (this.pendingLoads.has(species)) {
            return this.pendingLoads.get(species);
        }
        
        // Start loading
        const loadPromise = this._loadDinosaurFile(species);
        this.pendingLoads.set(species, loadPromise);
        
        try {
            const data = await loadPromise;
            DataRegistry.cache.dinosaurs[species] = data;
            DataRegistry.loadingStatus.dinosaurs[species] = 'loaded';
            this.pendingLoads.delete(species);
            return data;
        } catch (error) {
            this.pendingLoads.delete(species);
            DataRegistry.loadingStatus.dinosaurs[species] = 'error';
            console.error(`Chyba při načítání ${species}:`, error);
            
            // Retry logic
            const retries = this.errorRetries.get(species) || 0;
            if (retries < this.maxRetries) {
                this.errorRetries.set(species, retries + 1);
                console.log(`Pokus ${retries + 1}/${this.maxRetries} pro ${species}`);
                return this.loadDinosaur(species);
            }
            
            throw error;
        }
    }
    
    // Načtení souboru dinosaura
    async _loadDinosaurFile(species) {
        const type = DataRegistry.getDinosaurType(species);
        if (!type) {
            throw new Error(`Neznámý druh dinosaura: ${species}`);
        }
        
        const path = `${DataRegistry.paths.dinosaurs[type]}${species}.js`;
        
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = path;
            script.async = true;
            
            script.onload = () => {
                const dataName = this._capitalizeFirst(species) + 'Data';
                if (window[dataName]) {
                    resolve(window[dataName]);
                } else {
                    reject(new Error(`Data pro ${species} nebyla nalezena v window.${dataName}`));
                }
            };
            
            script.onerror = () => {
                reject(new Error(`Nepodařilo se načíst soubor: ${path}`));
            };
            
            document.head.appendChild(script);
        });
    }
    
    // Načtení systémových dat
    async loadSystem(systemName) {
        // Check cache
        if (DataRegistry.cache[systemName]) {
            return DataRegistry.cache[systemName];
        }
        
        // Check if already loading
        if (this.pendingLoads.has(systemName)) {
            return this.pendingLoads.get(systemName);
        }
        
        const path = `${DataRegistry.paths.systems}${systemName}.js`;
        const loadPromise = this._loadSystemFile(systemName, path);
        this.pendingLoads.set(systemName, loadPromise);
        
        try {
            const data = await loadPromise;
            DataRegistry.cache[systemName] = data;
            DataRegistry.loadingStatus.systems[systemName] = 'loaded';
            this.pendingLoads.delete(systemName);
            return data;
        } catch (error) {
            this.pendingLoads.delete(systemName);
            DataRegistry.loadingStatus.systems[systemName] = 'error';
            console.error(`Chyba při načítání systému ${systemName}:`, error);
            throw error;
        }
    }
    
    // Načtení systémového souboru
    async _loadSystemFile(systemName, path) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = path;
            script.async = true;
            
            script.onload = () => {
                const dataName = this._capitalizeFirst(systemName) + 'Data';
                if (window[dataName]) {
                    resolve(window[dataName]);
                } else {
                    reject(new Error(`Systémová data ${dataName} nebyla nalezena`));
                }
            };
            
            script.onerror = () => {
                reject(new Error(`Nepodařilo se načíst systém: ${path}`));
            };
            
            document.head.appendChild(script);
        });
    }
    
    // Batch loading
    async loadMultipleDinosaurs(speciesList) {
        const promises = speciesList.map(species => this.loadDinosaur(species));
        return Promise.all(promises);
    }
    
    // Preload důležitých dat
    async preloadEssentials() {
        const essentials = {
            dinosaurs: ['carnotaurus', 'stegosaurus', 'deinosuchus', 'maiasaura'],
            systems: ['plants', 'mutations', 'statusEffects']
        };
        
        try {
            // Load dinosaurs
            await this.loadMultipleDinosaurs(essentials.dinosaurs);
            
            // Load systems
            for (const system of essentials.systems) {
                await this.loadSystem(system);
            }
            
            console.log('✅ Základní data načtena');
        } catch (error) {
            console.error('❌ Chyba při načítání základních dat:', error);
        }
    }
    
    // Load dinosaurs by type
    async loadDinosaursByType(type) {
        const dinosaurs = DataRegistry.getDinosaursByType(type);
        return this.loadMultipleDinosaurs(dinosaurs);
    }
    
    // Check if loaded
    isLoaded(resourceName) {
        return DataRegistry.cache.dinosaurs[resourceName] !== undefined ||
               DataRegistry.cache[resourceName] !== null;
    }
    
    // Get loading progress
    getLoadingProgress() {
        const total = DataRegistry.getAllDinosaurs().length + 
                     Object.keys(DataRegistry.cache).filter(k => k !== 'dinosaurs').length;
        const loaded = DataRegistry.getCacheSize();
        
        return {
            loaded,
            total,
            percentage: Math.round((loaded / total) * 100)
        };
    }
    
    // Helper funkce
    _capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

// Globální instance
const dataLoader = new DataLoader();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DataLoader, dataLoader };
} else if (typeof window !== 'undefined') {
    window.DataLoader = DataLoader;
    window.dataLoader = dataLoader;
}