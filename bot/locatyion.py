import nextcord
from nextcord.ext import commands, tasks
from gamercon_async import EvrimaRCON
import re
import logging
import asyncio
import os
import json
import datetime
import io
import requests
from PIL import Image, ImageDraw, ImageFont
from util.config import RCON_HOST, RCON_PORT, RCON_PASS
from util.database import DB_PATH
import aiosqlite

# Konfigurace pro mapu
MAP_CONFIG = {
    # URL k obrázku mapy
    "map_image_url": "https://dc.karelkana.eu/worldmap.png",
    # Transformační parametry pro herní souřadnice
    "game_min_x": -400000,
    "game_max_x": 400000,
    "game_min_y": -400000,
    "game_max_y": 400000,
    # Velikost mapy v pixelech
    "map_size": 8192,
    # Interval aktualizace dat v sekundách
    "update_interval": 30,
    # Složka pro ukládání dočasných obrázků
    "temp_folder": "temp"
}

# Nastavení logování
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("player_map.log"),
        logging.StreamHandler()
    ]
)

class PlayerMapCog(commands.Cog):
    """Cog pro interaktivní mapu hráčů přímo v Discordu"""

    def __init__(self, bot):
        self.bot = bot
        self.rcon_host = RCON_HOST
        self.rcon_port = RCON_PORT
        self.rcon_password = RCON_PASS
        self.player_data = []
        self.map_image = None
        self.map_timestamp = None
        print("PlayerMapCog inicializován")


        # Vytvoření složky pro dočasné soubory, pokud neexistuje
        os.makedirs(MAP_CONFIG["temp_folder"], exist_ok=True)
        
        # Načtení konfigurace z JSON souboru nebo vytvoření nového souboru
        self.config_file = "map_config.json"
        self.config = self.load_config()
        
        # Stažení obrázku mapy
        self.download_map_image()
        
        # Spuštění úlohy pro aktualizaci dat o hráčích
        self.update_player_data_task.start()
        
    def load_config(self):
        """Načte konfigurační soubor nebo vytvoří nový s výchozími hodnotami"""
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                logging.error(f"Chyba při načítání konfiguračního souboru: {e}")
        
        # Pokud soubor neexistuje nebo nelze načíst, použijeme výchozí konfiguraci
        config = MAP_CONFIG.copy()
        
        # Uložení výchozí konfigurace do souboru
        try:
            with open(self.config_file, 'w') as f:
                json.dump(config, f, indent=2)
            logging.info("Vytvořena výchozí konfigurace mapy")
        except Exception as e:
            logging.error(f"Chyba při ukládání výchozí konfigurace: {e}")
        
        return config
    
    def save_config(self):
        """Uloží aktuální konfiguraci do souboru"""
        try:
            with open(self.config_file, 'w') as f:
                json.dump(self.config, f, indent=2)
            logging.info("Konfigurace mapy byla úspěšně uložena")
            return True
        except Exception as e:
            logging.error(f"Chyba při ukládání konfigurace: {e}")
            return False
    
    def download_map_image(self):
        """Stáhne obrázek mapy a uloží ho do paměti"""
        try:
            response = requests.get(self.config["map_image_url"])
            if response.status_code == 200:
                self.map_image = Image.open(io.BytesIO(response.content))
                self.map_timestamp = datetime.datetime.now()
                logging.info(f"Obrázek mapy úspěšně stažen z {self.config['map_image_url']}")
            else:
                logging.error(f"Nepodařilo se stáhnout obrázek mapy: Status {response.status_code}")
        except Exception as e:
            logging.error(f"Chyba při stahování obrázku mapy: {e}")
    
    @tasks.loop(seconds=MAP_CONFIG["update_interval"])
    async def update_player_data_task(self):
        """Pravidelně aktualizuje data o hráčích"""
        try:
            # Načtení aktuálního intervalu z konfigurace
            self.update_player_data_task.change_interval(seconds=self.config["update_interval"])
            
            # Získání informací o všech online hráčích
            player_data = await self.get_all_player_info()
            
            if player_data:
                self.player_data = player_data
                logging.info(f"Data o hráčích byla aktualizována - {len(player_data)} hráčů online")
            else:
                logging.warning("Nepodařilo se získat data o hráčích.")
        except Exception as e:
            logging.error(f"Chyba při aktualizaci dat o hráčích: {e}", exc_info=True)
    
    # Zajistit, aby úloha nezačala běžet, dokud bot není připraven
    @update_player_data_task.before_loop
    async def before_update_task(self):
        await self.bot.wait_until_ready()
    
    async def get_all_player_info(self):
        """Získá informace o všech online hráčích"""
        # Získání seznamu online hráčů
        online_players = await self.get_online_players()
        
        if not online_players:
            return []
        
        # Získání detailních informací o všech hráčích
        player_info = await self.get_player_info_batch(online_players)
        
        return player_info
    
    async def get_online_players(self):
        """Získá seznam online hráčů pomocí RCON playerlist příkazu"""
        rcon = None
        try:
            # Vytvoření RCON připojení
            rcon = EvrimaRCON(self.rcon_host, self.rcon_port, self.rcon_password)
            await rcon.connect()
            
            # RCON příkaz pro získání seznamu hráčů
            command = b'\x02' + b'\x40' + b'\x00'
            response = await rcon.send_command(command)
            
            # Vyhledání Steam ID v odpovědi
            if response:
                # Některé RCON odpovědi mohou být bytové řetězce
                if isinstance(response, bytes):
                    response_str = response.decode('utf-8', errors='ignore')
                else:
                    response_str = str(response)
                
                # Extrakce Steam ID hráčů
                id_pattern = r"Steam64ID: (\d+)"
                player_ids = re.findall(id_pattern, response_str)
                
                logging.info(f"Nalezeno {len(player_ids)} online hráčů: {player_ids}")
                return player_ids
            
            # Žádná odpověď z RCON
            logging.warning(f"Prázdná odpověď z RCON playerlist")
            return []
            
        except Exception as e:
            logging.error(f"Chyba při získávání seznamu online hráčů: {e}", exc_info=True)
            return []
        finally:
            # Bezpečné uzavření RCON spojení
            if rcon:
                try:
                    if hasattr(rcon, 'close') and callable(getattr(rcon, 'close')):
                        await rcon.close()
                except Exception as close_error:
                    logging.error(f"Chyba při uzavírání RCON spojení: {close_error}")
    
    async def get_player_info_batch(self, steam_ids):
        """Získá informace o více hráčích najednou"""
        if not steam_ids:
            return []
        
        # Získání všech informací o hráčích pomocí playerinfo příkazu
        rcon = None
        all_player_info = []
        
        try:
            # Vytvoření RCON připojení
            rcon = EvrimaRCON(self.rcon_host, self.rcon_port, self.rcon_password)
            await rcon.connect()
            
            # RCON příkaz pro získání informací o všech hráčích
            command = b'\x02' + b'\x77' + b'\x00'
            response = await rcon.send_command(command)
            
            if not response:
                logging.warning(f"Prázdná odpověď z RCON playerinfo")
                return []
            
            # Převod odpovědi na string
            if isinstance(response, bytes):
                response_str = response.decode('utf-8', errors='ignore')
            else:
                response_str = str(response)
            
            # Rozdělení odpovědi podle hráčů
            player_sections = []
            
            # Metoda 1: Rozdělení podle PlayerID
            if "PlayerID:" in response_str:
                raw_sections = response_str.split("PlayerID:")
                for section in raw_sections:
                    for steam_id in steam_ids:
                        if steam_id in section:
                            player_sections.append({"id": steam_id, "data": "PlayerID:" + section})
            
            # Zpracování každé sekce
            for player_data in player_sections:
                steam_id = player_data["id"]
                section = player_data["data"]
                
                try:
                    # Extrakce jednotlivých údajů
                    name_match = re.search(r'PlayerDataName:\s*([^,\n]+)', section)
                    name_match2 = re.search(r'CharacterName:\s*([^,\n]+)', section)
                    player_name = name_match.group(1).strip() if name_match else (name_match2.group(1).strip() if name_match2 else "Neznámý hráč")
                    
                    # Vyhledání pozice
                    location_match = re.search(r'Location:\s*X=\s*([-\d\.]+)\s*Y=\s*([-\d\.]+)\s*Z=\s*([-\d\.]+)', section)
                    pos_match = re.search(r'Position:\s*X=\s*([-\d\.]+)\s*Y=\s*([-\d\.]+)\s*Z=\s*([-\d\.]+)', section)
                    
                    if location_match:
                        x, y, z = location_match.groups()
                    elif pos_match:
                        x, y, z = pos_match.groups()
                    else:
                        # Pokud nemůžeme najít standardní formát, zkusíme najít jednotlivé souřadnice kdekoliv
                        x_match = re.search(r'X=\s*([-\d\.]+)', section)
                        y_match = re.search(r'Y=\s*([-\d\.]+)', section)
                        z_match = re.search(r'Z=\s*([-\d\.]+)', section)
                        
                        if x_match and y_match and z_match:
                            x = x_match.group(1)
                            y = y_match.group(1)
                            z = z_match.group(1)
                        else:
                            logging.warning(f"Nepodařilo se nalézt souřadnice pro hráče {steam_id}")
                            continue
                    
                    # Vyhledání třídy (dinosaurus)
                    class_match = re.search(r'Class:\s*([^,\n]+)', section)
                    dino_match = re.search(r'Dinosaur:\s*([^,\n]+)', section)
                    dino_class = class_match.group(1).strip() if class_match else (dino_match.group(1).strip() if dino_match else "Unknown")
                    
                    # Vyhledání ostatních hodnot
                    growth_match = re.search(r'Growth:\s*([\d\.]+)', section)
                    growth = float(growth_match.group(1)) if growth_match else 1.0
                    
                    health_match = re.search(r'Health:\s*([\d\.]+)', section)
                    health = float(health_match.group(1)) if health_match else 1.0
                    
                    stamina_match = re.search(r'Stamina:\s*([\d\.]+)', section)
                    stamina = float(stamina_match.group(1)) if stamina_match else 1.0
                    
                    hunger_match = re.search(r'Hunger:\s*([\d\.]+)', section)
                    hunger = float(hunger_match.group(1)) if hunger_match else 1.0
                    
                    thirst_match = re.search(r'Thirst:\s*([\d\.]+)', section)
                    thirst = float(thirst_match.group(1)) if thirst_match else 1.0
                    
                    # Vytvoření výsledného objektu
                    player_info = {
                        'id': steam_id,
                        'name': player_name,
                        'coords': {
                            'x': float(x),
                            'y': float(y),
                            'z': float(z),
                            'formatted': f"{float(y):,.3f}, {float(x):,.3f}, {float(z):,.3f}"
                        },
                        'class': dino_class.replace('BP_', '').replace('_C', ''),
                        'growth': growth * 100,
                        'health': health * 100,
                        'stamina': stamina * 100,
                        'hunger': hunger * 100,
                        'thirst': thirst * 100,
                        'timestamp': datetime.datetime.now().strftime("%H:%M:%S")
                    }
                    
                    all_player_info.append(player_info)
                    
                except Exception as extract_error:
                    logging.error(f"Chyba při extrakci dat hráče {steam_id}: {extract_error}")
            
            return all_player_info
            
        except Exception as e:
            logging.error(f"Chyba při získávání informací o hráčích: {e}")
            return []
        finally:
            # Bezpečné uzavření RCON spojení
            if rcon:
                try:
                    if hasattr(rcon, 'close') and callable(getattr(rcon, 'close')):
                        await rcon.close()
                except Exception as close_error:
                    logging.error(f"Chyba při uzavírání RCON spojení: {close_error}")

