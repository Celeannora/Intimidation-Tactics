#!/usr/bin/env python3
"""
Update g_default_settings.json weights to produce a natural OSRS progression.

Weight scale:
  <= 0 : Disabled / "only if strictly required"
  1-3  : Low priority
  4-6  : Medium priority
  7-9  : High priority (core progression for early/mid game)
  10+  : Top priority (only a few key early unlocks)
"""

import re
import json

INPUT_PATH = r"C:\Users\Administrator\DreamBot\Scripts\gaioaccountbuilder\g_default_settings.json"
OUTPUT_PATH = INPUT_PATH  # Overwrite in-place

# Read the file as text to do precise string replacements
with open(INPUT_PATH, "r", encoding="utf-8") as f:
    content = f.read()

# Parse to validate JSON structure
original_json = json.loads(content)

# ============================================================
# WEIGHT UPDATES
# Each entry: (exact_key_string, new_value)
# ============================================================

updates = []

# --- SKILL WEIGHTS (G_AIO_BUILDER_KEY_*_WEIGHT) ---
# Top-level skill category weights. These govern how much the planner
# wants to train each skill overall.
skill_weights = [
    ("G_AIO_BUILDER_KEY_QUESTING_WEIGHT", 8),
    ("G_AIO_BUILDER_KEY_AGILITY_WEIGHT", 5),
    ("G_AIO_BUILDER_KEY_THIEVING_WEIGHT", 5),
    ("G_AIO_BUILDER_KEY_HUNTER_WEIGHT", 4),
    ("G_AIO_BUILDER_KEY_HERBLORE_WEIGHT", 6),
    ("G_AIO_BUILDER_KEY_RANGED_WEIGHT", 6),
    ("G_AIO_BUILDER_KEY_STRENGTH_WEIGHT", 6),
    ("G_AIO_BUILDER_KEY_DEFENCE_WEIGHT", 5),
    ("G_AIO_BUILDER_KEY_ATTACK_WEIGHT", 6),
    ("G_AIO_BUILDER_KEY_MAGIC_WEIGHT", 6),
    ("G_AIO_BUILDER_KEY_MINIGAMES_WEIGHT", 5),
    ("G_AIO_BUILDER_KEY_FISHING_WEIGHT", 5),
    ("G_AIO_BUILDER_KEY_COOKING_WEIGHT", 5),
    ("G_AIO_BUILDER_KEY_WOODCUTTING_WEIGHT", 5),
    ("G_AIO_BUILDER_KEY_FLETCHING_WEIGHT", 4),
    ("G_AIO_BUILDER_KEY_FARMING_WEIGHT", 5),
    ("G_AIO_BUILDER_KEY_MINING_WEIGHT", 4),
    ("G_AIO_BUILDER_KEY_SMITHING_WEIGHT", 4),
    ("G_AIO_BUILDER_KEY_FIREMAKING_WEIGHT", 3),
    ("G_AIO_BUILDER_KEY_CRAFTING_WEIGHT", 4),
    ("G_AIO_BUILDER_KEY_RUNECRAFTING_WEIGHT", 4),
    ("G_AIO_BUILDER_KEY_CONSTRUCTION_WEIGHT", 4),
    ("G_AIO_BUILDER_KEY_PRAYER_WEIGHT", 5),
    ("G_AIO_BUILDER_KEY_SLAYER_WEIGHT", 5),
    ("G_AIO_BUILDER_KEY_SAILING_WEIGHT", 3),
    ("G_AIO_BUILDER_KEY_BOSSES_WEIGHT", 3),
    ("G_AIO_BUILDER_KEY_HITPOINTS_WEIGHT", 5),
    ("G_AIO_BUILDER_KEY_GOLD FARMING_WEIGHT", 2),
]

