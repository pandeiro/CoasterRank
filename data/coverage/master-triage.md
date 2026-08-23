# Master Triage List

Current unresolved items from the original 503-entry coverage checklist.
Generated from `data/coverage/queue.json`.

- Total unresolved items: 59
- Current coverage: see `report.txt` and `queue-summary.md`

## How To Use

- Use `L<number>` as the stable key when adding notes or overrides.
- `rehome_orphaned_coaster`: usually a targeted UPDATE against an existing row in `Other (unknown location)`.
- `rehome_after_park_alias_fix`: usually means the park naming is off, not that the coaster is missing.
- `human_review:*`: needs a person to decide between alias, create, rehome, or ignore.

## rehome_orphaned_coaster

### L441 TRON Lightcycle Power Run @ Shanghai Disneyland

- Action: `rehome_orphaned_coaster`
- Priority: high
- Confidence: 1
- Park match: exact -> Shanghai Disneyland
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park exact: "Shanghai Disneyland" → "Shanghai Disneyland"
  - Coaster NOT at Shanghai Disneyland but found at Other (unknown location) (sim 1.00): "Tron Lightcycle Power Run"

### L302 Powder Keg: A Blast in the Wilderness @ Silver Dollar City

- Action: `rehome_orphaned_coaster`
- Priority: high
- Confidence: 0.9
- Park match: exact -> Silver Dollar City
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park exact: "Silver Dollar City" → "Silver Dollar City"
  - Coaster NOT at Silver Dollar City but found at Other (unknown location) (sim 0.90): "Powder Keg: A Blast into the Wilderness"

### L385 Superman - Ride of Steel @ Six Flags America

- Action: `rehome_orphaned_coaster`
- Priority: high
- Confidence: 1
- Park match: exact -> Six Flags America
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park exact: "Six Flags America" → "Six Flags America"
  - Coaster NOT at Six Flags America but found at Other (unknown location) (sim 1.00): "Superman – Ride of Steel"

### L332 Rollin' Thunder @ Tropic Falls Theme Park

- Action: `rehome_orphaned_coaster`
- Priority: high
- Confidence: 0.82
- Park match: exact -> Tropic Falls Theme Park
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park exact: "Tropic Falls Theme Park" → "Tropic Falls Theme Park"
  - Coaster NOT at Tropic Falls Theme Park but found at Other (unknown location) (sim 0.82): "Rolling Thunder"

## rehome_after_park_alias_fix

### L222 Leviathan @ Sea World

- Action: `rehome_after_park_alias_fix`
- Priority: high
- Confidence: 1
- Park match: exact -> Sea World (Australia)
- Found elsewhere: Sea World
- Evidence:
  - Park exact: "Sea World" → "Sea World (Australia)"
  - Coaster NOT at Sea World (Australia) but found at Sea World (sim 1.00): "Leviathan"

## same_name_collision_or_wrong_park

### L435 Tornado @ Bakken

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Bakken
- Found elsewhere: Coney Island
- Evidence:
  - Park exact: "Bakken" → "Bakken"
  - Coaster NOT at Bakken but found at Coney Island (sim 1.00): "Tornado"

### L81 Desperado @ Buffalo Bill's Resort & Casino

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Buffalo Bill's Resort & Casino
- Found elsewhere: Primm Valley Resorts
- Evidence:
  - Park exact: "Buffalo Bill's Resort & Casino" → "Buffalo Bill's Resort & Casino"
  - Coaster NOT at Buffalo Bill's Resort & Casino but found at Primm Valley Resorts (sim 1.00): "Desperado"

### L380 Storm Coaster @ Dubai Hills Mall

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Dubai Hills Mall
- Found elsewhere: Sea World (Australia)
- Evidence:
  - Park exact: "Dubai Hills Mall" → "Dubai Hills Mall"
  - Coaster NOT at Dubai Hills Mall but found at Sea World (Australia) (sim 1.00): "Storm Coaster"

### L14 Anaconda @ Gold Reef City

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Gold Reef City
- Found elsewhere: Walygator Parc
- Evidence:
  - Park exact: "Gold Reef City" → "Gold Reef City"
  - Coaster NOT at Gold Reef City but found at Walygator Parc (sim 1.00): "Anaconda"

### L311 Racer @ Kings Island

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Kings Island
- Found elsewhere: Kennywood
- Evidence:
  - Park exact: "Kings Island" → "Kings Island"
  - Coaster NOT at Kings Island but found at Kennywood (sim 1.00): "Racer"

