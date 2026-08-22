import { supabaseAdmin } from './db/client.js';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfillParks() {
  console.log('Starting park location backfill...');

  // Fetch parks that have coords but are missing city or country
  const { data: parks, error } = await supabaseAdmin
    .from('parks')
    .select('id, name, lat, lng, city, country')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .or('city.is.null,country.is.null');

  if (error) {
    console.error('Error fetching parks:', error);
    process.exit(1);
  }

  if (!parks || parks.length === 0) {
    console.log('No parks found needing backfill.');
    return;
  }

  console.log(`Found ${parks.length} parks to process.`);

  let updatedCount = 0;
  let errorCount = 0;

  for (const park of parks) {
    console.log(`Processing ${park.name} (${park.lat}, ${park.lng})...`);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${park.lat}&lon=${park.lng}`,
        {
          headers: {
            'User-Agent': 'CoasterRank-Backfill-Bot/1.0'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const address = data.address;

      if (!address) {
        console.warn(`  No address found for ${park.name}`);
        continue;
      }

      // Nominatim returns a few different keys for 'city'. 
      // We'll try city, town, village, suburb in order.
      const city = address.city || address.town || address.village || address.suburb || address.hamlet;
      const country = address.country;

      if (city || country) {
        const updateData: any = {};
        if (city && !park.city) updateData.city = city;
        if (country && !park.country) updateData.country = country;

        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabaseAdmin
            .from('parks')
            .update(updateData)
            .eq('id', park.id);

          if (updateError) {
            throw updateError;
          }

          console.log(`  Updated: city=${updateData.city || 'N/A'}, country=${updateData.country || 'N/A'}`);
          updatedCount++;
        } else {
          console.log('  No missing data to update.');
        }
      } else {
        console.warn('  Could not extract city or country from address.');
      }

    } catch (err: any) {
      console.error(`  Failed to process ${park.name}: ${err.message}`);
      errorCount++;
    }

    // Nominatim usage policy requires a rate limit of 1 request per second
    await sleep(1100);
  }

  console.log(`\nBackfill complete!`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Errors: ${errorCount}`);
}

backfillParks().catch(err => {
  console.error('Fatal error during backfill:', err);
  process.exit(1);
});