# --- ACTIVITY/METHOD WEIGHTS (long composite keys) ---
# Format: G_AIO_BUILDER_KEY_PRIMARY_KEY_GENERALG_AIO_BUILDER_KEY_SECONDARY_KEY_<ACTIVITY>_WEIGHT
activity_weights = [
    # === EARLY GAME - High Priority (7-9) ===
    ("_SAND_CRABS_WEIGHT", 8),    # Iconic early training
    ("_SWAMP_CRABS_WEIGHT", 7),
    ("_ROCK_CRABS_WEIGHT", 7),
    ("_AMMONITE_CRABS_WEIGHT", 7),
    ("_FROST_CRABS_WEIGHT", 6),   # Slightly lower than other crabs
    ("_GENERAL_COMBAT_WEIGHT", 7),

    # === EARLY-MID Game - Medium to Medium-High (5-6) ===
    ("_WINTERTODT_WEIGHT", 6),     # Early firemaking + supplies
    ("_MAHOGANY_HOMES_WEIGHT", 6), # Construction without carpal tunnel
    ("_REGULAR_PRAYER_WEIGHT", 6),
    ("_DEFENDERS_WEIGHT", 6),      # Core early unlock
    ("_REGULAR_FISHING_WEIGHT", 5),
    ("_REGULAR_COOKING_WEIGHT", 5),
    ("_OBOR_WEIGHT", 5),
    ("_BRYOPHYTA_WEIGHT", 5),
    ("_SCURRIUS_WEIGHT", 5),
    ("_BIRDHOUSES_WEIGHT", 5),     # Early Hunter + bird nests
    ("_REGULAR_FARMING_WEIGHT", 5),
    ("_REGULAR_AGILITY_WEIGHT", 5),
    ("_GF_COMBAT_WEIGHT", 5),
    ("_TEMPOROSS_WEIGHT", 5),      # Early fishing

    # === MID GAME - Medium (4-6) ===
    ("_NMZ_WEIGHT", 6),            # Mid-game combat training
    ("_PEST_CONTROL_WEIGHT", 6),   # Mid-game void/training
    ("_REGULAR_SLAYER_WEIGHT", 6),
    ("_BLAST_FURNACE_WEIGHT", 5),
    ("_GIANTS_FOUNDRY_WEIGHT", 5),
    ("_GOTR_WEIGHT", 5),           # Runecrafting minigame
    ("_MOONS_WEIGHT", 5),          # Mid-game boss content
    ("_REGULAR_THIEVING_WEIGHT", 5),
    ("_BARBARIAN_ASSAULT_WEIGHT", 4),
    ("_TITHE_FARM_WEIGHT", 4),
    ("_MTA_WEIGHT", 4),            # Mage Training Arena
    ("_REGULAR_RUNECRAFTING_WEIGHT", 4),
    ("_REGULAR_CONSTRUCTION_WEIGHT", 4),
    ("_AERIAL_FISHING_WEIGHT", 4),
    ("_PYRAMID_PLUNDER_WEIGHT", 4),
    ("_REGULAR_HUNTER_WEIGHT", 4),
    ("_PURO_PURO_WEIGHT", 4),
    ("_UNDERWATER_AGILITY_WEIGHT", 4),
    ("_BRIMHAVEN_AGILITY_WEIGHT", 4),
    ("_REGULAR_FM_WEIGHT", 4),
    ("_ARC_LIBRARY_RUNECRAFT_WEIGHT", 4),
    ("_CHINNING_WEIGHT", 4),
    ("_KARAMBWAN_FISHING_WEIGHT", 4),
    ("_REGULAR_SMITHING_WEIGHT", 4),
    ("_SMELTING_WEIGHT", 4),
    ("_AERIAL_HUNTER_WEIGHT", 4),
    ("_REGULAR_HERBLORE_WEIGHT", 4),
    ("_ROGUES_DEN_WEIGHT", 4),
    ("_BARROWS_WEIGHT", 4),
    ("_SULPHUR_NAGUA_WEIGHT", 4),

    # === LATE GAME - Medium-Low (3) ===
    ("_SCORPIA_WEIGHT", 2),
    ("_CHAOS_ELE_WEIGHT", 2),
    ("_CRAZY_ARCH_WEIGHT", 2),
    ("_FROST_DRAGONS_WEIGHT", 2),
    ("_LAVA_DRAGONS_WEIGHT", 2),
    ("_KBD_WEIGHT", 2),
    ("_CHAOS_FANATIC_WEIGHT", 2),
    ("_DERANGED_ARCH_WEIGHT", 2),
    ("_AMOXLIATL_WEIGHT", 3),
    ("_MAGE_ARENA_1_WEIGHT", 3),
    ("_FIGHT_CAVES_WEIGHT", 3),
    ("_MANIACAL_MONKEYS_WEIGHT", 3),
    ("_GEMSTONE_CRAB_WEIGHT", 3),
    ("_ENSOULED_HEADS_WEIGHT", 3),
    ("_TELE_ALCH_STUN_WEIGHT", 3),
    ("_DRIFTNET_FISHING_WEIGHT", 3),
    ("_MIXOLOGY_HERBLORE_WEIGHT", 3),
    ("_DRIFTNET_HUNTER_WEIGHT", 3),
    ("_UNDERWATER_THIEVING_WEIGHT", 3),
    ("_TOTEM_FLETCHING_WEIGHT", 3),
    ("_ARC_LIBRARY_MAGIC_WEIGHT", 3),
    ("_MESS_HALL_COOKING_WEIGHT", 3),
    ("_CLUE_SCROLL_WEIGHT", 3),
    ("_PRODUCE_ORBS_WEIGHT", 3),
    ("_SUPERGLASS_MONEY_WEIGHT", 3),
    ("_SUPERGLASS_MAGIC_WEIGHT", 2),
    ("_SCATTER_ASHES_WEIGHT", 2),
    ("_SOUL_WARS_WEIGHT", 2),
    ("_WILDERNESS_AGILITY_WEIGHT", 2),
    ("_FISHING_TRAWLER_WEIGHT", 2),
    ("_PRODUCE_ULTRACOMPOST_WEIGHT", 2),
    ("_COLLECT_FUNGI_WEIGHT", 2),
    ("_CLEAN_FINDS_SLAYER_WEIGHT", 2),
    ("_RUMOURS_WEIGHT", 2),
    ("_PLANK_RUNNING_MONEY_WEIGHT", 2),
    ("_PLANK_MAKE_MONEY_WEIGHT", 2),
    ("_PLANK_MAKE_MAGIC_WEIGHT", 2),
    ("_GOLD FARMING_WEIGHT", 2),

    # === LOW PRIORITY / NICHE (1) ===
    ("_PICK_POTATOES_WEIGHT", 1),
    ("_SHEAR_SHEEP_WEIGHT", 1),
    ("_COLLECT_WINES_WEIGHT", 1),
    ("_COLLECT_CLIMBING_BOOTS_WEIGHT", 1),
    ("_GRAB_SPADES_WEIGHT", 1),
    ("_PICKUP_WEIGHT", 1),
    ("_GENERAL_STORE_WEIGHT", 1),
    ("_WYNDINFOODSTORE_WEIGHT", 1),
    ("_BRUTUS_WEIGHT", 1),
    ("_EMIRS_WEIGHT", 1),
    ("_RUMOURS_MONEY_WEIGHT", 1),
]