### L488 Wood Coaster @ Knight Valley

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: fuzzy -> Lightwater Valley
- Found elsewhere: OCT East
- Evidence:
  - Park fuzzy (0.39): "Knight Valley" → "Lightwater Valley"
  - Coaster NOT at Lightwater Valley but found at OCT East (sim 1.00): "Wood Coaster"

### L73 Cyclone @ Luna Park

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: fuzzy -> Luna Park Sydney
- Found elsewhere: Revere Beach
- Evidence:
  - Park fuzzy (0.59): "Luna Park" → "Luna Park Sydney"
  - Coaster NOT at Luna Park Sydney but found at Revere Beach (sim 1.00): "Cyclone"

### L42 Big Dipper @ Luna Park Sydney

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Luna Park Sydney
- Found elsewhere: Blackpool Pleasure Beach
- Evidence:
  - Park exact: "Luna Park Sydney" → "Luna Park Sydney"
  - Coaster NOT at Luna Park Sydney but found at Blackpool Pleasure Beach (sim 1.00): "Big Dipper"

### L93 Dragon Mountain @ Marineland Theme Park

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: fuzzy -> Lost Island Theme Park
- Found elsewhere: Marineland of Canada
- Evidence:
  - Park fuzzy (0.45): "Marineland Theme Park" → "Lost Island Theme Park"
  - Coaster NOT at Lost Island Theme Park but found at Marineland of Canada (sim 1.00): "Dragon Mountain"

### L167 Hades 360 @ Mount Olympus

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Mount Olympus
- Found elsewhere: Mt. Olympus Water & Theme Park
- Evidence:
  - Park exact: "Mount Olympus" → "Mount Olympus"
  - Coaster NOT at Mount Olympus but found at Mt. Olympus Water & Theme Park (sim 1.00): "Hades 360"

### L350 Silver Comet @ Niagara Amusement Park & Splash World

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: fuzzy -> ZDT's Amusement Park
- Found elsewhere: Fantasy Island
- Evidence:
  - Park fuzzy (0.39): "Niagara Amusement Park & Splash World" → "ZDT's Amusement Park"
  - Coaster NOT at ZDT's Amusement Park but found at Fantasy Island (sim 1.00): "Silver Comet"

### L112 Expedition GeForce @ Plopsaland Deutschland

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: fuzzy -> Plopsaland De Panne
- Found elsewhere: Holiday Park, Germany
- Evidence:
  - Park fuzzy (0.50): "Plopsaland Deutschland" → "Plopsaland De Panne"
  - Coaster NOT at Plopsaland De Panne but found at Holiday Park, Germany (sim 1.00): "Expedition GeForce"

### L298 Pitts Special @ Powerland

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: fuzzy -> Everland
- Found elsewhere: PowerPark
- Evidence:
  - Park fuzzy (0.36): "Powerland" → "Everland"
  - Coaster NOT at Everland but found at PowerPark (sim 1.00): "Pitts Special"

### L205 Junker @ PowerLand

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: fuzzy -> Everland
- Found elsewhere: PowerPark
- Evidence:
  - Park fuzzy (0.36): "PowerLand" → "Everland"
  - Coaster NOT at Everland but found at PowerPark (sim 1.00): "Junker"

### L423 Thunderbird @ PowerLand

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: fuzzy -> Everland
- Found elsewhere: PowerPark
- Evidence:
  - Park fuzzy (0.36): "PowerLand" → "Everland"
  - Coaster NOT at Everland but found at PowerPark (sim 1.00): "Thunderbird"

### L437 Tornado @ Särkänniemi

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Särkänniemi
- Found elsewhere: Coney Island
- Evidence:
  - Park exact: "Särkänniemi" → "Särkänniemi"
  - Coaster NOT at Särkänniemi but found at Coney Island (sim 1.00): "Tornado"

### L239 Manta @ SeaWorld Abu Dhabi

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: fuzzy -> Ferrari World Abu Dhabi
- Found elsewhere: SeaWorld Orlando
- Evidence:
  - Park fuzzy (0.48): "SeaWorld Abu Dhabi" → "Ferrari World Abu Dhabi"
  - Coaster NOT at Ferrari World Abu Dhabi but found at SeaWorld Orlando (sim 1.00): "Manta"

### L248 Medusa @ Six Flags Great Adventure

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Six Flags Great Adventure
- Found elsewhere: Six Flags Discovery Kingdom
- Evidence:
  - Park exact: "Six Flags Great Adventure" → "Six Flags Great Adventure"
  - Coaster NOT at Six Flags Great Adventure but found at Six Flags Discovery Kingdom (sim 1.00): "Medusa"

