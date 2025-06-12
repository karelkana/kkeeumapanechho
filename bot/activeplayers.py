import nextcord
from nextcord.ext import commands, tasks
import logging
import json
import os
from datetime import datetime
from gamercon_async import EvrimaRCON
from util.config import RCON_HOST, RCON_PORT, RCON_PASS

class ActivePlayersRCON(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.rcon_host = RCON_HOST
        self.rcon_port = RCON_PORT
        self.rcon_password = RCON_PASS
        
        # ID kanálu kde bude embed
        self.channel_id = 1369600461849497690
        self.embed_message_id = None
        
        # Soubor pro uložení ID zprávy
        self.data_file = "active_players_data.json"
        self.load_data()
        
        self.update_player_list.start()

    def cog_unload(self):
        self.update_player_list.cancel()
        
    def load_data(self):
        """Načte ID zprávy ze souboru"""
        if os.path.exists(self.data_file):
            try:
                with open(self.data_file, 'r') as f:
                    data = json.load(f)
                    self.embed_message_id = data.get('message_id')
                    logging.info(f"Loaded message ID: {self.embed_message_id}")
            except Exception as e:
                logging.error(f"Error loading data file: {e}")
    
    def save_data(self):
        """Uloží ID zprávy do souboru"""
        try:
            with open(self.data_file, 'w') as f:
                json.dump({'message_id': self.embed_message_id}, f)
                logging.info(f"Saved message ID: {self.embed_message_id}")
        except Exception as e:
            logging.error(f"Error saving data file: {e}")

    async def get_player_list(self):
        """Získá seznam hráčů z RCON"""
        try:
            logging.info("Attempting RCON connection...")
            rcon = EvrimaRCON(self.rcon_host, self.rcon_port, self.rcon_password)
            await rcon.connect()
            logging.info("RCON connected, sending playerlist command...")
            
            command = b'\x02' + b'\x40' + b'\x00'  # playerlist command
            response = await rcon.send_command(command)
            
            logging.info(f"Raw RCON response type: {type(response)}")
            logging.info(f"Raw RCON response: {response}")
            
            return response
        except Exception as e:
            logging.error(f"Error getting player list from RCON: {e}")
            import traceback
            logging.error(traceback.format_exc())
            return None

    def parse_player_list(self, response):
        """Parsuje RCON odpověď a extrahuje POUZE jména hráčů"""
        if not response:
            logging.info("No response to parse")
            return []
        
        player_names = []
        
        try:
            # Převod odpovědi na string
            if isinstance(response, bytes):
                response_str = response.decode('utf-8', errors='ignore')
            else:
                response_str = str(response)
            
            logging.info(f"Response string: {response_str}")
            
            # Odstraníme případný prefix "PlayerList" nebo jiné
            response_str = response_str.strip()
            if response_str.lower().startswith('playerlist'):
                response_str = response_str[10:].strip()
            
            # Pokud je odpověď prázdná, vrátíme prázdný seznam
            if not response_str:
                logging.info("Empty response string")
                return []
            
            # Rozdělíme podle čárek a vyčistíme
            parts = [part.strip() for part in response_str.split(',')]
            
            # Odstraníme prázdné části
            parts = [part for part in parts if part]
            
            logging.info(f"Parts after split: {parts}")
            
            # Identifikujeme typy částí
            for part in parts:
                # Steam ID - dlouhé číslo (16-20 číslic)
                if part.isdigit() and len(part) >= 16:
                    logging.info(f"Skipping Steam ID: {part}")
                    continue
                
                # EOS ID - hex string (32+ znaků)
                if len(part) >= 32 and all(c in '0123456789abcdef' for c in part.lower()):
                    logging.info(f"Skipping EOS ID: {part}")
                    continue
                
                # Pokud to není ID a není to prázdné, je to jméno
                if part and not part.isdigit():
                    player_names.append(part)
                    logging.info(f"Found player name: {part}")
            
            # Výsledná jména
            logging.info(f"Final parsed player names: {player_names}")
            
        except Exception as e:
            logging.error(f"Error parsing player list: {e}")
            logging.error(f"Response was: {response}")
            import traceback
            logging.error(traceback.format_exc())
        
        return player_names

    @tasks.loop(minutes=3)
    async def update_player_list(self):
        """Pravidelně aktualizuje seznam hráčů z RCON"""
        try:
            logging.info("Starting player list update...")
            response = await self.get_player_list()
            
            if response is not None:
                player_names = self.parse_player_list(response)
                logging.info(f"Updating embed with players: {player_names}")
                await self.update_embed(player_names)
            else:
                logging.error("Failed to get player list from RCON - response is None")
                # Stále aktualizujeme embed, ale s prázdným seznamem
                await self.update_embed([])
        except Exception as e:
            logging.error(f"Error in update_player_list loop: {e}")
            import traceback
            logging.error(traceback.format_exc())

    @update_player_list.before_loop
    async def before_update_player_list(self):
        await self.bot.wait_until_ready()
        await self.setup_embed()

    async def setup_embed(self):
        """Nastaví embed zprávu - najde existující nebo vytvoří novou"""
        channel = self.bot.get_channel(self.channel_id)
        if channel is None:
            logging.error(f"Channel with ID {self.channel_id} not found!")
            return
        
        # 1. Zkusí použít uložené ID zprávy
        if self.embed_message_id:
            try:
                message = await channel.fetch_message(self.embed_message_id)
                if message.author == self.bot.user:
                    logging.info(f"Found existing message with saved ID: {self.embed_message_id}")
                    # Okamžitě aktualizujeme s aktuálními daty
                    response = await self.get_player_list()
                    player_names = self.parse_player_list(response) if response else []
                    await self.update_embed(player_names)
                    return
            except (nextcord.NotFound, nextcord.HTTPException):
                logging.info(f"Saved message {self.embed_message_id} not found, will search channel")
                self.embed_message_id = None
                self.save_data()
        
        # 2. Pokud uložená zpráva neexistuje, hledá v historii kanálu
        logging.info("Searching for existing embed in channel history...")
        async for message in channel.history(limit=100):
            if message.author == self.bot.user and message.embeds:
                embed = message.embeds[0]
                if embed.title and "The Isle - Aktivní hráči" in embed.title:
                    self.embed_message_id = message.id
                    self.save_data()
                    logging.info(f"Found existing embed message: {self.embed_message_id}")
                    # Okamžitě aktualizujeme
                    response = await self.get_player_list()
                    player_names = self.parse_player_list(response) if response else []
                    await self.update_embed(player_names)
                    return
        
        # 3. Pokud žádná zpráva neexistuje, vytvoří novou
        logging.info("No existing message found, creating new one...")
        response = await self.get_player_list()
        player_names = self.parse_player_list(response) if response else []
        embed = self.create_player_embed(player_names)
        message = await channel.send(embed=embed)
        self.embed_message_id = message.id
        self.save_data()
        logging.info(f"Created new embed message: {self.embed_message_id}")

    async def update_embed(self, player_names):
        """Aktualizuje embed s aktuálními daty hráčů"""
        if self.embed_message_id is None:
            await self.setup_embed()
            return
            
        channel = self.bot.get_channel(self.channel_id)
        if channel is None:
            return
            
        try:
            message = await channel.fetch_message(self.embed_message_id)
            embed = self.create_player_embed(player_names)
            await message.edit(embed=embed)
            logging.info(f"Embed updated with {len(player_names)} players")
        except nextcord.NotFound:
            logging.info("Message was deleted, creating new one")
            self.embed_message_id = None
            self.save_data()
            await self.setup_embed()
        except Exception as e:
            logging.error(f"Error updating embed: {e}")

    def create_player_embed(self, player_names):
        """Vytvoří embed s formátovanými jmény hráčů"""
        if not player_names:
            embed = nextcord.Embed(
                title="The Isle - Aktivní hráči",
                description="Žádní hráči nejsou online",
                color=nextcord.Color.red(),
                timestamp=datetime.now()
            )
        else:
            # Formátování jmen - max 4 na řádek oddělené " | "
            formatted_lines = []
            for i in range(0, len(player_names), 4):
                group = player_names[i:i+4]
                line = " **|** ".join(group)
                formatted_lines.append(f"**{line}**")  # Celý řádek tučně
            
            description = "\n".join(formatted_lines)
            
            embed = nextcord.Embed(
                title="The Isle Evrima - Aktivní hráči",
                description=description,
                color=nextcord.Color.green(),
                timestamp=datetime.now()
            )
        
        embed.set_footer(text=f"Celkem hráčů: {len(player_names)}")
        return embed

    @commands.command(description="Testuje RCON spojení a parser")
    @commands.is_owner()
    async def test_rcon(self, ctx):
        """Test příkaz pro debugging RCON a parseru"""
        try:
            # 1. Test RCON spojení
            await ctx.send("Testing RCON connection...")
            response = await self.get_player_list()
            
            if response is None:
                await ctx.send("❌ RCON connection failed - response is None")
                return
            
            # 2. Zobraz surovou odpověď
            if isinstance(response, bytes):
                response_str = response.decode('utf-8', errors='ignore')
            else:
                response_str = str(response)
                
            await ctx.send(f"✅ RCON response type: {type(response)}")
            await ctx.send(f"✅ RCON response:\n```{response_str[:1900]}```")
            
            # 3. Zobraz reprezentaci v bytech
            if isinstance(response, bytes):
                hex_repr = ' '.join([f'{b:02x}' for b in response[:100]])
                await ctx.send(f"Hex representation (first 100 bytes):\n```{hex_repr}```")
            
            # 4. Test parseru
            player_names = self.parse_player_list(response)
            await ctx.send(f"Parsed player names: {player_names}")
            await ctx.send(f"Number of players found: {len(player_names)}")
            
            # 5. Test vytvoření embedu
            embed = self.create_player_embed(player_names)
            await ctx.send("Preview embedu:", embed=embed)
            
        except Exception as e:
            await ctx.send(f"Error during test: {e}")
            import traceback
            await ctx.send(f"```{traceback.format_exc()[:1900]}```")

    @commands.command(description="Ručně obnoví player embed")
    @commands.is_owner()
    async def refreshplayerembed(self, ctx):
        response = await self.get_player_list()
        if response:
            player_names = self.parse_player_list(response)
            await self.update_embed(player_names)
            await ctx.send(f"Player embed obnoven. Nalezeno {len(player_names)} hráčů.")
        else:
            await ctx.send("Nepodařilo se získat seznam hráčů z RCON.")

    @commands.command(description="Zobrazí debug info o RCON")
    @commands.is_owner()
    async def debug_rcon(self, ctx):
        """Zobrazí debug informace o RCON konfiguraci"""
        await ctx.send(f"""
**RCON Configuration:**
Host: `{self.rcon_host}`
Port: `{self.rcon_port}`
Password: `{'*' * len(self.rcon_password) if self.rcon_password else 'NOT SET'}`
Channel ID: `{self.channel_id}`
Saved Message ID: `{self.embed_message_id}`
        """)

def setup(bot):
    bot.add_cog(ActivePlayersRCON(bot))