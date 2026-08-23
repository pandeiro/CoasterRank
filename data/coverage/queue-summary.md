# Coverage Queue Summary

Generated from `data/coverage/report.txt` by `scripts/src/build-coverage-queue.ts`.
Manual overrides from `data/coverage/queue-overrides.json`.

## Action Counts

- `create_missing_park`: 0
- `create_missing_coaster`: 0
- `rehome_orphaned_coaster`: 4
- `rehome_after_park_alias_fix`: 1
- `human_review`: 54
- `accept_existing_match_no_change`: 87

## Missing Parks


## Applied Overrides

- [L33] Batman The Ride @ Six Flags Magic Mountain: Human note: Batman The Ride likely does not exist at Six Flags Magic Mountain; keep in review.
- [L281] Orkanen @ Fårup Sommerland: Human note: Orkanen is already in the DB; treat the alternate park spelling as resolved for this launch checklist.
- [L353] Sky Scream @ Holiday Park: Human note: the Six Flags Magic Mountain match is a false positive; treat Sky Scream as missing at Holiday Park, Germany.

## Human Review

### same_name_collision_or_wrong_park

- [L435] Tornado @ Bakken -> Coney Island
- [L81] Desperado @ Buffalo Bill's Resort & Casino -> Primm Valley Resorts
- [L380] Storm Coaster @ Dubai Hills Mall -> Sea World (Australia)
- [L14] Anaconda @ Gold Reef City -> Walygator Parc
- [L311] Racer @ Kings Island -> Kennywood
- [L488] Wood Coaster @ Knight Valley -> OCT East
- [L73] Cyclone @ Luna Park -> Revere Beach
- [L42] Big Dipper @ Luna Park Sydney -> Blackpool Pleasure Beach
- [L93] Dragon Mountain @ Marineland Theme Park -> Marineland of Canada
- [L167] Hades 360 @ Mount Olympus -> Mt. Olympus Water & Theme Park
- [L350] Silver Comet @ Niagara Amusement Park & Splash World -> Fantasy Island
- [L112] Expedition GeForce @ Plopsaland Deutschland -> Holiday Park, Germany
- ... 11 more

### low_confidence_park_match

- [L131] Freischutz @ Bayern Park
- [L11] Altair @ Cinecitta World
- [L192] Inferno @ Cinecitta World
- [L72] Cú Chulainn @ Emerald Park
- [L267] na Fianna Force @ Emerald Park
- [L479] Wild Train @ Fantasiana
- [L501] Ziegel-Blitz @ Jaderpark
- [L245] Maximus - Der Flug des Wächters @ Legoland Deutschland
- [L139] GaleForce @ Playland's Castaway Cove
- [L396] Surf Coaster Leviathan @ Sea Paradise
- [L365] Stardust Racers @ Universal Epic Universe

### clone_rehome_from_other

- [L119] Flight of Fear @ Kings Dominion -> Other (unknown location)
- [L31] Batman The Ride @ Six Flags Great Adventure -> Other (unknown location)
- [L34] Batman The Ride @ Six Flags Over Georgia -> Other (unknown location)
- [L35] Batman The Ride @ Six Flags Over Texas -> Other (unknown location)
- [L36] Batman The Ride @ Six Flags St. Louis -> Other (unknown location)
- [L322] Revenge of the Mummy @ Universal Studios Florida -> Other (unknown location)
- [L323] Revenge of the Mummy @ Universal Studios Hollywood -> Other (unknown location)
- [L324] Revenge of the Mummy @ Universal Studios Singapore -> Other (unknown location)

### low_confidence_fuzzy_match

- [L121] Flucht von Novgorod @ Hansa Park
- [L55] Bullet Coaster @ Happy Valley Shenzhen
- [L366] Starry Sky Ripper @ Joyland
- [L120] Flight of Fear @ Kings Island
- [L294] Phobia Phear Coaster @ Lake Compounce
- [L15] Anubis: The Ride @ Plopsaland De Panne
- [L176] Heidi The Ride @ Plopsaland De Panne

### low_confidence_park_fuzzy_match

- [L57] Cannibal @ Lagoon
- [L66] Colossus the Fire Dragon @ Lagoon
- [L303] Primordial @ Lagoon
- [L473] Wicked @ Lagoon

### suspect_external_entry

- [L33] Batman The Ride @ Six Flags Magic Mountain