### L386 Superman - Ultimate Flight @ Six Flags Great Adventure

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Six Flags Great Adventure
- Found elsewhere: Six Flags Discovery Kingdom
- Evidence:
  - Park exact: "Six Flags Great Adventure" → "Six Flags Great Adventure"
  - Coaster NOT at Six Flags Great Adventure but found at Six Flags Discovery Kingdom (sim 1.00): "Superman: Ultimate Flight"

### L387 Superman - Ultimate Flight @ Six Flags Great America

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Six Flags Great America
- Found elsewhere: Six Flags Discovery Kingdom
- Evidence:
  - Park exact: "Six Flags Great America" → "Six Flags Great America"
  - Coaster NOT at Six Flags Great America but found at Six Flags Discovery Kingdom (sim 1.00): "Superman: Ultimate Flight"

### L388 Superman - Ultimate Flight @ Six Flags Over Georgia

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Six Flags Over Georgia
- Found elsewhere: Six Flags Discovery Kingdom
- Evidence:
  - Park exact: "Six Flags Over Georgia" → "Six Flags Over Georgia"
  - Coaster NOT at Six Flags Over Georgia but found at Six Flags Discovery Kingdom (sim 1.00): "Superman: Ultimate Flight"

### L279 Olympia Looping @ Travelling

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Travelling
- Found elsewhere: Oktoberfest
- Evidence:
  - Park exact: "Travelling" → "Travelling"
  - Coaster NOT at Travelling but found at Oktoberfest (sim 1.00): "Olympia Looping"

### L259 Monster @ Walygator Grand Est

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: fuzzy -> Walygator Parc
- Found elsewhere: Gröna Lund
- Evidence:
  - Park fuzzy (0.40): "Walygator Grand Est" → "Walygator Parc"
  - Coaster NOT at Walygator Parc but found at Gröna Lund (sim 1.00): "Monster"

## clone_rehome_from_other

### L119 Flight of Fear @ Kings Dominion

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Kings Dominion
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park exact: "Kings Dominion" → "Kings Dominion"
  - Coaster NOT at Kings Dominion but found at Other (unknown location) (sim 1.00): "Flight of Fear"

### L31 Batman The Ride @ Six Flags Great Adventure

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Six Flags Great Adventure
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park exact: "Six Flags Great Adventure" → "Six Flags Great Adventure"
  - Coaster NOT at Six Flags Great Adventure but found at Other (unknown location) (sim 1.00): "Batman: The Ride"

### L34 Batman The Ride @ Six Flags Over Georgia

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Six Flags Over Georgia
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park exact: "Six Flags Over Georgia" → "Six Flags Over Georgia"
  - Coaster NOT at Six Flags Over Georgia but found at Other (unknown location) (sim 1.00): "Batman: The Ride"

### L35 Batman The Ride @ Six Flags Over Texas

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Six Flags Over Texas
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park exact: "Six Flags Over Texas" → "Six Flags Over Texas"
  - Coaster NOT at Six Flags Over Texas but found at Other (unknown location) (sim 1.00): "Batman: The Ride"

### L36 Batman The Ride @ Six Flags St. Louis

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Six Flags St. Louis
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park exact: "Six Flags St. Louis" → "Six Flags St. Louis"
  - Coaster NOT at Six Flags St. Louis but found at Other (unknown location) (sim 1.00): "Batman: The Ride"

### L322 Revenge of the Mummy @ Universal Studios Florida

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Universal Studios Florida
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park exact: "Universal Studios Florida" → "Universal Studios Florida"
  - Coaster NOT at Universal Studios Florida but found at Other (unknown location) (sim 1.00): "Revenge of the Mummy"

### L323 Revenge of the Mummy @ Universal Studios Hollywood

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: fuzzy -> Universal Studios Japan
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park fuzzy (0.53): "Universal Studios Hollywood" → "Universal Studios Japan"
  - Coaster NOT at Universal Studios Japan but found at Other (unknown location) (sim 1.00): "Revenge of the Mummy"

### L324 Revenge of the Mummy @ Universal Studios Singapore

- Action: `human_review`
- Priority: high
- Confidence: 1
- Park match: exact -> Universal Studios Singapore
- Found elsewhere: Other (unknown location)
- Evidence:
  - Park exact: "Universal Studios Singapore" → "Universal Studios Singapore"
  - Coaster NOT at Universal Studios Singapore but found at Other (unknown location) (sim 1.00): "Revenge of the Mummy"

## low_confidence_park_match

### L131 Freischutz @ Bayern Park

