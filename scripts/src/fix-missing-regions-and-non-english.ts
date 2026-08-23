import { supabaseAdmin } from './db/client.js';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fixLocations() {
  console.log('Starting location enrichment and translation pass...');

  // Fetch all parks that have coordinates
  const { data: parks, error } = await supabaseAdmin
    .from('parks')
    .select('id, name, lat, lng, city, country, region')
    .not('lat', 'is', null)
    .not('lng', 'is', null);

  if (error) {
    console.error('Error fetching parks:', error);
    process.exit(1);
  }

  if (!parks || parks.length === 0) {
    console.log('No parks found with coordinates.');
    return;
  }

  // Filter for parks that need fixing: non-English OR missing region
  const targets = (parks || []).filter(p => 
    (p.city && /[^\x00-\x7F]/.test(p.city)) || 
    (p.country && /[^\x00-\x7F]/.test(p.country)) || 
    !p.region
  );

  if (targets.length === 0) {
    console.log('No parks found needing updates.');
    return;
  }

  console.log(`Found ${targets.length} parks to process.`);

  let updatedCount = 0;
  let errorCount = 0;

  for (const park of targets) {
    console.log(`Processing ${park.name}...`);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${park.lat}&lon=${park.lng}`,
        {
          headers: {
            'User-Agent': 'CoasterRank-Location-Fixer/1.0',
            'Accept-Language': 'en'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as { address?: Record<string, string> };
      const address = data.address;

      if (!address) {
        console.warn(`  No address found for ${park.name}`);
        continue;
      }

      const city = address.city || address.town || address.village || address.suburb || address.hamlet;
      const country = address.country;
      const region = address.state || address.province || address.region;

      const updateData: any = {};
      
      // Update city if it's non-English or missing
      if (city && (!park.city || /[^\x00-\x7F]/.test(park.city))) {
        updateData.city = city;
      }
      
      // Update country if it's non-English or missing
      if (country && (!park.country || /[^\x00-\x7F]/.test(park.country))) {
        updateData.country = country;
      }

      // Update region if it's missing
      if (region && !park.region) {
        updateData.region = region;
      }

      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabaseAdmin
          .from('parks')
          .update(updateData)
          .eq('id', park.id);

        if (updateError) throw updateError;

        console.log(`  Updated: ${JSON.stringify(updateData)}`);
        updatedCount++;
      } else {
        console.log('  No updates needed.');
      }

    } catch (err: any) {
      console.error(`  Failed to process ${park.name}: ${err.message}`);
      errorCount++;
    }

    await sleep(1100);
  }

  console.log(`\nPass complete!`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Errors: ${errorCount}`);
}

fixLocations().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
