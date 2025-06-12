// gamercon-async.js - Evrima RCON implementace
const net = require('net');

class EvrimaRCON {
    constructor(host = 'localhost', port = 27015, password = '') {
        this.host = host;
        this.port = parseInt(port);
        this.password = password;
        this.socket = null;
        this.isConnected = false;
        this.responseBuffer = Buffer.alloc(0);
        this.timeout = 10000;
    }
    
    async connect() {
        return new Promise((resolve, reject) => {
            if (this.isConnected) {
                resolve();
                return;
            }
            
            console.log(`RCON: Připojuji se k ${this.host}:${this.port}`);
            
            this.socket = new net.Socket();
            this.socket.setTimeout(this.timeout);
            
            this.socket.on('connect', () => {
                console.log('RCON: Připojeno k serveru');
                this.isConnected = true;
                
                // Pro Evrima servery často není potřeba autentifikace
                // nebo se používá jiný způsob
                resolve();
            });
            
            this.socket.on('data', (data) => {
                this.responseBuffer = Buffer.concat([this.responseBuffer, data]);
            });
            
            this.socket.on('error', (error) => {
                console.error('RCON: Chyba připojení:', error.message);
                this.isConnected = false;
                reject(error);
            });
            
            this.socket.on('timeout', () => {
                console.error('RCON: Timeout připojení');
                this.isConnected = false;
                reject(new Error('Connection timeout'));
            });
            
            this.socket.on('close', () => {
                console.log('RCON: Připojení ukončeno');
                this.isConnected = false;
            });
            
            try {
                this.socket.connect(this.port, this.host);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    async send_command(commandBuffer) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.socket) {
                reject(new Error('RCON připojení neexistuje nebo je odpojeno'));
                return;
            }
            
            console.log('RCON: Odesílání binárního příkazu, délka:', commandBuffer.length);
            
            // Vyčistit buffer před odesláním
            this.responseBuffer = Buffer.alloc(0);
            
            // Nastavit timeout pro odpověď
            const responseTimeout = setTimeout(() => {
                reject(new Error('Response timeout'));
            }, this.timeout);
            
            // Handler pro odpověď
            const dataHandler = () => {
                // Počkat krátkou chvíli na kompletní odpověď
                setTimeout(() => {
                    clearTimeout(responseTimeout);
                    const response = this.responseBuffer.toString('utf8');
                    console.log('RCON: Odpověď přijata, délka:', response.length);
                    resolve(response);
                }, 500); // 500ms na dokončení přenosu
            };
            
            // Jednorázový listener pro data
            this.socket.once('data', dataHandler);
            
            // Odeslat příkaz
            this.socket.write(commandBuffer);
        });
    }
    
    async send(command) {
        // Fallback pro standardní string příkazy
        if (typeof command === 'string') {
            const buffer = Buffer.from(command, 'utf8');
            return await this.send_command(buffer);
        } else {
            return await this.send_command(command);
        }
    }
    
    async close() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.isConnected = false;
        console.log('RCON: Spojení uzavřeno');
    }
    
    disconnect() {
        return this.close();
    }
}

module.exports = EvrimaRCON;

// Test pokud je spuštěn přímo
if (require.main === module) {
    async function test() {
        const rcon = new EvrimaRCON('87.236.195.202', 1039, 'mZt3AE33z9');
        
        try {
            await rcon.connect();
            console.log('Test: Připojení úspěšné');
            
            // Test serverinfo příkazu
            const serverInfoCmd = Buffer.concat([
                Buffer.from([0x02]),
                Buffer.from([0x12]),
                Buffer.from([0x00])
            ]);
            
            const result = await rcon.send_command(serverInfoCmd);
            console.log('Test: Odpověď serveru:', result.substring(0, 200));
            
            await rcon.close();
        } catch (error) {
            console.error('Test: Chyba:', error.message);
        }
    }
    
    test();
}