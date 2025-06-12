// registry.js - Centrální registr všech dat
const DataRegistry = {
    // DINOSAUR REGISTRY
    dinosaurs: {
        carnivores: [
            'carnotaurus', 'ceratosaurus', 'deinosuchus', 'dilophosaurus',
            'herrerasaurus', 'omniraptor', 'pteranodon', 'troodon'
        ],
        herbivores: [
            'stegosaurus', 'maiasaura', 'tenontosaurus', 'pachycephalosaurus',
            'hypsilophodon', 'dryosaurus', 'diabloceratops'
        ],
        omnivores: [
            'beipiaosaurus', 'gallimimus'
        ]
    },
    
    // LAZY LOADING PATHS
    paths: {
        dinosaurs: {
            carnivores: 'js/data/dinosaurs/carnivores/',
            herbivores: 'js/data/dinosaurs/herbivores/',
            omnivores: 'js/data/dinosaurs/omnivores/'
        },
        systems: 'js/data/systems/',
        utils: 'js/utils/'
    },
    
    // LOADED DATA CACHE
    cache: {
        dinosaurs: {},
        plants: null,
        mutations: null,
        statusEffects: null,
        locations: null,
        groupPlay: null,
        aiCreatures: null
    },
    
    // LOADING STATUS
    loadingStatus: {
        dinosaurs: {},
        systems: {}
    },
    
    // HELPER METHODS
    getAllDinosaurs() {
        return [
            ...this.dinosaurs.carnivores,
            ...this.dinosaurs.herbivores,
            ...this.dinosaurs.omnivores
        ];
    },
    
    getDinosaursByType(type) {
        return this.dinosaurs[type] || [];
    },
    
    getDinosaurType(species) {
        if (this.dinosaurs.carnivores.includes(species)) return 'carnivores';
        if (this.dinosaurs.herbivores.includes(species)) return 'herbivores';
        if (this.dinosaurs.omnivores.includes(species)) return 'omnivores';
        return null;
    },
    
    clearCache() {
        this.cache = {
            dinosaurs: {},
            plants: null,
            mutations: null,
            statusEffects: null,
            locations: null,
            groupPlay: null,
            aiCreatures: null
        };
    },
    
    getCacheSize() {
        let size = Object.keys(this.cache.dinosaurs).length;
        Object.keys(this.cache).forEach(key => {
            if (key !== 'dinosaurs' && this.cache[key]) {
                size++;
            }
        });
        return size;
    }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataRegistry;
} else if (typeof window !== 'undefined') {
    window.DataRegistry = DataRegistry;
}