# Build the full search/replace list
# For simple skill weights: exact match
for key, val in skill_weights:
    # Match the exact key pattern followed by : -1 or : -1 (with space)
    old = f'"{key}": -1'
    new = f'"{key}": {val}'
    if old in content:
        content = content.replace(old, new)
        updates.append((key, val))
    else:
        print(f"WARNING: Could not find key '{key}'")

# For activity weights: these are the long composite keys
# Pattern: "G_AIO_BUILDER_KEY_PRIMARY_KEY_GENERALG_AIO_BUILDER_KEY_SECONDARY_KEY_<ACTIVITY>_WEIGHT": -1
for suffix, val in activity_weights:
    # Build the middle part
    prefix = 'G_AIO_BUILDER_KEY_PRIMARY_KEY_GENERALG_AIO_BUILDER_KEY_SECONDARY_KEY'
    full_key = f'{prefix}{suffix}'
    old = f'"{full_key}": -1'
    new = f'"{full_key}": {val}'
    if old in content:
        content = content.replace(old, new)
        updates.append((full_key, val))
    else:
        # Try without the secondary key suffix but with full key
        print(f"WARNING: Could not find key '{full_key}'")

# ============================================================
# VALIDATE: Ensure JSON is still valid
# ============================================================
try:
    updated_json = json.loads(content)
    print(f"JSON is valid. {len(updates)} weight values updated successfully.")
except json.JSONDecodeError as e:
    print(f"ERROR: Invalid JSON after updates: {e}")
    # Find the problematic area
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if f"line {e.lineno}" in str(e) or i == e.lineno - 1:
            print(f"  Line {i+1}: {line[:200]}")
    exit(1)

# ============================================================
# WRITE OUTPUT
# ============================================================
with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write(content)

print(f"Written to {OUTPUT_PATH}")
print(f"\nTotal updates: {len(updates)}")
print("\nUpdated keys:")
for k, v in updates:
    print(f"  {k}: -1 -> {v}")

# Print unchanged AIO_BUILDER_KEY weight keys for reference
unchanged = re.findall(r'"(G_AIO_BUILDER_KEY_\w+_WEIGHT)": -1', content)
print(f"\nKeys still set to -1 (unchanged, {len(unchanged)}):")
for k in unchanged[:20]:
    print(f"  {k}")
if len(unchanged) > 20:
    print(f"  ... and {len(unchanged)-20} more")