async def is_player_online(self, steam_id):
        """Zkontroluje, zda je hráč online pomocí RCON playerlist příkazu"""
        rcon = None
        try:
            # Vytvoření RCON připojení
            rcon = EvrimaRCON(self.rcon_host, self.rcon_port, self.rcon_password)
            await rcon.connect()
            
            # RCON příkaz pro získání seznamu hráčů
            command = b'\x02' + b'\x40' + b'\x00'
            response = await rcon.send_command(command)
            
            # Vyhledání Steam ID v odpovědi
            if response:
                # Některé RCON odpovědi mohou být bytové řetězce
                if isinstance(response, bytes):
                    response_str = response.decode('utf-8', errors='ignore')
                else:
                    response_str = str(response)
                
                # Pro jistotu zkontrolujeme několik možných formátů
                if steam_id in response_str:
                    logging.info(f"Hráč {steam_id} je online (nalezen přímo v odpovědi)")
                    return True
                
                # Zkusíme extrahovat všechna ID pomocí regex
                id_pattern = r"Steam64ID: (\d+)"
                player_ids = re.findall(id_pattern, response_str)
                
                # Kontrola, zda je ID ve výsledcích
                is_online = steam_id in player_ids
                logging.info(f"Hráč {steam_id} online status: {is_online}, nalezená IDs: {player_ids}")
                return is_online
            
            # Žádná odpověď z RCON
            logging.warning(f"Prázdná odpověď z RCON playerlist")
            return False
            
        except Exception as e:
            logging.error(f"Chyba při kontrole online stavu hráče: {e}", exc_info=True)
            return False
        finally:
            # Bezpečné uzavření RCON spojení
            if rcon:
                try:
                    if hasattr(rcon, 'close') and callable(getattr(rcon, 'close')):
                        await rcon.close()
                except Exception as close_error:
                    logging.error(f"Chyba při uzavírání RCON spojení: {close_error}")
    
