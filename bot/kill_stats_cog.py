import nextcord
from nextcord.ext import commands, tasks
import paramiko
import os
import re
import asyncio
import logging
import json
from datetime import datetime
from collections import defaultdict
from typing import Dict, List, Tuple, Optional
from util.config import FTP_HOST, FTP_PASS, FTP_PORT, FTP_USER
from util.config import ENABLE_LOGGING, KILLFEED_CHANNEL, FILE_PATH
from util.config import STATS_CHANNEL, DEFAULT_GUILDS

class KillStats(commands.Cog):
    """
    Cog pro sledování a zobrazování statistik zabíjení hráčů.
    Umožňuje zobrazit top 10 zabijáků a individuální statistiky pomocí příkazu.
    """
    def __init__(self, bot):
        self.bot = bot
        self.ftp_host = FTP_HOST
        self.ftp_port = FTP_PORT
        self.ftp_username = FTP_USER
        self.ftp_password = FTP_PASS
        self.filepath = FILE_PATH
        self.stats_channel_id = STATS_CHANNEL
        self.last_position = None
        self.last_stat = None
        # Používáme defaultdict pro kill_stats, abychom nemuseli kontrolovat existenci klíčů
        self.kill_stats = defaultdict(lambda: {"kills": 0, "deaths": 0, "player_name": "", "dinos": defaultdict(int)})
        self.stats_message = None
        self.stats_file = "kill_stats.json"
        self.processed_kills = set()  # Set pro sledování již zpracovaných killů
        self.processed_kills_file = "processed_kills.json"  # Soubor pro uložení zpracovaných kill ID
        
        # Načtení statistik a zpracovaných killů ze souborů pokud existují
        self.load_stats()
        self.load_processed_kills()
        self.update_stats_message.start()
        self.save_stats_periodic.start()
        self.check_kill_feed.start()

    def load_stats(self):
        """Načte statistiky ze souboru"""
        try:
            if os.path.exists(self.stats_file):
                with open(self.stats_file, 'r') as f:
                    data = json.load(f)
                    for player_id, stats in data.items():
                        # Ujisti se, že struktura je správná a obsahuje všechny potřebné klíče
                        player_stats = {
                            "kills": stats.get("kills", 0),
                            "deaths": stats.get("deaths", 0),
                            "player_name": stats.get("player_name", ""),
                            "dinos": defaultdict(int)
                        }
                        
                        # Načti statistiky dinů
                        if "dinos" in stats:
                            for dino, count in stats["dinos"].items():
                                player_stats["dinos"][dino] = count
                        
                        self.kill_stats[player_id] = player_stats
                logging.info(f"Statistiky načteny ze souboru {self.stats_file}")
                
                # Debugovací výpis pro kontrolu
                for player_id, stats in self.kill_stats.items():
                    if stats["deaths"] > 0:
                        logging.info(f"Načteno: Hráč {stats['player_name']} (ID: {player_id}) má {stats['deaths']} úmrtí")
        except Exception as e:
            logging.error(f"Chyba při načítání statistik: {e}")
            
    def load_processed_kills(self):
        """Načte seznam již zpracovaných killů ze souboru"""
        try:
            if os.path.exists(self.processed_kills_file):
                with open(self.processed_kills_file, 'r') as f:
                    self.processed_kills = set(json.load(f))
                logging.info(f"Seznam zpracovaných killů načten ze souboru {self.processed_kills_file}")
        except Exception as e:
            logging.error(f"Chyba při načítání seznamu zpracovaných killů: {e}")
            self.processed_kills = set()

    def save_processed_kills(self):
        """Uloží seznam zpracovaných killů do souboru"""
        try:
            with open(self.processed_kills_file, 'w') as f:
                json.dump(list(self.processed_kills), f)
            logging.info(f"Seznam zpracovaných killů uložen do souboru {self.processed_kills_file}")
        except Exception as e:
            logging.error(f"Chyba při ukládání seznamu zpracovaných killů: {e}")

    def save_stats(self):
        """Uloží statistiky do souboru"""
        try:
            with open(self.stats_file, 'w') as f:
                json.dump(self.kill_stats, f, indent=4)
            logging.info(f"Statistiky uloženy do souboru {self.stats_file}")
            
            # Také uložíme zpracované killy při každém ukládání statistik
            self.save_processed_kills()
        except Exception as e:
            logging.error(f"Chyba při ukládání statistik: {e}")

    @tasks.loop(minutes=10)
    async def save_stats_periodic(self):
        """Periodicky ukládá statistiky a zpracované killy do souborů"""
        self.save_stats()
        self.save_processed_kills()

    async def async_sftp_operation(self, operation, *args, **kwargs):
        """Provede SFTP operaci asynchronně"""
        loop = asyncio.get_event_loop()
        try:
            with paramiko.Transport((self.ftp_host, self.ftp_port)) as transport:
                transport.connect(username=self.ftp_username, password=self.ftp_password)
                sftp = paramiko.SFTPClient.from_transport(transport)
                try:
                    result = await loop.run_in_executor(None, operation, sftp, *args, **kwargs)
                    return result
                finally:
                    sftp.close()
        except Exception as e:
            logging.error(f"SFTP operation error: {e}")
            return None

    def read_file(self, sftp, filepath, last_position):
        """Přečte nový obsah souboru od poslední pozice"""
        current_stat = sftp.stat(filepath)
        if last_position is None or (self.last_stat is not None and current_stat.st_size < last_position):
            last_position = 0
        self.last_stat = current_stat
        with sftp.file(filepath, "r") as file:
            file.seek(last_position)
            file_content = file.read().decode()
            new_position = file.tell()
        return file_content, new_position

    def parse_kill_feed(self, file_content):
        """Parsuje obsah kill feedu a aktualizuje statistiky"""
        # Jednodušší regulární výraz pro lepší čitelnost a údržbu
        timestamp_pattern = r'\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})\]'
        kill_header = r'\[LogTheIsleKillData\]:'
        killer_pattern = r'(.*?)\s+\[(\d+)\]\s+Dino:\s+(.*?),\s+(Male|Female),\s+([\d\.]+)'
        natural_death = r'Died from Natural cause'
        victim_pattern = r'Killed\s+the\s+following\s+player:\s+(.*?),\s+\[(\d+)\],\s+Dino:\s+(.*?),\s+Gender:\s+(Male|Female),\s+Growth:\s+([\d\.]+)'
        
        # Hledáme řádky s killem
        kill_regex = re.compile(f"^{timestamp_pattern}{kill_header}\\s+{killer_pattern}\\s+-\\s+(?:{natural_death}|{victim_pattern}).*$")
        
        matches = kill_regex.findall(file_content)
        updated = False
        
        for match in matches:
            timestamp = match[0]
            killer = match[1]
            killer_id = match[2]
            killer_dino = match[3]
            killer_gender = match[4]
            killer_value = match[5]
            
            # Kontrola, zda jde o přirozenou smrt nebo zabití
            if len(match) > 6:  # Pokud máme více než 6 skupin, jde o zabití (ne přirozenou smrt)
                victim = match[6]
                victim_id = match[7]
                victim_dino = match[8]
                victim_gender = match[9]
                victim_growth = match[10]
                natural = False
            else:
                victim = ""
                victim_id = ""
                victim_dino = ""
                victim_gender = ""
                victim_growth = ""
                natural = True
            
            # Vytvoření unikátního ID pro tento kill
            kill_id = f"{timestamp}_{killer_id}_{victim_id}"
            
            # Kontrola, zda tento kill už byl zpracován dříve
            if kill_id in self.processed_kills:
                continue  # Přeskoč, protože tento kill už byl zpracován
            
            # Přidání do setu zpracovaných killů
            self.processed_kills.add(kill_id)
            
            # Aktualizace jména hráče pro ID
            if killer:
                self.kill_stats[killer_id]["player_name"] = killer
            
            if victim:
                self.kill_stats[victim_id]["player_name"] = victim
            
            # Pokud nejde o přirozenou smrt, aktualizuj zabití a smrti
            if not natural and victim and victim_id:
                self.kill_stats[killer_id]["kills"] += 1
                self.kill_stats[killer_id]["dinos"][killer_dino] += 1
                
                # Ujisti se, že victim_id je platné a přidej smrt oběti
                if victim_id.isdigit():
                    self.kill_stats[victim_id]["deaths"] += 1
                    logging.info(f"Přičtena smrt hráči {victim} (ID: {victim_id}), nová hodnota: {self.kill_stats[victim_id]['deaths']}")
                
                updated = True
                logging.info(f"Zaznamenaná smrt: {killer} ({killer_dino}) zabil {victim} ({victim_dino})")
        
        return updated

    @tasks.loop(seconds=30)
    async def check_kill_feed(self):
        """Kontroluje nové záznamy v kill feedu a aktualizuje statistiky"""
        try:
            result = await self.async_sftp_operation(self.read_file, self.filepath, self.last_position)
            if result is None:
                return
                
            file_content, new_position = result
            self.last_position = new_position
            
            all_kills = file_content.strip().splitlines()
            updated = False
            
            for kill_line in all_kills:
                if self.parse_kill_feed(kill_line + '\n'):
                    updated = True
            
            if updated:
                # Aktualizuj zprávu pouze pokud byly změny
                await self.update_stats_message()
                
        except Exception as e:
            logging.error(f"Error in check_kill_feed loop: {e}")

    def get_top_killers(self, limit=10):
        """Vrátí top X zabijáků podle počtu zabití"""
        sorted_stats = sorted(
            [(id, stats) for id, stats in self.kill_stats.items() if stats["kills"] > 0],
            key=lambda x: x[1]["kills"],
            reverse=True
        )
        return sorted_stats[:limit]

    def get_player_stats(self, player_id):
        """Vrátí statistiky konkrétního hráče"""
        stats = self.kill_stats.get(player_id, {"kills": 0, "deaths": 0, "player_name": "Unknown", "dinos": {}})
        logging.info(f"Získány statistiky hráče {player_id}: {stats}")
        return stats

    async def create_stats_embed(self):
        """Vytvoří embed zprávu s top 10 zabijáky"""
        embed = nextcord.Embed(
            title="🏆 Top 10 Killers",
            description="Statistics of the best hunters on the server",
            color=nextcord.Color.red()
        )
        
        embed.set_footer(text=f"Last updated: {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}")
        
        top_killers = self.get_top_killers(10)
        
        if not top_killers:
            embed.add_field(name="No statistics", value="There are no kill records yet", inline=False)
            return embed
            
        value_text = ""
        for i, (player_id, stats) in enumerate(top_killers, 1):
            player_name = stats["player_name"] or f"Player {player_id}"
            deaths = stats.get("deaths", 0)  # Zajistí, že deaths existuje
            value_text += f"{i}. **{player_name}** - {stats['kills']} kills, {deaths} deaths\n"
            
            # Přidej nejčastější použité dino
            if stats["dinos"]:
                top_dino = max(stats["dinos"].items(), key=lambda x: x[1])
                value_text += f"    Favorite dino: {top_dino[0]} ({top_dino[1]}x)\n"
        
        embed.add_field(name="Leaderboard", value=value_text, inline=False)
        return embed

    async def create_player_stats_embed(self, player_id):
        """Vytvoří embed zprávu s detailními statistikami hráče"""
        stats = self.get_player_stats(player_id)
        player_name = stats["player_name"] or f"Player {player_id}"
        
        # Ujisti se, že deaths je zajištěn
        deaths = stats.get("deaths", 0)
        
        embed = nextcord.Embed(
            title=f"Player Statistics for {player_name}",
            color=nextcord.Color.blue()
        )
        
        embed.add_field(name="Total Kills", value=str(stats["kills"]), inline=True)
        embed.add_field(name="Total Deaths", value=str(deaths), inline=True)
        
        if stats["kills"] > 0:
            kd_ratio = stats["kills"] / max(deaths, 1)
            embed.add_field(name="K/D Ratio", value=f"{kd_ratio:.2f}", inline=True)
        
        # Přidej statistiky podle dina
        if stats["dinos"]:
            dino_text = ""
            sorted_dinos = sorted(stats["dinos"].items(), key=lambda x: x[1], reverse=True)
            for dino, count in sorted_dinos:
                dino_text += f"{dino}: {count} kills\n"
            embed.add_field(name="Kills by Dinosaur", value=dino_text, inline=False)
        
        # Najdi pořadí v žebříčku
        sorted_stats = sorted(
            [(id, st) for id, st in self.kill_stats.items() if st["kills"] > 0],
            key=lambda x: x[1]["kills"],
            reverse=True
        )
        
        rank = next((i for i, (pid, _) in enumerate(sorted_stats, 1) if pid == player_id), None)
        if rank:
            embed.add_field(name="Leaderboard Rank", value=f"#{rank} of {len(sorted_stats)}", inline=False)
        
        embed.set_footer(text=f"Steam ID: {player_id} | Updated: {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}")
        return embed

    @tasks.loop(minutes=1)
    async def update_stats_message(self):
        """Aktualizuje zprávu s top 10 zabijáky v určeném kanálu každou minutu"""
        try:
            channel = self.bot.get_channel(self.stats_channel_id)
            if not channel:
                logging.error("Stats channel not found.")
                return
                
            embed = await self.create_stats_embed()
            
            # Pokud zpráva neexistuje, pokus se ji najít v kanálu, místo vytvoření nové
            if not self.stats_message:
                # Hledej existující zprávu v kanálu
                found_message = None
                async for message in channel.history(limit=10):
                    # Kontroluj, zda zpráva je od bota a obsahuje embed s očekávaným nadpisem
                    if message.author.id == self.bot.user.id and message.embeds:
                        for msg_embed in message.embeds:
                            if msg_embed.title and "Top 10 Killers" in msg_embed.title:
                                found_message = message
                                break
                        if found_message:
                            break
                
                # Pokud zpráva byla nalezena, aktualizuj ji, jinak vytvoř novou
                if found_message:
                    self.stats_message = found_message
                    await found_message.edit(embed=embed)
                    logging.info("Nalezena a aktualizována existující zpráva s top 10 zabijáky")
                else:
                    # Zpráva nebyla nalezena, vytvoř novou
                    self.stats_message = await channel.send(embed=embed)
                    logging.info("Vytvořena nová zpráva s top 10 zabijáky")
            else:
                # Aktualizuj existující zprávu
                try:
                    message = await channel.fetch_message(self.stats_message.id)
                    await message.edit(embed=embed)
                    logging.info("Aktualizována zpráva s top 10 zabijáky")
                except (nextcord.NotFound, nextcord.HTTPException) as e:
                    logging.error(f"Chyba při aktualizaci zprávy: {e}")
                    # Zpráva byla smazána, vytvoř novou
                    self.stats_message = await channel.send(embed=embed)
                    logging.info("Vytvořena nová zpráva s top 10 zabijáky (původní nebyla nalezena)")
                    
        except Exception as e:
            logging.error(f"Error updating stats message: {e}")
    @nextcord.slash_command(name="kills", description="View player kill statistics")
    async def show_kills(self, 
                        interaction: nextcord.Interaction, 
                        name: str = nextcord.SlashOption(
                            name="name",
                            description="Player name to look up",
                            required=False
                        ),
                        steam_id: str = nextcord.SlashOption(
                            name="steam_id",
                            description="Steam ID to look up",
                            required=False
                        )):
        """
        View kill statistics for a player by name or Steam ID
        
        Parameters
        -----------
        name: str
            In-game name of the player whose statistics you want to view
        steam_id: str
            Steam ID of the player whose statistics you want to view
        """
        # Check if at least one parameter was provided
        if not name and not steam_id:
            await interaction.response.send_message("Please provide either a player name or Steam ID!", ephemeral=True)
            return
            
        # If both are provided, prioritize Steam ID
        target_id = steam_id
        
        # If only name is provided, try to find the corresponding Steam ID
        if not target_id and name:
            found = False
            for player_id, stats in self.kill_stats.items():
                if stats["player_name"].lower() == name.lower():
                    target_id = player_id
                    found = True
                    logging.info(f"Found player by name: {name} -> Steam ID: {target_id}")
                    break
            
            # If we couldn't find a match by name
            if not found:
                await interaction.response.send_message(f"Could not find player with name '{name}'. Please check the spelling or try using Steam ID instead.", ephemeral=True)
                return
        
        # Get player statistics
        stats = self.get_player_stats(target_id)
        
        # Check if player has any kills or deaths to determine if they exist in our records
        if stats["kills"] == 0 and stats["deaths"] == 0 and not stats["dinos"]:
            await interaction.response.send_message(f"No kill statistics found for this player. They may not have killed anyone or died on the server yet.", ephemeral=True)
            return
        
        # Create and send the embed with player statistics
        embed = await self.create_player_stats_embed(target_id)
        await interaction.response.send_message(embed=embed, ephemeral=True)
        
    @nextcord.slash_command(name="resetstats", description="Reset kill statistics (Admin only)", guild_ids=DEFAULT_GUILDS)
    async def reset_stats(self, interaction: nextcord.Interaction, confirm: str = nextcord.SlashOption(
        name="confirm",
        description="Type 'CONFIRM' to reset all statistics",
        required=True
    )):
        """
        Resetuje všechny statistiky zabíjení (pouze pro adminy)
        
        Parameters
        -----------
        confirm: str
            Musí být "CONFIRM" pro potvrzení akce
        """
        # Kontrola oprávnění - uživatel musí mít oprávnění administrátora
        if not interaction.user.guild_permissions.administrator:
            await interaction.response.send_message("You don't have permission to use this command. Administrator permission is required.", ephemeral=True)
            return
            
        # Kontrola potvrzení
        if confirm != "CONFIRM":
            await interaction.response.send_message("Operation canceled. You must type 'CONFIRM' to reset statistics.", ephemeral=True)
            return
            
        # Reset statistik - vyčistíme slovník, ale zachováme defaultdict funkcionalitu
        self.kill_stats.clear()
        self.processed_kills.clear()
        
        # Uložení prázdných statistik do souborů
        try:
            # Vymaž soubor se statistikami kompletně a vytvoř nový prázdný
            with open(self.stats_file, 'w') as f:
                json.dump({}, f)
                
            # Vymaž soubor se zpracovanými killy
            with open(self.processed_kills_file, 'w') as f:
                json.dump([], f)
                
            logging.info(f"Statistics files reset successfully by {interaction.user.name}")
        except Exception as e:
            logging.error(f"Error resetting statistics files: {e}")
            await interaction.response.send_message("Error resetting statistics files. Check logs for details.", ephemeral=True)
            return
        
        # Aktualizace zobrazené zprávy
        await self.update_stats_message()
        
        # Informace o úspěšném resetu
        await interaction.response.send_message("All kill statistics have been reset successfully!", ephemeral=True)
        logging.info(f"Kill statistics reset by {interaction.user.name} (ID: {interaction.user.id})")

    @commands.Cog.listener()
    async def on_ready(self):
        """Spustí se, když je bot připraven"""
        logging.info("KillStats cog is ready!")
        # Okamžitě aktualizuj statistickou zprávu
        await self.update_stats_message()
        logging.info("Forced stats message update on bot start")

    def cog_unload(self):
        """Spustí se při odebírání cogu"""
        self.check_kill_feed.cancel()
        self.update_stats_message.cancel()
        self.save_stats_periodic.cancel()
        self.save_stats()  # Ulož statistiky při vypnutí
        self.save_processed_kills()  # Ulož zpracované killy při vypnutí

def setup(bot):
    if ENABLE_LOGGING:
        bot.add_cog(KillStats(bot))
    else:
        logging.info("KillStats cog is disabled.")