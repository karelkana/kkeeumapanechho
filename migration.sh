#!/bin/bash
# migration.sh - Skript pro migraci databáze friends

echo "🔄 Spouštím migraci databáze friends..."

DB_PATH="data/friends.db"

# Zkontroluj, zda databáze existuje
if [ ! -f "$DB_PATH" ]; then
    echo "❌ Databáze $DB_PATH neexistuje"
    exit 1
fi

echo "📋 Kontrola aktuální struktury tabulky friends..."
sqlite3 "$DB_PATH" ".schema friends"

echo ""
echo "🔄 Přidávání chybějících sloupců..."

# Přidej user_name sloupec, pokud neexistuje
sqlite3 "$DB_PATH" "ALTER TABLE friends ADD COLUMN user_name TEXT;" 2>/dev/null && echo "✅ Sloupec user_name přidán" || echo "⚠️ Sloupec user_name už existuje nebo nastala chyba"

# Přidej friend_name sloupec, pokud neexistuje
sqlite3 "$DB_PATH" "ALTER TABLE friends ADD COLUMN friend_name TEXT;" 2>/dev/null && echo "✅ Sloupec friend_name přidán" || echo "⚠️ Sloupec friend_name už existuje nebo nastala chyba"

echo ""
echo "📋 Nová struktura tabulky friends:"
sqlite3 "$DB_PATH" ".schema friends"

echo ""
echo "✅ Migrace dokončena!"
echo "🚀 Nyní můžeš spustit server: node server.js"