async def get_steam_id_by_discord_id(self, discord_id):
        """Získá Steam ID pro daný Discord ID z databáze"""
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    "SELECT steam_id FROM links WHERE discord_id = ? AND status = ?", 
                    (discord_id, "linked")
                ) as cursor:
                    row = await cursor.fetchone()
                    if row:
                        return row[0]
            
            return None
        except Exception as e:
            logging.error(f"Chyba při získávání Steam ID pro Discord ID {discord_id}: {e}")
            return None   
        def transform_coordinates(self, game_x, game_y):
         """Převede herní souřadnice na souřadnice mapy podle konfigurace"""
        # Normalizace souřadnic do rozsahu 0-1
        norm_x = (float(game_x) - self.config["game_min_x"]) / (self.config["game_max_x"] - self.config["game_min_x"])
        norm_y = (float(game_y) - self.config["game_min_y"]) / (self.config["game_max_y"] - self.config["game_min_y"])
        
        # Převod na pixely mapy (s invertováním Y souřadnice)
        map_size = self.config["map_size"]
        map_x = int(norm_x * map_size)
        map_y = int((1 - norm_y) * map_size)
        
        return {'x': map_x, 'y': map_y}
    
        def create_player_list_view(self, page=0, items_per_page=10, filter_text=""):
            """Vytvoří Discord View pro interaktivní seznam hráčů"""
        # Filtrace hráčů podle textu
        filtered_players = self.player_data
        if filter_text:
            filtered_players = [p for p in self.player_data if filter_text.lower() in p["name"].lower() or filter_text.lower() in p["class"].lower()]
        
        # Vytvoření View objektu s PlayerListUI
        return PlayerListUI(self, filtered_players, page, items_per_page, filter_text)
    
        def create_location_embed(self, player_info):
           """Vytvoří embed s informacemi o poloze hráče"""
        embed = nextcord.Embed(
            title=f"Pozice hráče: {player_info['name']}",
            description=f"Dinosaurus: {player_info['class']}",
            color=nextcord.Color.green()
        )
        
        # Přidání polí s informacemi
        embed.add_field(name="Souřadnice", value=player_info['coords']['formatted'], inline=False)
        embed.add_field(name="Growth", value=f"{player_info['growth']:.0f}%", inline=True)
        embed.add_field(name="Health", value=f"{player_info['health']:.0f}%", inline=True)
        embed.add_field(name="Stamina", value=f"{player_info['stamina']:.0f}%", inline=True)
        embed.add_field(name="Hunger", value=f"{player_info['hunger']:.0f}%", inline=True)
        embed.add_field(name="Thirst", value=f"{player_info['thirst']:.0f}%", inline=True)
        
        # Přidání thumbnail a footer
        embed.set_thumbnail(url="https://i.imgur.com/AhI15Pl.png")  # Můžete změnit URL podle potřeby
        embed.set_footer(text=f"KarelKana.Eu • {player_info['timestamp']}")
        
        return embed
    
        def create_map_image_with_players(self, selected_player_id=None, crop_area=None):
            """Vytvoří obrázek mapy s označenými pozicemi hráčů"""
        if not self.map_image:
            logging.error("Obrázek mapy není k dispozici")
            return None
        
        try:
            # Vytvoření kopie mapy pro kreslení
            map_image = self.map_image.copy()
            draw = ImageDraw.Draw(map_image)
            
            # Pokud nejsou žádní hráči, vrátíme prázdnou mapu
            if not self.player_data:
                logging.warning("Žádní hráči nejsou online")
                
                # Vytvoření BytesIO objektu pro uložení obrázku
                img_byte_arr = io.BytesIO()
                map_image.save(img_byte_arr, format='PNG')
                img_byte_arr.seek(0)
                return img_byte_arr
            
            # Generování barev pro různé třídy dinosaurů
            dino_colors = {}
            dino_classes = set(player["class"] for player in self.player_data)
            
            # Předefinované barvy pro dinosaury
            predefined_colors = [
                (255, 0, 0),     # Červená
                (0, 0, 255),     # Modrá
                (0, 255, 0),     # Zelená
                (255, 255, 0),   # Žlutá
                (255, 0, 255),   # Purpurová
                (0, 255, 255),   # Azurová
                (255, 128, 0),   # Oranžová
                (128, 0, 255),   # Fialová
                (0, 128, 255),   # Světle modrá
                (255, 0, 128),   # Růžová
                (128, 255, 0),   # Limetková
                (255, 255, 255), # Bílá
                (150, 75, 0),    # Hnědá
                (0, 128, 128),   # Tyrkysová
                (128, 128, 0),   # Olivová
                (128, 0, 0)      # Vínová
            ]
            
            # Přiřazení barev třídám dinosaurů
            for i, dino_class in enumerate(dino_classes):
                dino_colors[dino_class] = predefined_colors[i % len(predefined_colors)]
            
            # Načtení fontu pro popisky
            try:
                font_size = 20
                font = ImageFont.truetype("arial.ttf", font_size)
            except Exception as font_error:
                logging.warning(f"Nepodařilo se načíst font: {font_error}")
                font = ImageFont.load_default()
            
            # Vyznačení pozic hráčů na mapě
            selected_player = None
            selected_player_pos = None
            
            for player in self.player_data:
                # Transformace herních souřadnic na souřadnice mapy
                map_coords = self.transform_coordinates(player["coords"]["x"], player["coords"]["y"])
                
                # Barva podle třídy dinosaura
                marker_color = dino_colors.get(player["class"], (255, 255, 255))
                
                # Velikost značky
                marker_size = 10
                
                # Pokud je to vybraný hráč, uložíme si jeho pozici a data
                if player["id"] == selected_player_id:
                    selected_player = player
                    selected_player_pos = map_coords
                    # Vyznačíme ho větší značkou
                    marker_size = 15
                
                # Kreslení značky (kruh)
                draw.ellipse(
                    (map_coords["x"] - marker_size, map_coords["y"] - marker_size,
                     map_coords["x"] + marker_size, map_coords["y"] + marker_size),
                    fill=marker_color, outline=(255, 255, 255), width=2
                )
                
                # Přidání malého textu se jménem hráče
                draw.text(
                    (map_coords["x"] + marker_size + 2, map_coords["y"] - font_size // 2),
                    player["name"],
                    fill=(255, 255, 255), font=font
                )
            
            # Přidání detailních informací o vybraném hráči
            if selected_player and selected_player_pos:
                # Vytvoření rámečku pro informace (info box)
                info_box_width = 200
                info_box_height = 150
                info_box_x = selected_player_pos["x"] + 20
                info_box_y = selected_player_pos["y"] - 75
                
                # Zajištění, aby info box nepřekračoval hranice obrázku
                if info_box_x + info_box_width > map_image.width:
                    info_box_x = selected_player_pos["x"] - info_box_width - 20
                
                if info_box_y + info_box_height > map_image.height:
                    info_box_y = map_image.height - info_box_height - 10
                
                if info_box_y < 10:
                    info_box_y = 10
                
                # Kreslení pozadí info boxu (poloprůhledný černý obdélník)
                draw.rectangle(
                    (info_box_x, info_box_y, info_box_x + info_box_width, info_box_y + info_box_height),
                    fill=(0, 0, 0, 180), outline=(255, 255, 255), width=2
                )
                
                # Přidání informací o hráči
                text_x = info_box_x + 10
                text_y = info_box_y + 10
                line_height = font_size + 2
                
                draw.text((text_x, text_y), f"Hráč: {selected_player['name']}", fill=(255, 255, 255), font=font)
                text_y += line_height
                
                draw.text((text_x, text_y), f"Dino: {selected_player['class']}", fill=(255, 255, 255), font=font)
                text_y += line_height
                
                draw.text((text_x, text_y), f"Growth: {selected_player['growth']:.0f}%", fill=(255, 255, 255), font=font)
                text_y += line_height
                
                draw.text((text_x, text_y), f"Health: {selected_player['health']:.0f}%", fill=(255, 255, 255), font=font)
                text_y += line_height
                
                draw.text((text_x, text_y), f"Stamina: {selected_player['stamina']:.0f}%", fill=(255, 255, 255), font=font)
                text_y += line_height
                
                draw.text((text_x, text_y), f"Hunger: {selected_player['hunger']:.0f}%", fill=(255, 255, 255), font=font)
                text_y += line_height
                
                draw.text((text_x, text_y), f"Thirst: {selected_player['thirst']:.0f}%", fill=(255, 255, 255), font=font)
            
            # Pokud je zadána oblast výřezu, ořežeme mapu
            if crop_area and selected_player_pos:
                # Ořezové souřadnice
                crop_size = crop_area  # velikost čtverce se středem v pozici hráče
                half_crop = crop_size // 2
                
                crop_left = max(0, selected_player_pos["x"] - half_crop)
                crop_top = max(0, selected_player_pos["y"] - half_crop)
                crop_right = min(map_image.width, selected_player_pos["x"] + half_crop)
                crop_bottom = min(map_image.height, selected_player_pos["y"] + half_crop)
                
                # Ořez mapy
                map_image = map_image.crop((crop_left, crop_top, crop_right, crop_bottom))
            
            # Vytvoření BytesIO objektu pro uložení obrázku
            img_byte_arr = io.BytesIO()
            map_image.save(img_byte_arr, format='PNG')
            img_byte_arr.seek(0)
            return img_byte_arr
            
        except Exception as e:
            logging.error(f"Chyba při vytváření obrázku mapy: {e}", exc_info=True)
@nextcord.slash_command(description="Zobrazí seznam online hráčů s interaktivními tlačítky")
async def hraci(self, interaction: nextcord.Interaction, 
                   filtr: str = nextcord.SlashOption(
                       name="filtr",
                       description="Filtrovat hráče podle jména nebo dinosaura",
                       required=False
                   )):
        """Zobrazí seznam online hráčů s interaktivními tlačítky pro zobrazení detailů"""
        await interaction.response.defer(ephemeral=True)
        
        try:
            # Kontrola, zda jsou k dispozici data
            if not self.player_data:
                await interaction.followup.send("Momentálně nejsou k dispozici žádná data o hráčích.", ephemeral=True)
                return
            
            # Filtrace hráčů podle filtru
            filtered_players = self.player_data
            if filtr:
                filtered_players = [p for p in self.player_data if filtr.lower() in p["name"].lower() or filtr.lower() in p["class"].lower()]
                
                if not filtered_players:
                    await interaction.followup.send(f"Žádný hráč odpovídající filtru '{filtr}' nebyl nalezen.", ephemeral=True)
                    return
            
            # Vytvoření embedu pro první stránku
            embed = nextcord.Embed(
                title="Seznam online hráčů",
                description=f"Celkem online: {len(filtered_players)} hráčů",
                color=nextcord.Color.blue()
            )
            
            # Vytvoření UI pro interaktivní prvky
            view = PlayerListUI(self, filtered_players)
            
            # Odeslání zprávy s UI
            await interaction.followup.send(embed=embed, view=view, ephemeral=True)
            
        except Exception as e:
            logging.error(f"Chyba při zobrazení seznamu hráčů: {e}", exc_info=True)
            await interaction.followup.send(f"Došlo k chybě při zobrazení seznamu hráčů: {str(e)}", ephemeral=True)
    
@nextcord.slash_command(description="Zobrazí pozici hráče na mapě")
async def mapa(self, interaction: nextcord.Interaction, 
                 steam_id: str = nextcord.SlashOption(
                     name="steam_id",
                     description="Steam ID hráče (nepovinné)",
                     required=False
                 )):
        """Zobrazí pozici hráče na mapě"""
        await interaction.response.defer(ephemeral=True)
        
        try:
            # Pokud není zadáno Steam ID, použijeme ID propojeného účtu
            if not steam_id:
                discord_id = str(interaction.user.id)
                steam_id = await self.get_steam_id_by_discord_id(discord_id)
                
                if not steam_id:
                    await interaction.followup.send("Nemáte propojený účet. Použijte příkaz `/link` pro propojení nebo zadejte Steam ID.", ephemeral=True)
                    return
            
            # Hledání hráče v aktuálních datech
            player_info = None
            for player in self.player_data:
                if player["id"] == steam_id:
                    player_info = player
                    break
            
            # Pokud jsme nenašli hráče v aktuálních datech, zkusíme ho najít pomocí RCON
            if not player_info:
                # Zkontrolujeme, zda je hráč online
                is_online = await self.is_player_online(steam_id)
                
                if not is_online:
                    await interaction.followup.send("Hráč není aktuálně online na serveru.", ephemeral=True)
                    return
                
                # Zkusíme získat informace o hráči
                players_info = await self.get_player_info_batch([steam_id])
                if players_info and len(players_info) > 0:
                    player_info = players_info[0]
                else:
                    await interaction.followup.send("Nepodařilo se získat informace o hráči.", ephemeral=True)
                    return
            
            # Vytvoření obrázku mapy s označenou pozicí hráče
            image_bytes = self.create_map_image_with_players(selected_player_id=steam_id, crop_area=2000)
            
            if not image_bytes:
                await interaction.followup.send("Nepodařilo se vytvořit obrázek mapy.", ephemeral=True)
                return
            
            # Vytvoření souboru z obrázku
            map_file = nextcord.File(image_bytes, filename="player_map.png")
            
            # Vytvoření embedu s informacemi
            embed = self.create_location_embed(player_info)
            embed.set_image(url="attachment://player_map.png")
            
            # Vytvoření UI pro navigaci mezi hráči
            view = PlayerNavigationUI(self, player_info["id"])
            
            # Odeslání embedu s mapou a UI
            await interaction.followup.send(file=map_file, embed=embed, view=view, ephemeral=True)
            
        except Exception as e:
            logging.error(f"Chyba při zobrazení mapy: {e}", exc_info=True)
            await interaction.followup.send(f"Došlo k chybě při zobrazení mapy: {str(e)}", ephemeral=True)
@nextcord.slash_command(
        description="Změní nastavení mapy",
        default_member_permissions=nextcord.Permissions(administrator=True)
    )
async def mapa_kalibrace(self, interaction: nextcord.Interaction,
                           game_min_x: float = nextcord.SlashOption(
                               name="min_x",
                               description="Minimální X souřadnice v herním světě",
                               required=False
                           ),
                           game_max_x: float = nextcord.SlashOption(
                               name="max_x",
                               description="Maximální X souřadnice v herním světě",
                               required=False
                           ),
                           game_min_y: float = nextcord.SlashOption(
                               name="min_y",
                               description="Minimální Y souřadnice v herním světě",
                               required=False
                           ),
                           game_max_y: float = nextcord.SlashOption(
                               name="max_y",
                               description="Maximální Y souřadnice v herním světě",
                               required=False
                           ),
                           update_interval: int = nextcord.SlashOption(
                               name="interval",
                               description="Interval aktualizace dat v sekundách",
                               required=False
                           )):
        """Změní nastavení mapy"""
        await interaction.response.defer(ephemeral=True)
        
        try:
            changes_made = False
            
            # Aktualizace hodnot, které byly zadány
            if game_min_x is not None:
                self.config["game_min_x"] = game_min_x
                changes_made = True
            
            if game_max_x is not None:
                self.config["game_max_x"] = game_max_x
                changes_made = True
            
            if game_min_y is not None:
                self.config["game_min_y"] = game_min_y
                changes_made = True
            
            if game_max_y is not None:
                self.config["game_max_y"] = game_max_y
                changes_made = True
            
            if update_interval is not None:
                if update_interval < 5:
                    await interaction.followup.send("Interval aktualizace nesmí být menší než 5 sekund.", ephemeral=True)
                    return
                    
                self.config["update_interval"] = update_interval
                # Aktualizace intervalu úlohy
                self.update_player_data_task.change_interval(seconds=update_interval)
                changes_made = True
            
            if changes_made:
                # Uložení konfigurace
                if self.save_config():
                    await interaction.followup.send("Nastavení mapy bylo úspěšně aktualizováno.", ephemeral=True)
                else:
                    await interaction.followup.send("Nastavení mapy bylo aktualizováno, ale nepodařilo se ho uložit do souboru.", ephemeral=True)
            else:
                # Zobrazení aktuálního nastavení
                embed = nextcord.Embed(
                    title="Nastavení mapy",
                    description="Aktuální nastavení pro transformaci herních souřadnic na mapu",
                    color=nextcord.Color.blue()
                )
                
                embed.add_field(name="Min X", value=str(self.config["game_min_x"]), inline=True)
                embed.add_field(name="Max X", value=str(self.config["game_max_x"]), inline=True)
                embed.add_field(name="Min Y", value=str(self.config["game_min_y"]), inline=True)
                embed.add_field(name="Max Y", value=str(self.config["game_max_y"]), inline=True)
                embed.add_field(name="Interval aktualizace", value=f"{self.config['update_interval']} sekund", inline=True)
                
                embed.add_field(
                    name="Jak nastavit", 
                    value="Pro změnu nastavení použijte parametry příkazu, například:\n`/mapa_kalibrace min_x=-400000 max_x=400000`", 
                    inline=False
                )
                
                await interaction.followup.send(embed=embed, ephemeral=True)
            
        except Exception as e:
            logging.error(f"Chyba při aktualizaci nastavení mapy: {e}", exc_info=True)
            await interaction.followup.send(f"Došlo k chybě při aktualizaci nastavení mapy: {str(e)}", ephemeral=True)
    
@nextcord.slash_command(description="Zobrazí statistiky o online hráčích")
async def online_statistiky(self, interaction: nextcord.Interaction):
        """Zobrazí statistiky o online hráčích"""
        await interaction.response.defer(ephemeral=True)
        
        try:
            # Kontrola, zda jsou k dispozici data
            if not self.player_data:
                await interaction.followup.send("Momentálně nejsou k dispozici žádná data o hráčích.", ephemeral=True)
                return
            
            # Počítání hráčů podle druhu dinosaura
            dino_counts = {}
            for player in self.player_data:
                dino_class = player["class"]
                if dino_class in dino_counts:
                    dino_counts[dino_class] += 1
                else:
                    dino_counts[dino_class] = 1
            
            # Seřazení podle počtu
            sorted_dinos = sorted(dino_counts.items(), key=lambda x: x[1], reverse=True)
            
            # Vytvoření embedu
            embed = nextcord.Embed(
                title="Statistiky online hráčů",
                description=f"Celkem online: {len(self.player_data)} hráčů",
                color=nextcord.Color.blue()
            )
            
            # Přidání statistik dinosaurů
            dino_stats = "\n".join([f"{dino}: {count}" for dino, count in sorted_dinos])
            embed.add_field(name="Počty podle druhu", value=dino_stats if dino_stats else "Žádní hráči", inline=False)
            
            # Přidání dalších možných statistik (průměrný growth, zdraví atd.)
            if self.player_data:
                avg_growth = sum(p["growth"] for p in self.player_data) / len(self.player_data)
                avg_health = sum(p["health"] for p in self.player_data) / len(self.player_data)
                
                embed.add_field(name="Průměrný growth", value=f"{avg_growth:.1f}%", inline=True)
                embed.add_field(name="Průměrné zdraví", value=f"{avg_health:.1f}%", inline=True)
            
            # Přidání informace o poslední aktualizaci
            last_update = datetime.datetime.now().strftime("%H:%M:%S")
            embed.set_footer(text=f"Poslední aktualizace: {last_update}")
            
            # Vytvoření tlačítek pro zobrazení hráčů podle druhu
            view = DinoStatisticsUI(self, sorted_dinos)
            
            # Odeslání embedu
            await interaction.followup.send(embed=embed, view=view, ephemeral=True)
            
        except Exception as e:
            logging.error(f"Chyba při zobrazení statistik: {e}", exc_info=True)
            await interaction.followup.send(f"Došlo k chybě při zobrazení statistik: {str(e)}", ephemeral=True)
@nextcord.slash_command(description="Hledá konkrétního hráče na serveru")
async def najit_hrace(self, interaction: nextcord.Interaction, 
                         jmeno_hrace: str = nextcord.SlashOption(
                             name="jmeno", 
                             description="Jméno nebo část jména hráče",
                             required=True
                         )):
        """Hledá konkrétního hráče na serveru podle jména a zobrazí jeho pozici"""
        await interaction.response.defer(ephemeral=True)
        
        try:
            # Hledání hráče podle jména
            found_players = []
            for player in self.player_data:
                if jmeno_hrace.lower() in player["name"].lower():
                    found_players.append(player)
            
            if not found_players:
                await interaction.followup.send(f"Žádný hráč s jménem obsahujícím '{jmeno_hrace}' nebyl nalezen online.", ephemeral=True)
                return
            
            # Pokud je nalezen jen jeden hráč, zobrazíme jeho detaily a mapu
            if len(found_players) == 1:
                player_info = found_players[0]
                
                # Vytvoření obrázku mapy s označenou pozicí hráče
                image_bytes = self.create_map_image_with_players(selected_player_id=player_info["id"], crop_area=2000)
                
                if not image_bytes:
                    await interaction.followup.send("Nepodařilo se vytvořit obrázek mapy.", ephemeral=True)
                    return
                
                # Vytvoření souboru z obrázku
                map_file = nextcord.File(image_bytes, filename="player_map.png")
                
                # Vytvoření embedu s informacemi
                embed = self.create_location_embed(player_info)
                embed.set_image(url="attachment://player_map.png")
                
                # Vytvoření UI pro navigaci mezi hráči
                view = PlayerNavigationUI(self, player_info["id"])
                
                # Odeslání embedu s mapou
                await interaction.followup.send(file=map_file, embed=embed, view=view, ephemeral=True)
            
            # Pokud je nalezeno více hráčů, zobrazíme seznam s možností výběru
            else:
                # Vytvoření embedu s výsledky
                embed = nextcord.Embed(
                    title=f"Nalezení hráči obsahující '{jmeno_hrace}'",
                    description=f"Celkem nalezeno: {len(found_players)}",
                    color=nextcord.Color.green()
                )
                
                # Vytvoření UI pro výběr hráče
                view = SearchResultsUI(self, found_players)
                
                # Odeslání embedu s tlačítky
                await interaction.followup.send(embed=embed, view=view, ephemeral=True)
            
        except Exception as e:
            logging.error(f"Chyba při hledání hráče: {e}", exc_info=True)
            await interaction.followup.send(f"Došlo k chybě při hledání hráče: {str(e)}", ephemeral=True)

@nextcord.slash_command(description="Zobrazí mapu s pozicemi všech hráčů")
async def mapa_vsech(self, interaction: nextcord.Interaction):
        """Zobrazí mapu s pozicemi všech hráčů"""
        await interaction.response.defer(ephemeral=True)
        
        try:
            # Kontrola, zda jsou k dispozici data
            if not self.player_data:
                await interaction.followup.send("Momentálně nejsou online žádní hráči.", ephemeral=True)
                return
            
            # Vytvoření obrázku mapy se všemi hráči
            image_bytes = self.create_map_image_with_players()
            
            if not image_bytes:
                await interaction.followup.send("Nepodařilo se vytvořit obrázek mapy.", ephemeral=True)
                return
            
            # Vytvoření souboru z obrázku
            map_file = nextcord.File(image_bytes, filename="all_players_map.png")
            
            # Vytvoření embedu s informacemi
            embed = nextcord.Embed(
                title="Mapa všech online hráčů",
                description=f"Celkem online: {len(self.player_data)} hráčů",
                color=nextcord.Color.blue()
            )
            
            embed.set_image(url="attachment://all_players_map.png")
            embed.set_footer(text=f"Aktualizováno: {datetime.datetime.now().strftime('%H:%M:%S')}")
            
            # Odeslání embedu s mapou
            await interaction.followup.send(file=map_file, embed=embed, ephemeral=True)
            
        except Exception as e:
            logging.error(f"Chyba při zobrazení mapy všech hráčů: {e}", exc_info=True)
            await interaction.followup.send(f"Došlo k chybě při zobrazení mapy: {str(e)}", ephemeral=True)
class PlayerListUI(nextcord.ui.View):
    """UI pro zobrazení a interakci se seznamem hráčů"""
    
    def __init__(self, cog, players, timeout=300):
        super().__init__(timeout=timeout)
        self.cog = cog
        self.players = players
        self.page = 0
        self.items_per_page = 5
        
        # Vytvoření select menu pro výběr hráče
        self.create_select_menu()
        
        # Přidání tlačítek pro stránkování
        self.add_navigation_buttons()
    
    def create_select_menu(self):
        """Vytvoří select menu pro výběr hráče"""
        # Výpočet indexů pro aktuální stránku
        start_idx = self.page * self.items_per_page
        end_idx = min(start_idx + self.items_per_page, len(self.players))
        page_players = self.players[start_idx:end_idx]
        
        # Vytvoření options pro select menu
        options = []
        for player in page_players:
            options.append(
                nextcord.SelectOption(
                    label=f"{player['name']} ({player['class']})"[:100],  # Omezení délky
                    value=player["id"],
                    description=f"G: {player['growth']:.0f}% | H: {player['health']:.0f}% | {player['coords']['formatted']}"[:100]
                )
            )
        
        # Pokud nejsou žádné options, přidáme placeholder
        if not options:
            options.append(
                nextcord.SelectOption(
                    label="Žádní hráči",
                    value="none",
                    description="Nebyli nalezeni žádní hráči"
                )
            )
        
        # Vytvoření select menu
        select = nextcord.ui.Select(
            placeholder="Vyberte hráče pro zobrazení detailů a mapy",
            options=options,
            disabled=len(options) == 1 and options[0].value == "none"
        )
        
        # Nastavení callbacku
        select.callback = self.select_callback
        
        # Přidání select menu do view
        self.add_item(select)
    
    def add_navigation_buttons(self):
        """Přidá tlačítka pro navigaci mezi stránkami"""
        # Výpočet celkového počtu stránek
        total_pages = (len(self.players) - 1) // self.items_per_page + 1
        
        # Tlačítko pro předchozí stránku
        prev_button = nextcord.ui.Button(
            style=nextcord.ButtonStyle.secondary,
            label="◀️ Předchozí",
            disabled=self.page <= 0,
            row=1
        )
        prev_button.callback = self.prev_page_callback
        self.add_item(prev_button)
        
        # Informace o stránce
        page_info = nextcord.ui.Button(
            style=nextcord.ButtonStyle.secondary,
            label=f"Stránka {self.page + 1}/{total_pages}",
            disabled=True,
            row=1
        )
        self.add_item(page_info)
        
        # Tlačítko pro další stránku
        next_button = nextcord.ui.Button(
            style=nextcord.ButtonStyle.secondary,
            label="Další ▶️",
            disabled=self.page >= total_pages - 1,
            row=1
        )
        next_button.callback = self.next_page_callback
        self.add_item(next_button)
        
        # Tlačítko pro zobrazení mapy všech hráčů
        map_button = nextcord.ui.Button(
            style=nextcord.ButtonStyle.primary,
            label="🗺️ Zobrazit mapu všech",
            row=2
        )
        map_button.callback = self.map_all_callback
        self.add_item(map_button)
        
        # Tlačítko pro zobrazení statistik
        stats_button = nextcord.ui.Button(
            style=nextcord.ButtonStyle.secondary,
            label="📊 Statistiky",
            row=2
        )
        stats_button.callback = self.stats_callback
        self.add_item(stats_button)
    
    async def select_callback(self, interaction):
        """Callback pro výběr hráče ze select menu"""
        await interaction.response.defer(ephemeral=True)
        
        # Získání ID vybraného hráče
        player_id = interaction.data["values"][0]
        
        # Kontrola, zda byl vybrán skutečný hráč
        if player_id == "none":
            return
        
        # Hledání hráče v datech
        player_info = None
        for player in self.cog.player_data:
            if player["id"] == player_id:
                player_info = player
                break
        
        if not player_info:
            await interaction.followup.send("Hráč již není online.", ephemeral=True)
            return
        
        # Vytvoření obrázku mapy s označenou pozicí hráče
        image_bytes = self.cog.create_map_image_with_players(selected_player_id=player_id, crop_area=2000)
        
        if not image_bytes:
            await interaction.followup.send("Nepodařilo se vytvořit obrázek mapy.", ephemeral=True)
            return
        
        # Vytvoření souboru z obrázku
        map_file = nextcord.File(image_bytes, filename="player_map.png")
        
        # Vytvoření embedu s informacemi
        embed = self.cog.create_location_embed(player_info)
        embed.set_image(url="attachment://player_map.png")
        
        # Vytvoření UI pro navigaci mezi hráči
        view = PlayerNavigationUI(self.cog, player_info["id"])
        
        # Odeslání embedu s mapou
        await interaction.followup.send(file=map_file, embed=embed, view=view, ephemeral=True)
    
    async def prev_page_callback(self, interaction):
        """Callback pro tlačítko předchozí stránky"""
        await interaction.response.defer()
        
        # Změna stránky
        if self.page > 0:
            self.page -= 1
            
            # Aktualizace UI
            # Odebereme současné prvky
            self.clear_items()
            
            # Přidáme nové prvky
            self.create_select_menu()
            self.add_navigation_buttons()
            
            # Vytvoření embedu s aktualizovaným nadpisem
            embed = nextcord.Embed(
                title="Seznam online hráčů",
                description=f"Celkem online: {len(self.players)} hráčů | Stránka {self.page + 1}/{(len(self.players) - 1) // self.items_per_page + 1}",
                color=nextcord.Color.blue()
            )
            
            # Aktualizace zprávy
            await interaction.edit_original_message(embed=embed, view=self)
    
    async def next_page_callback(self, interaction):
        """Callback pro tlačítko další stránky"""
        await interaction.response.defer()
        
        # Výpočet celkového počtu stránek
        total_pages = (len(self.players) - 1) // self.items_per_page + 1
        
        # Změna stránky
        if self.page < total_pages - 1:
            self.page += 1
            
            # Aktualizace UI
            # Odebereme současné prvky
            self.clear_items()
            
            # Přidáme nové prvky
            self.create_select_menu()
            self.add_navigation_buttons()
            
            # Vytvoření embedu s aktualizovaným nadpisem
            embed = nextcord.Embed(
                title="Seznam online hráčů",
                description=f"Celkem online: {len(self.players)} hráčů | Stránka {self.page + 1}/{total_pages}",
                color=nextcord.Color.blue()
            )
            
            # Aktualizace zprávy
            await interaction.edit_original_message(embed=embed, view=self)
    
    async def map_all_callback(self, interaction):
        """Callback pro tlačítko zobrazení mapy všech hráčů"""
        await interaction.response.defer(ephemeral=True)
        
        # Vytvoření obrázku mapy se všemi hráči
        image_bytes = self.cog.create_map_image_with_players()
        
        if not image_bytes:
            await interaction.followup.send("Nepodařilo se vytvořit obrázek mapy.", ephemeral=True)
            return
        
        # Vytvoření souboru z obrázku
        map_file = nextcord.File(image_bytes, filename="all_players_map.png")
        
        # Vytvoření embedu s informacemi
        embed = nextcord.Embed(
            title="Mapa všech online hráčů",
            description=f"Celkem online: {len(self.cog.player_data)} hráčů",
            color=nextcord.Color.blue()
        )
        
        embed.set_image(url="attachment://all_players_map.png")
        embed.set_footer(text=f"Aktualizováno: {datetime.datetime.now().strftime('%H:%M:%S')}")
        
        # Odeslání embedu s mapou
        await interaction.followup.send(file=map_file, embed=embed, ephemeral=True)
async def stats_callback(self, interaction):
        """Callback pro tlačítko zobrazení statistik"""
        await interaction.response.defer(ephemeral=True)
        
        # Použijeme online_statistiky příkaz pro zobrazení statistik
        await self.cog.online_statistiky(interaction)


class PlayerNavigationUI(nextcord.ui.View):
    """UI pro navigaci mezi hráči na mapě"""
    
    def __init__(self, cog, current_player_id, timeout=300):
        super().__init__(timeout=timeout)
        self.cog = cog
        self.current_player_id = current_player_id
        
        # Přidání tlačítek pro navigaci
        self.add_navigation_buttons()
    
    def add_navigation_buttons(self):
        """Přidá tlačítka pro navigaci mezi hráči a další funkce"""
        # Najdeme index aktuálního hráče
        current_index = -1
        players = self.cog.player_data
        for i, player in enumerate(players):
            if player["id"] == self.current_player_id:
                current_index = i
                break
        
        # Tlačítko pro předchozího hráče
        prev_button = nextcord.ui.Button(
            style=nextcord.ButtonStyle.secondary,
            label="◀️ Předchozí hráč",
            disabled=current_index <= 0 or current_index == -1,
            row=0
        )
        prev_button.callback = self.prev_player_callback
        self.add_item(prev_button)
        
        # Tlačítko pro dalšího hráče
        next_button = nextcord.ui.Button(
            style=nextcord.ButtonStyle.secondary,
            label="Další hráč ▶️",
            disabled=current_index >= len(players) - 1 or current_index == -1,
            row=0
        )
        next_button.callback = self.next_player_callback
        self.add_item(next_button)
        
        # Tlačítko pro zobrazení mapy všech hráčů
        map_all_button = nextcord.ui.Button(
            style=nextcord.ButtonStyle.primary,
            label="🗺️ Mapa všech",
            row=1
        )
        map_all_button.callback = self.map_all_callback
        self.add_item(map_all_button)
        
        # Tlačítko pro seznam všech hráčů
        list_button = nextcord.ui.Button(
            style=nextcord.ButtonStyle.secondary,
            label="📋 Seznam hráčů",
            row=1
        )
        list_button.callback = self.list_players_callback
        self.add_item(list_button)
    
    async def prev_player_callback(self, interaction):
        """Callback pro tlačítko předchozího hráče"""
        await interaction.response.defer(ephemeral=True)
        
        # Najdeme index aktuálního hráče a předchozího hráče
        current_index = -1
        players = self.cog.player_data
        for i, player in enumerate(players):
            if player["id"] == self.current_player_id:
                current_index = i
                break
        
        if current_index > 0:
            prev_player = players[current_index - 1]
            
            # Vytvoření obrázku mapy s označenou pozicí hráče
            image_bytes = self.cog.create_map_image_with_players(selected_player_id=prev_player["id"], crop_area=2000)
            
            if not image_bytes:
                await interaction.followup.send("Nepodařilo se vytvořit obrázek mapy.", ephemeral=True)
                return
            
            # Vytvoření souboru z obrázku
            map_file = nextcord.File(image_bytes, filename="player_map.png")
            
            # Vytvoření embedu s informacemi
            embed = self.cog.create_location_embed(prev_player)
            embed.set_image(url="attachment://player_map.png")
            
            # Vytvoření nového UI s aktualizovaným ID hráče
            view = PlayerNavigationUI(self.cog, prev_player["id"])
            
            # Odeslání embedu s mapou
            await interaction.followup.send(file=map_file, embed=embed, view=view, ephemeral=True)
    
    async def next_player_callback(self, interaction):
        """Callback pro tlačítko dalšího hráče"""
        await interaction.response.defer(ephemeral=True)
        
        # Najdeme index aktuálního hráče a dalšího hráče
        current_index = -1
        players = self.cog.player_data
        for i, player in enumerate(players):
            if player["id"] == self.current_player_id:
                current_index = i
                break
        
        if current_index < len(players) - 1:
            next_player = players[current_index + 1]
            
            # Vytvoření obrázku mapy s označenou pozicí hráče
            image_bytes = self.cog.create_map_image_with_players(selected_player_id=next_player["id"], crop_area=2000)
            
            if not image_bytes:
                await interaction.followup.send("Nepodařilo se vytvořit obrázek mapy.", ephemeral=True)
                return
            
            # Vytvoření souboru z obrázku
            map_file = nextcord.File(image_bytes, filename="player_map.png")
            
            # Vytvoření embedu s informacemi
            embed = self.cog.create_location_embed(next_player)
            embed.set_image(url="attachment://player_map.png")
            
            # Vytvoření nového UI s aktualizovaným ID hráče
            view = PlayerNavigationUI(self.cog, next_player["id"])
            
            # Odeslání embedu s mapou
            await interaction.followup.send(file=map_file, embed=embed, view=view, ephemeral=True)
    
    async def map_all_callback(self, interaction):
        """Callback pro tlačítko zobrazení mapy všech hráčů"""
        await interaction.response.defer(ephemeral=True)
        
        # Vytvoření obrázku mapy se všemi hráči
        image_bytes = self.cog.create_map_image_with_players()
        
        if not image_bytes:
            await interaction.followup.send("Nepodařilo se vytvořit obrázek mapy.", ephemeral=True)
            return
        
        # Vytvoření souboru z obrázku
        map_file = nextcord.File(image_bytes, filename="all_players_map.png")
        
        # Vytvoření embedu s informacemi
        embed = nextcord.Embed(
            title="Mapa všech online hráčů",
            description=f"Celkem online: {len(self.cog.player_data)} hráčů",
            color=nextcord.Color.blue()
        )
        
        embed.set_image(url="attachment://all_players_map.png")
        embed.set_footer(text=f"Aktualizováno: {datetime.datetime.now().strftime('%H:%M:%S')}")
        
        # Odeslání embedu s mapou
        await interaction.followup.send(file=map_file, embed=embed, ephemeral=True)
    
    async def list_players_callback(self, interaction):
        """Callback pro tlačítko seznamu hráčů"""
        await interaction.response.defer(ephemeral=True)
        
        # Použijeme hraci příkaz pro zobrazení seznamu
        await self.cog.hraci(interaction)


class SearchResultsUI(nextcord.ui.View):
    """UI pro výběr hráče z výsledků vyhledávání"""
    
    def __init__(self, cog, players, timeout=300):
        super().__init__(timeout=timeout)
        self.cog = cog
        self.players = players
        
        # Přidání select menu pro výběr hráče
        self.add_select_menu()
def add_select_menu(self):
        """Přidá select menu pro výběr hráče z výsledků vyhledávání"""
        # Vytvoření options pro select menu (max. 25 položek)
        options = []
        for player in self.players[:25]:  # Discord limit 25 options
            options.append(
                nextcord.SelectOption(
                    label=f"{player['name']} ({player['class']})"[:100],  # Omezení délky
                    value=player["id"],
                    description=f"G: {player['growth']:.0f}% | H: {player['health']:.0f}% | {player['coords']['formatted']}"[:100]
                )
            )
        
        # Vytvoření select menu
        select = nextcord.ui.Select(
            placeholder="Vyberte hráče pro zobrazení detailů a mapy",
            options=options
        )
        
        # Nastavení callbacku
        select.callback = self.select_callback
        
        # Přidání select menu do view
        self.add_item(select)
    
async def select_callback(self, interaction):
        """Callback pro výběr hráče ze select menu"""
        await interaction.response.defer(ephemeral=True)
        
        # Získání ID vybraného hráče
        player_id = interaction.data["values"][0]
        
        # Hledání hráče v datech
        player_info = None
        for player in self.cog.player_data:
            if player["id"] == player_id:
                player_info = player
                break
        
        if not player_info:
            await interaction.followup.send("Hráč již není online.", ephemeral=True)
            return
        
        # Vytvoření obrázku mapy s označenou pozicí hráče
        image_bytes = self.cog.create_map_image_with_players(selected_player_id=player_id, crop_area=2000)
        
        if not image_bytes:
            await interaction.followup.send("Nepodařilo se vytvořit obrázek mapy.", ephemeral=True)
            return
        
        # Vytvoření souboru z obrázku
        map_file = nextcord.File(image_bytes, filename="player_map.png")
        
        # Vytvoření embedu s informacemi
        embed = self.cog.create_location_embed(player_info)
        embed.set_image(url="attachment://player_map.png")
        
        # Vytvoření UI pro navigaci mezi hráči
        view = PlayerNavigationUI(self.cog, player_info["id"])
        
        # Odeslání embedu s mapou
        await interaction.followup.send(file=map_file, embed=embed, view=view, ephemeral=True)


class DinoStatisticsUI(nextcord.ui.View):
    """UI pro zobrazení hráčů podle druhu dinosaura"""
    
    def __init__(self, cog, dino_stats, timeout=300):
        super().__init__(timeout=timeout)
        self.cog = cog
        self.dino_stats = dino_stats
        
        # Přidání select menu pro výběr druhu dinosaura
        self.add_dino_select()
    
    def add_dino_select(self):
        """Přidá select menu pro výběr druhu dinosaura"""
        # Vytvoření options pro select menu
        options = []
        for dino, count in self.dino_stats:
            options.append(
                nextcord.SelectOption(
                    label=f"{dino} ({count})",
                    value=dino,
                    description=f"Zobrazit všechny hráče s tímto druhem dinosaura"
                )
            )
        
        # Omezení na 25 položek (Discord limit)
        options = options[:25]
        
        # Přidání možnosti zobrazit všechny
        if len(self.dino_stats) > 1:
            options.append(
                nextcord.SelectOption(
                    label="Všechny druhy",
                    value="all",
                    description="Zobrazit všechny hráče bez ohledu na druh"
                )
            )
        
        # Vytvoření select menu
        select = nextcord.ui.Select(
            placeholder="Vyberte druh dinosaura pro zobrazení hráčů",
            options=options
        )
        
        # Nastavení callbacku
        select.callback = self.select_callback
        
        # Přidání select menu do view
        self.add_item(select)
    
    async def select_callback(self, interaction):
        """Callback pro výběr druhu dinosaura"""
        await interaction.response.defer(ephemeral=True)
        
        # Získání vybraného druhu
        selected_dino = interaction.data["values"][0]
        
        # Filtrování hráčů podle druhu
        if selected_dino == "all":
            filtered_players = self.cog.player_data
        else:
            filtered_players = [p for p in self.cog.player_data if p["class"] == selected_dino]
        
        # Kontrola, zda jsou k dispozici hráči
        if not filtered_players:
            await interaction.followup.send("Žádní hráči tohoto druhu nejsou online.", ephemeral=True)
            return
        
        # Vytvoření embedu se seznamem hráčů
        embed = nextcord.Embed(
            title=f"Hráči druhu: {selected_dino if selected_dino != 'all' else 'Všechny druhy'}",
            description=f"Celkem nalezeno: {len(filtered_players)} hráčů",
            color=nextcord.Color.green()
        )
        
        # Přidání UI pro výběr hráče
        view = PlayerListUI(self.cog, filtered_players)
        
        # Odeslání embedu s UI
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)


def setup(bot):
    """Přidá tento cog do bota"""
    cog = PlayerMapCog(bot)
    bot.add_cog(cog)
    
    # Automatické zjištění application commands
    if not hasattr(bot, "all_slash_commands"):
        bot.all_slash_commands = []
    
    # Toto vyhledá všechny metody, které jsou application commands
    for command in cog.application_commands:
        print(f"Přidávám command: {command.name}")
        bot.all_slash_commands.append(command)