- Action: `human_review`
- Priority: high
- Confidence: 0.35
- Park match: fuzzy -> Battersea Park
- Evidence:
  - Park fuzzy (0.35): "Bayern Park" → "Battersea Park"
  - Coaster NOT FOUND at Battersea Park: "Freischutz"

### L11 Altair @ Cinecitta World

- Action: `human_review`
- Priority: high
- Confidence: 0.3
- Park match: fuzzy -> Sea World
- Evidence:
  - Park fuzzy (0.30): "Cinecitta World" → "Sea World"
  - Coaster NOT FOUND at Sea World: "Altair"

### L192 Inferno @ Cinecitta World

- Action: `human_review`
- Priority: high
- Confidence: 0.3
- Park match: fuzzy -> Sea World
- Evidence:
  - Park fuzzy (0.30): "Cinecitta World" → "Sea World"
  - Coaster NOT FOUND at Sea World: "Inferno"

### L72 Cú Chulainn @ Emerald Park

- Action: `human_review`
- Priority: high
- Confidence: 0.32
- Park match: fuzzy -> Europa-Park
- Evidence:
  - Park fuzzy (0.32): "Emerald Park" → "Europa-Park"
  - Coaster NOT FOUND at Europa-Park: "Cú Chulainn"

### L267 na Fianna Force @ Emerald Park

- Action: `human_review`
- Priority: high
- Confidence: 0.32
- Park match: fuzzy -> Europa-Park
- Evidence:
  - Park fuzzy (0.32): "Emerald Park" → "Europa-Park"
  - Coaster NOT FOUND at Europa-Park: "na Fianna Force"

### L479 Wild Train @ Fantasiana

- Action: `human_review`
- Priority: high
- Confidence: 0.3
- Park match: fuzzy -> Fantasy Island
- Evidence:
  - Park fuzzy (0.30): "Fantasiana" → "Fantasy Island"
  - Coaster NOT FOUND at Fantasy Island: "Wild Train"

### L501 Ziegel-Blitz @ Jaderpark

- Action: `human_review`
- Priority: high
- Confidence: 0.33
- Park match: fuzzy -> PowerPark
- Evidence:
  - Park fuzzy (0.33): "Jaderpark" → "PowerPark"
  - Coaster NOT FOUND at PowerPark: "Ziegel-Blitz"

### L245 Maximus - Der Flug des Wächters @ Legoland Deutschland

- Action: `human_review`
- Priority: high
- Confidence: 0.36
- Park match: fuzzy -> Legoland Billund
- Evidence:
  - Park fuzzy (0.36): "Legoland Deutschland" → "Legoland Billund"
  - Coaster NOT FOUND at Legoland Billund: "Maximus - Der Flug des Wächters"

### L139 GaleForce @ Playland's Castaway Cove

- Action: `human_review`
- Priority: high
- Confidence: 0.38
- Park match: fuzzy -> Playland
- Evidence:
  - Park fuzzy (0.38): "Playland's Castaway Cove" → "Playland"
  - Coaster NOT FOUND at Playland: "GaleForce"

### L396 Surf Coaster Leviathan @ Sea Paradise

- Action: `human_review`
- Priority: high
- Confidence: 0.39
- Park match: fuzzy -> Chimelong Paradise
- Evidence:
  - Park fuzzy (0.39): "Sea Paradise" → "Chimelong Paradise"
  - Coaster NOT FOUND at Chimelong Paradise: "Surf Coaster Leviathan"

### L365 Stardust Racers @ Universal Epic Universe

- Action: `human_review`
- Priority: high
- Confidence: 0.32
- Park match: fuzzy -> Universal Studios Japan
- Evidence:
  - Park fuzzy (0.32): "Universal Epic Universe" → "Universal Studios Japan"
  - Coaster NOT FOUND at Universal Studios Japan: "Stardust Racers"

## low_confidence_fuzzy_match

### L121 Flucht von Novgorod @ Hansa Park

- Action: `human_review`
- Priority: medium
- Confidence: 1
- Park match: exact -> Hansa-Park
- Coaster match: fuzzy -> Escape of Novgorod
- Evidence:
  - Park exact: "Hansa Park" → "Hansa-Park"
  - Coaster fuzzy (0.30) at Hansa-Park: "Flucht von Novgorod" → "Escape of Novgorod"

### L55 Bullet Coaster @ Happy Valley Shenzhen

- Action: `human_review`
- Priority: medium
- Confidence: 0.54
- Park match: fuzzy -> Happy Valley Shanghai
- Coaster match: fuzzy -> Diving Coaster
- Evidence:
  - Park fuzzy (0.54): "Happy Valley Shenzhen" → "Happy Valley Shanghai"
  - Coaster fuzzy (0.36) at Happy Valley Shanghai: "Bullet Coaster" → "Diving Coaster"

