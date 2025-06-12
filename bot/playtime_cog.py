import nextcord
from nextcord.ext import commands, tasks
import logging
import json
import os
import asyncio
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Dict, List, Tuple, Optional
from util.config import HOUR_STATS, DEFAULT_GUILDS

class PlaytimeTracker(commands.Cog):
    """
    Cog for tracking and displaying player playtime statistics.
    Shows top 10 players by playtime and allows individual playtime lookup via command.
    """
    def __init__(self, bot):
        self.bot = bot
        self.active_players_cog = None
        self.stats_channel_id = HOUR_STATS
        self.playtime_stats = defaultdict(lambda: {"total_minutes": 0, "player_name": "", "last_seen": None, "online": False})
        self.stats_file = "playtime_stats.json"
        self.stats_message = None
        
        # Load existing statistics if file exists
        self.load_stats()
        
        # Task loops
        self.update_stats_message.start()
        self.save_stats_periodic.start()
        self.track_active_players.start()

    def cog_unload(self):
        """Called when the cog is unloaded"""
        self.update_stats_message.cancel()
        self.save_stats_periodic.cancel()
        self.track_active_players.cancel()
        self.save_stats()  # Save statistics when shutting down
    
    def load_stats(self):
        """Load statistics from file"""
        try:
            if os.path.exists(self.stats_file):
                with open(self.stats_file, 'r') as f:
                    data = json.load(f)
                    for player_id, stats in data.items():
                        # Ensure the structure is correct and contains all necessary keys
                        player_stats = {
                            "total_minutes": stats.get("total_minutes", 0),
                            "player_name": stats.get("player_name", ""),
                            "last_seen": stats.get("last_seen"),
                            "online": False  # Always set to False on startup
                        }
                        
                        self.playtime_stats[player_id] = player_stats
                logging.info(f"Playtime statistics loaded from file {self.stats_file}")
        except Exception as e:
            logging.error(f"Error loading playtime statistics: {e}")
    
    def save_stats(self):
        """Save statistics to file"""
        try:
            with open(self.stats_file, 'w') as f:
                json.dump(self.playtime_stats, f, indent=4)
            logging.info(f"Playtime statistics saved to file {self.stats_file}")
        except Exception as e:
            logging.error(f"Error saving playtime statistics: {e}")

    @tasks.loop(minutes=10)
    async def save_stats_periodic(self):
        """Periodically save statistics to file"""
        self.save_stats()
    
    def get_active_players_cog(self):
        """Get the ActivePlayersRCON cog reference"""
        if self.active_players_cog is None:
            self.active_players_cog = self.bot.get_cog("ActivePlayersRCON")
        return self.active_players_cog
    
    @tasks.loop(minutes=3)
    async def track_active_players(self):
        """Track active players and update their playtime every 1 minute"""
        active_players_cog = self.get_active_players_cog()
        if active_players_cog is None:
            logging.warning("ActivePlayersRCON cog not found. Cannot track players.")
            return
        
        try:
            # Get raw playerlist from RCON
            response = await active_players_cog.get_player_list()
            if response is None:
                logging.error("Failed to get player list from RCON")
                return
            
            # Parse player names
            current_players = active_players_cog.parse_player_list(response)
            current_time = datetime.now().isoformat()
            
            # First, mark all players as offline
            for player_id, stats in self.playtime_stats.items():
                if stats["online"]:
                    # If the player was online before, update their playtime
                    # before marking them as offline
                    self.playtime_stats[player_id]["online"] = False
            
            # Extract Steam ID from player list and update online status
            for player_name in current_players:
                # Try to find Steam ID from player name matching in our records
                player_id = self.find_player_id_by_name(player_name)
                
                if player_id:
                    # Update existing player
                    if not self.playtime_stats[player_id]["online"]:
                        # Player just came online
                        self.playtime_stats[player_id]["online"] = True
                        self.playtime_stats[player_id]["last_seen"] = current_time
                    else:
                        # Player was already online, add 1 minute to their playtime
                        self.playtime_stats[player_id]["total_minutes"] += 1
                else:
                    # New player, create record with default values
                    # We'll create a temporary ID based on the name until we can associate with Steam ID
                    temp_id = f"temp_{player_name}"
                    self.playtime_stats[temp_id] = {
                        "total_minutes": 0,
                        "player_name": player_name,
                        "last_seen": current_time,
                        "online": True
                    }
            
            # Update total minutes for all online players
            for player_id, stats in self.playtime_stats.items():
                if stats["online"]:
                    self.playtime_stats[player_id]["total_minutes"] += 1
        
        except Exception as e:
            logging.error(f"Error tracking active players: {e}")
            import traceback
            logging.error(traceback.format_exc())
    
    def find_player_id_by_name(self, player_name):
        """Find a player's ID by their name"""
        # First check for exact matches
        for player_id, stats in self.playtime_stats.items():
            if stats["player_name"].lower() == player_name.lower():
                return player_id
                
        # If no exact match, check for temporary IDs based on player name
        temp_id = f"temp_{player_name}"
        if temp_id in self.playtime_stats:
            return temp_id
            
        return None
    
    def get_top_players(self, limit=10):
        """Return top X players by playtime"""
        sorted_stats = sorted(
            [(id, stats) for id, stats in self.playtime_stats.items() if stats["total_minutes"] > 0],
            key=lambda x: x[1]["total_minutes"],
            reverse=True
        )
        return sorted_stats[:limit]
    
    def get_player_stats(self, player_id):
        """Return statistics for a specific player"""
        # First, try to find the player with exact ID match
        if player_id in self.playtime_stats:
            stats = self.playtime_stats[player_id]
            logging.info(f"Found player stats for Steam ID {player_id}: {stats}")
            return stats
            
        # If not found, check if it's a temp ID by looking at player names
        for id, stats in self.playtime_stats.items():
            # Check if player name matches the given ID (for case when user enters name instead of ID)
            if stats["player_name"].lower() == player_id.lower():
                logging.info(f"Found player stats by name match: {player_id} -> {id}")
                return stats
                
            # Check if the ID is contained in the temp_id
            if id.startswith("temp_") and player_id.lower() in id.lower():
                logging.info(f"Found player stats in temporary ID: {id}")
                return stats
                
        # If still not found, return empty stats
        logging.info(f"No stats found for player {player_id}, returning default")
        return {"total_minutes": 0, "player_name": player_id, "last_seen": None, "online": False}
    
    def format_playtime(self, minutes):
        """Format minutes as hours and minutes"""
        hours = minutes // 60
        remaining_minutes = minutes % 60
        return f"{hours}h {remaining_minutes}min"
    
    async def create_stats_embed(self):
        """Create an embed message with top 10 players by playtime"""
        embed = nextcord.Embed(
            title="⏱️ The Isle - Top Players by Playtime",
            description="Statistics of the most dedicated players on the server",
            color=nextcord.Color.blue()  # Blue to differentiate from kill stats
        )
        
        embed.set_footer(text=f"Last updated: {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}")
        
        top_players = self.get_top_players(10)
        
        if not top_players:
            embed.add_field(name="No statistics", value="There are no playtime records yet", inline=False)
            # Still add the online count field even when no players have stats
            embed.add_field(name="Currently Online", value="0 players", inline=False)
            return embed
            
        value_text = ""
        for i, (player_id, stats) in enumerate(top_players, 1):
            player_name = stats["player_name"] or f"Player {player_id}"
            formatted_time = self.format_playtime(stats["total_minutes"])
            
            # Add online status indicator
            status_indicator = "🟢" if stats["online"] else "🔴"
            
            value_text += f"{status_indicator} **{player_name}** \"{formatted_time}\"\n"
        
        embed.add_field(name="Leaderboard", value=value_text, inline=False)
        
        # Add current online count
        online_count = sum(1 for stats in self.playtime_stats.values() if stats["online"])
        embed.add_field(name="Currently Online", value=f"{online_count} players", inline=False)
        
        return embed
    
    async def create_player_stats_embed(self, player_id):
        """Create an embed message with detailed player statistics"""
        stats = self.get_player_stats(player_id)
        player_name = stats["player_name"] or player_id
        
        # Format playtime
        formatted_time = self.format_playtime(stats["total_minutes"])
        
        # Calculate date from the last_seen ISO string if it exists
        last_seen_str = "Never"
        if stats["last_seen"]:
            try:
                last_seen_date = datetime.fromisoformat(stats["last_seen"])
                last_seen_str = last_seen_date.strftime("%d.%m.%Y %H:%M:%S")
            except (ValueError, TypeError):
                pass
        
        embed = nextcord.Embed(
            title=f"Playtime Statistics for {player_name}",
            color=nextcord.Color.blue()
        )
        
        # Online status
        status = "🟢 Online" if stats["online"] else "🔴 Offline"
        embed.add_field(name="Status", value=status, inline=True)
        
        # Total playtime
        embed.add_field(name="Total Playtime", value=formatted_time, inline=True)
        
        # Last seen
        if not stats["online"]:
            embed.add_field(name="Last Seen", value=last_seen_str, inline=True)
        
        # Only look for rank if player has playtime
        if stats["total_minutes"] > 0:
            # Find rank in leaderboard
            sorted_stats = sorted(
                [(id, st) for id, st in self.playtime_stats.items() if st["total_minutes"] > 0],
                key=lambda x: x[1]["total_minutes"],
                reverse=True
            )
            
            rank = next((i for i, (pid, _) in enumerate(sorted_stats, 1) if pid == player_id or (isinstance(pid, str) and player_id.lower() in pid.lower())), None)
            if rank:
                embed.add_field(name="Leaderboard Rank", value=f"#{rank} of {len(sorted_stats)}", inline=False)
        
        # Footer varies based on if the original ID was used or we found a match
        if player_id in self.playtime_stats:
            footer_text = f"Steam ID: {player_id} | Updated: {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}"
        else:
            footer_text = f"Player: {player_name} | Updated: {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}"
            
        embed.set_footer(text=footer_text)
        return embed
    
    async def setup_embed(self):
        """Set up the embed message - find existing or create new"""
        channel = self.bot.get_channel(self.stats_channel_id)
        if channel is None:
            logging.error(f"Channel with ID {self.stats_channel_id} not found!")
            return
        
        logging.info(f"Setting up playtime embed in channel {channel.name} ({self.stats_channel_id})")
        
        # Check if channel already has playtime messages from this bot
        message_found = False
        async for message in channel.history(limit=20):
            if (message.author == self.bot.user and message.embeds and 
                len(message.embeds) > 0 and
                "The Isle - Top Players by Playtime" in message.embeds[0].title):
                self.stats_message = message
                logging.info(f"Found existing playtime embed message: {self.stats_message.id}")
                message_found = True
                break
        
        # If no message found, create a new one
        if not message_found:
            # Create and send new embed
            embed = await self.create_stats_embed()
            try:
                # First check for the kill stats message and send after it
                kill_stats_found = False
                async for message in channel.history(limit=10):
                    if (message.author == self.bot.user and message.embeds and 
                        len(message.embeds) > 0 and
                        "Top 10 Killers" in message.embeds[0].title):
                        kill_stats_found = True
                        # Send one empty line after kill stats for spacing
                        await channel.send("_ _")
                        self.stats_message = await channel.send(embed=embed)
                        logging.info(f"Created new playtime embed message after kill stats: {self.stats_message.id}")
                        break
                
                # If kill stats not found, just send normally
                if not kill_stats_found:
                    self.stats_message = await channel.send(embed=embed)
                    logging.info(f"Created new playtime embed message: {self.stats_message.id}")
            except Exception as e:
                logging.error(f"Error creating playtime message: {e}")
        
        # Update the embed content
        await self.update_embed_content()
    
    async def update_embed_content(self):
        """Update the embed with current data"""
        if not self.stats_message:
            logging.warning("No stats message to update, setting up a new one")
            await self.setup_embed()
            return
            
        try:
            embed = await self.create_stats_embed()
            await self.stats_message.edit(embed=embed)
            logging.info("Updated playtime stats embed")
        except Exception as e:
            logging.error(f"Error updating playtime embed: {e}")
            # Reset message reference and try to set up again
            self.stats_message = None
            await self.setup_embed()
    
    @tasks.loop(minutes=1)
    async def update_stats_message(self):
        """Update the message with top 10 players by playtime every 1 minute"""
        try:
            channel = self.bot.get_channel(self.stats_channel_id)
            if not channel:
                logging.error("Stats channel not found.")
                return
                
            # If message doesn't exist, set it up
            if not self.stats_message:
                await self.setup_embed()
            else:
                # Try to update the existing message
                try:
                    await self.update_embed_content()
                except (nextcord.NotFound, nextcord.HTTPException) as e:
                    logging.error(f"Error updating message: {e}")
                    # Message was deleted, create a new one
                    self.stats_message = None
                    await self.setup_embed()
                    
        except Exception as e:
            logging.error(f"Error updating stats message: {e}")
    
    @track_active_players.before_loop
    @update_stats_message.before_loop
    async def before_loop(self):
        await self.bot.wait_until_ready()
    
    @commands.Cog.listener()
    async def on_ready(self):
        """Called when the bot is ready"""
        logging.info("PlaytimeTracker cog is ready!")
        # Wait longer before setting up the embed to ensure all services are ready
        # and to let other cogs initialize first
        await asyncio.sleep(30)  # Increased to 30 seconds
        
        # Get and log channel info
        channel = self.bot.get_channel(self.stats_channel_id)
        if channel:
            logging.info(f"Playtime stats channel found: {channel.name} ({self.stats_channel_id})")
        else:
            logging.error(f"Playtime stats channel NOT found: {self.stats_channel_id}")
            
        await self.setup_embed()
        logging.info("Forced playtime stats message update on bot start")
    
    @nextcord.slash_command(name="hours", description="View player playtime statistics")
    async def show_hours(self, 
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
        View playtime statistics for a player by name or Steam ID
        
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
        player_identifier = steam_id if steam_id else name
        
        # Look up player stats
        embed = await self.create_player_stats_embed(player_identifier)
        
        # Display information about finding players if not found
        if embed.fields[0].value == "0h 0min" and embed.title == f"Playtime Statistics for {player_identifier}":
            embed.add_field(
                name="Player Not Found", 
                value=(
                    "This player wasn't found in our records. Possible reasons:\n"
                    "• The player hasn't joined the server yet\n"
                    "• You might have mistyped the name or Steam ID\n"
                    "• The player might need to link their Steam ID using `/linksteam`"
                ), 
                inline=False
            )
        
        await interaction.response.send_message(embed=embed, ephemeral=True)
    
    @nextcord.slash_command(name="resetplaytime", description="Reset playtime statistics (Admin only)", guild_ids=DEFAULT_GUILDS)
    async def reset_playtime(self, interaction: nextcord.Interaction, confirm: str = nextcord.SlashOption(
        name="confirm",
        description="Type 'CONFIRM' to reset all statistics",
        required=True
    )):
        """
        Reset all playtime statistics (admin only)
        
        Parameters
        -----------
        confirm: str
            Must be "CONFIRM" to confirm the action
        """
        # Check permissions - user must have administrator permissions
        if not interaction.user.guild_permissions.administrator:
            await interaction.response.send_message("You don't have permission to use this command. Administrator permission is required.", ephemeral=True)
            return
            
        # Check confirmation
        if confirm != "CONFIRM":
            await interaction.response.send_message("Operation canceled. You must type 'CONFIRM' to reset statistics.", ephemeral=True)
            return
            
        # Reset statistics - clear dictionary but preserve defaultdict functionality
        self.playtime_stats.clear()
        
        # Save empty statistics to file
        try:
            # Delete statistics file completely and create a new empty one
            with open(self.stats_file, 'w') as f:
                json.dump({}, f)
                
            logging.info(f"Playtime statistics file reset successfully by {interaction.user.name}")
        except Exception as e:
            logging.error(f"Error resetting statistics file: {e}")
            await interaction.response.send_message("Error resetting statistics file. Check logs for details.", ephemeral=True)
            return
        
        # Update displayed message
        await self.update_stats_message()
        
        # Information about successful reset
        await interaction.response.send_message("All playtime statistics have been reset successfully!", ephemeral=True)
        logging.info(f"Playtime statistics reset by {interaction.user.name} (ID: {interaction.user.id})")
    
    @nextcord.slash_command(name="linksteam", description="Link your Steam ID to your player name")
    async def link_steam(self, interaction: nextcord.Interaction, steam_id: str, player_name: str):
        """
        Link a Steam ID to a player name to properly track playtime
        
        Parameters
        -----------
        steam_id: str
            Your Steam ID
        player_name: str
            Your in-game player name
        """
        # Check if this player name exists in our records
        temp_id = f"temp_{player_name}"
        
        # If there's a temporary record, update it
        if temp_id in self.playtime_stats:
            # Transfer playtime stats from temp to permanent ID
            temp_stats = self.playtime_stats[temp_id]
            self.playtime_stats[steam_id] = {
                "total_minutes": temp_stats["total_minutes"],
                "player_name": player_name,
                "last_seen": temp_stats["last_seen"],
                "online": temp_stats["online"]
            }
            # Remove temp record
            del self.playtime_stats[temp_id]
            await interaction.response.send_message(f"Successfully linked Steam ID {steam_id} to player {player_name}!", ephemeral=True)
        else:
            # Create a new record
            self.playtime_stats[steam_id] = {
                "total_minutes": 0,
                "player_name": player_name,
                "last_seen": datetime.now().isoformat(),
                "online": False
            }
            await interaction.response.send_message(f"Created new record linking Steam ID {steam_id} to player {player_name}!", ephemeral=True)
        
        # Save stats and update message
        self.save_stats()
        await self.update_stats_message()

def setup(bot):
    bot.add_cog(PlaytimeTracker(bot))