### L366 Starry Sky Ripper @ Joyland

- Action: `human_review`
- Priority: medium
- Confidence: 0.57
- Park match: fuzzy -> World Joyland
- Coaster match: fuzzy -> Sky Scrapper
- Evidence:
  - Park fuzzy (0.57): "Joyland" → "World Joyland"
  - Coaster fuzzy (0.32) at World Joyland: "Starry Sky Ripper" → "Sky Scrapper"

### L120 Flight of Fear @ Kings Island

- Action: `human_review`
- Priority: medium
- Confidence: 1
- Park match: exact -> Kings Island
- Coaster match: fuzzy -> Flight Deck
- Evidence:
  - Park exact: "Kings Island" → "Kings Island"
  - Coaster fuzzy (0.37) at Kings Island: "Flight of Fear" → "Flight Deck"

### L294 Phobia Phear Coaster @ Lake Compounce

- Action: `human_review`
- Priority: medium
- Confidence: 1
- Park match: exact -> Lake Compounce
- Coaster match: fuzzy -> Kiddie Coaster
- Evidence:
  - Park exact: "Lake Compounce" → "Lake Compounce"
  - Coaster fuzzy (0.31) at Lake Compounce: "Phobia Phear Coaster" → "Kiddie Coaster"

### L15 Anubis: The Ride @ Plopsaland De Panne

- Action: `human_review`
- Priority: medium
- Confidence: 1
- Park match: exact -> Plopsaland De Panne
- Coaster match: fuzzy -> The Ride to Happiness
- Evidence:
  - Park exact: "Plopsaland De Panne" → "Plopsaland De Panne"
  - Coaster fuzzy (0.32) at Plopsaland De Panne: "Anubis: The Ride" → "The Ride to Happiness"

### L176 Heidi The Ride @ Plopsaland De Panne

- Action: `human_review`
- Priority: medium
- Confidence: 1
- Park match: exact -> Plopsaland De Panne
- Coaster match: fuzzy -> The Ride to Happiness
- Evidence:
  - Park exact: "Plopsaland De Panne" → "Plopsaland De Panne"
  - Coaster fuzzy (0.38) at Plopsaland De Panne: "Heidi The Ride" → "The Ride to Happiness"

## low_confidence_park_fuzzy_match

### L57 Cannibal @ Lagoon

- Action: `human_review`
- Priority: medium
- Confidence: 0.32
- Park match: fuzzy -> Lagoon Amusement Park
- Coaster match: exact -> Cannibal
- Evidence:
  - Park fuzzy (0.32): "Lagoon" → "Lagoon Amusement Park"
  - Coaster exact: "Cannibal" → "Cannibal"

### L66 Colossus the Fire Dragon @ Lagoon

- Action: `human_review`
- Priority: medium
- Confidence: 0.32
- Park match: fuzzy -> Lagoon Amusement Park
- Coaster match: exact -> Colossus the Fire Dragon
- Evidence:
  - Park fuzzy (0.32): "Lagoon" → "Lagoon Amusement Park"
  - Coaster exact: "Colossus the Fire Dragon" → "Colossus the Fire Dragon"

### L303 Primordial @ Lagoon

- Action: `human_review`
- Priority: medium
- Confidence: 0.32
- Park match: fuzzy -> Lagoon Amusement Park
- Coaster match: exact -> Primordial
- Evidence:
  - Park fuzzy (0.32): "Lagoon" → "Lagoon Amusement Park"
  - Coaster exact: "Primordial" → "Primordial"

### L473 Wicked @ Lagoon

- Action: `human_review`
- Priority: medium
- Confidence: 0.32
- Park match: fuzzy -> Lagoon Amusement Park
- Coaster match: exact -> Wicked
- Evidence:
  - Park fuzzy (0.32): "Lagoon" → "Lagoon Amusement Park"
  - Coaster exact: "Wicked" → "Wicked"

## suspect_external_entry

### L33 Batman The Ride @ Six Flags Magic Mountain

- Action: `human_review`
- Priority: medium
- Confidence: 1
- Park match: exact -> Six Flags Magic Mountain
- Coaster match: fuzzy -> Apocalypse: The Ride
- Override: Human note: Batman The Ride likely does not exist at Six Flags Magic Mountain; keep in review.
- Evidence:
  - Park exact: "Six Flags Magic Mountain" → "Six Flags Magic Mountain"
  - Coaster fuzzy (0.33) at Six Flags Magic Mountain: "Batman The Ride" → "Apocalypse: The Ride"

