# Design Spec

## Final Design Direction Summary

### Color Palette (Locked)
```
Primary:      #1A1A2E (Deep Indigo)
Background:   #FEFCF3 (Warm Cream) 
Surface:      #F5F0E8 (Off-white)
Accent Teal:  #00D4FF (Electric Teal) - CTAs, links, interactive elements
Accent Pink:  #E85D75 (Coral Pink) - Highlights, badges, emphasis
Muted:        #4A4A5A (Steel Slate) - Secondary text, borders
```

### Typography
- **Headlines/Display:** `Racing Sans One` (Google Fonts) - for page titles, rank numbers, hero text
- **Body:** `Inter` (Google Fonts) - for everything else

### Key UX Decisions
1. **Score bar removed** – Rank is the primary signal.
2. **"First Place Votes"** – We'll compute and display a badge showing how many users ranked this coaster #1. This adds a democratic, "people's champion" dimension.
3. **Simplified table rows:** Rank + Coaster/Park + First Place Votes + Material badge (small).
4. **No score delta/history tracking** – keep it clean for v1.

---

## Deliverable 1: Design Tokens (JSON)

```json
{
  "colors": {
    "primary": "#1A1A2E",
    "background": "#FEFCF3",
    "surface": "#F5F0E8",
    "accent": {
      "teal": "#00D4FF",
      "pink": "#E85D75"
    },
    "muted": "#4A4A5A",
    "text": {
      "primary": "#1A1A2E",
      "secondary": "#4A4A5A",
      "inverse": "#FEFCF3"
    }
  },
  "typography": {
    "fontFamily": {
      "display": "Racing Sans One",
      "body": "Inter"
    },
    "fontSize": {
      "xs": "0.75rem",
      "sm": "0.875rem",
      "base": "1rem",
      "lg": "1.125rem",
      "xl": "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem"
    }
  },
  "spacing": {
    "xs": "0.25rem",
    "sm": "0.5rem",
    "md": "1rem",
    "lg": "1.5rem",
    "xl": "2rem",
    "2xl": "3rem"
  },
  "borderRadius": {
    "none": "0",
    "sm": "0.25rem",
    "md": "0.5rem",
    "lg": "0.75rem",
    "xl": "1rem",
    "full": "9999px"
  },
  "shadows": {
    "sm": "0 1px 2px rgba(0,0,0,0.05)",
    "md": "0 4px 6px rgba(0,0,0,0.07)",
    "lg": "0 10px 15px rgba(0,0,0,0.1)",
    "xl": "0 20px 25px rgba(0,0,0,0.12)"
  }
}
```

---

## Deliverable 2: tailwind.config.js (Drop-in)

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#1A1A2E',
          background: '#FEFCF3',
          surface: '#F5F0E8',
          muted: '#4A4A5A',
        },
        accent: {
          teal: '#00D4FF',
          pink: '#E85D75',
        },
        text: {
          primary: '#1A1A2E',
          secondary: '#4A4A5A',
          inverse: '#FEFCF3',
        },
      },
      fontFamily: {
        display: ['Racing Sans One', 'cursive'],
        body: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        'xl': '1rem',
      },
      boxShadow: {
        'glow-teal': '0 0 20px rgba(0, 212, 255, 0.15)',
        'glow-pink': '0 0 20px rgba(232, 93, 117, 0.15)',
        'card': '0 4px 6px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.08)',
        'card-hover': '0 10px 25px rgba(0,0,0,0.08), 0 4px 10px rgba(0,0,0,0.05)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'rank-up': 'rankUp 1.5s ease-in-out',
        'rank-down': 'rankDown 1.5s ease-in-out',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        rankUp: {
          '0%': { backgroundColor: 'rgba(0, 212, 255, 0.15)' },
          '100%': { backgroundColor: 'transparent' },
        },
        rankDown: {
          '0%': { backgroundColor: 'rgba(232, 93, 117, 0.15)' },
          '100%': { backgroundColor: 'transparent' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(232, 93, 117, 0.4)' },
          '50%': { boxShadow: '0 0 0 8px rgba(232, 93, 117, 0)' },
        },
      },
    },
  },
  plugins: [],
}
```

---

## Deliverable 3: Logo.svg

Here's a clean, geometric SVG logo combining a coaster lift-hill and a data bar chart:

```svg
<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Coaster track / data bars -->
  <path d="M12 90 L12 70 L20 70 L20 90 L28 90 L28 50 L36 50 L36 90 L44 90 L44 30 L52 30 L52 90 L60 90 L60 10 L68 10 L68 90 L76 90 L76 55 L84 55 L84 90 L92 90 L92 40 L100 40 L100 90 L108 90 L108 90" 
        stroke="#00D4FF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  
  <!-- Lift hill accent -->
  <path d="M10 90 L30 55 L50 75 L70 40 L90 65 L110 20" 
        stroke="#E85D75" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  
  <!-- Small track detail -->
  <circle cx="70" cy="40" r="4" fill="#E85D75"/>
  <circle cx="110" cy="20" r="4" fill="#E85D75"/>
</svg>
```

### Wordmark Variant (logotype)
If you prefer text-based, use:
```
CoasterRank
```
Set in `Racing Sans One`, with the "R" in `#E85D75` (pink) and the rest in `#1A1A2E` (primary). The "C" can be stylized as a subtle lift-hill.

---

## Deliverable 4: Design System HTML

I've created a standalone HTML file that renders all components. Save this as `design-system.html` and open in your browser:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CoasterRank Design System</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Racing+Sans+One&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { primary: '#1A1A2E', background: '#FEFCF3', surface: '#F5F0E8', muted: '#4A4A5A' },
            accent: { teal: '#00D4FF', pink: '#E85D75' },
            text: { primary: '#1A1A2E', secondary: '#4A4A5A', inverse: '#FEFCF3' },
          },
          fontFamily: { display: ['Racing Sans One', 'cursive'], body: ['Inter', 'sans-serif'] },
          boxShadow: { 'card': '0 4px 6px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.08)' },
        }
      }
    }
  </script>
  <style>
    body { background: #FEFCF3; font-family: 'Inter', sans-serif; }
    .brand-gradient { background: linear-gradient(135deg, #1A1A2E 0%, #2D2D44 100%); }
    .coaster-stripe { background: repeating-linear-gradient(45deg, #00D4FF 0px, #00D4FF 2px, transparent 2px, transparent 6px); }
  </style>
</head>
<body>
  <div class="max-w-5xl mx-auto px-6 py-12">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-[#F5F0E8] pb-6 mb-10">
      <div>
        <h1 class="font-display text-3xl text-[#1A1A2E]">
          Coaster<span class="text-[#E85D75]">Rank</span>
        </h1>
        <p class="text-sm text-[#4A4A5A] mt-1">Design System v1.0</p>
      </div>
      <div class="flex gap-3">
        <span class="inline-flex items-center gap-1.5 text-xs font-medium text-[#4A4A5A] bg-[#F5F0E8] px-3 py-1.5 rounded-full">
          <span class="w-2 h-2 rounded-full bg-[#00D4FF] animate-pulse"></span>
          Live
        </span>
      </div>
    </div>

    <!-- Colors -->
    <section class="mb-12">
      <h2 class="font-display text-xl text-[#1A1A2E] mb-4">Colors</h2>
      <div class="grid grid-cols-3 md:grid-cols-6 gap-4">
        <div><div class="h-16 rounded-xl bg-[#1A1A2E]"></div><p class="text-xs text-[#4A4A5A] mt-1">Primary</p></div>
        <div><div class="h-16 rounded-xl bg-[#FEFCF3] border border-[#F5F0E8]"></div><p class="text-xs text-[#4A4A5A] mt-1">Background</p></div>
        <div><div class="h-16 rounded-xl bg-[#F5F0E8]"></div><p class="text-xs text-[#4A4A5A] mt-1">Surface</p></div>
        <div><div class="h-16 rounded-xl bg-[#00D4FF]"></div><p class="text-xs text-[#4A4A5A] mt-1">Teal</p></div>
        <div><div class="h-16 rounded-xl bg-[#E85D75]"></div><p class="text-xs text-[#4A4A5A] mt-1">Pink</p></div>
        <div><div class="h-16 rounded-xl bg-[#4A4A5A]"></div><p class="text-xs text-[#4A4A5A] mt-1">Muted</p></div>
      </div>
    </section>

    <!-- Buttons -->
    <section class="mb-12">
      <h2 class="font-display text-xl text-[#1A1A2E] mb-4">Buttons</h2>
      <div class="flex flex-wrap gap-4">
        <button class="bg-[#00D4FF] text-[#1A1A2E] font-semibold px-6 py-2.5 rounded-full hover:opacity-80 transition">Primary</button>
        <button class="border-2 border-[#00D4FF] text-[#1A1A2E] font-semibold px-6 py-2.5 rounded-full hover:bg-[#00D4FF] transition">Outline</button>
        <button class="bg-[#E85D75] text-white font-semibold px-6 py-2.5 rounded-full hover:opacity-80 transition">Accent</button>
        <button class="bg-[#1A1A2E] text-[#FEFCF3] font-semibold px-6 py-2.5 rounded-full hover:opacity-80 transition">Dark</button>
        <button class="text-[#4A4A5A] font-semibold px-6 py-2.5 hover:text-[#1A1A2E] transition">Ghost</button>
      </div>
    </section>

    <!-- Table Row (Coaster) -->
    <section class="mb-12">
      <h2 class="font-display text-xl text-[#1A1A2E] mb-4">Coaster Row</h2>
      <div class="bg-white rounded-xl shadow-card p-4 flex items-center gap-4 hover:shadow-card-hover transition">
        <span class="font-display text-2xl text-[#4A4A5A] w-10 text-right">#1</span>
        <div class="flex-1">
          <h3 class="font-semibold text-[#1A1A2E]">Fury 325</h3>
          <p class="text-sm text-[#4A4A5A]">Carowinds</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="inline-flex items-center gap-1.5 bg-[#F5F0E8] px-3 py-1 rounded-full text-xs font-medium text-[#4A4A5A]">
            <span class="w-1.5 h-1.5 rounded-full bg-[#E85D75]"></span>
            42 first-place votes
          </span>
          <span class="text-xs font-medium text-[#4A4A5A] bg-[#F5F0E8] px-3 py-1 rounded-full">Steel</span>
        </div>
      </div>
      <div class="mt-3 bg-white rounded-xl shadow-card p-4 flex items-center gap-4 hover:shadow-card-hover transition">
        <span class="font-display text-2xl text-[#4A4A5A] w-10 text-right">#2</span>
        <div class="flex-1">
          <h3 class="font-semibold text-[#1A1A2E]">Steel Vengeance</h3>
          <p class="text-sm text-[#4A4A5A]">Cedar Point</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="inline-flex items-center gap-1.5 bg-[#F5F0E8] px-3 py-1 rounded-full text-xs font-medium text-[#4A4A5A]">
            <span class="w-1.5 h-1.5 rounded-full bg-[#E85D75]"></span>
            38 first-place votes
          </span>
          <span class="text-xs font-medium text-[#4A4A5A] bg-[#F5F0E8] px-3 py-1 rounded-full">Hybrid</span>
        </div>
      </div>
    </section>

    <!-- Filter Pills -->
    <section class="mb-12">
      <h2 class="font-display text-xl text-[#1A1A2E] mb-4">Filters (Pill Bar)</h2>
      <div class="flex flex-wrap gap-2 bg-white rounded-xl shadow-card p-3">
        <button class="bg-[#00D4FF] text-[#1A1A2E] text-sm font-medium px-4 py-1.5 rounded-full">All Coasters</button>
        <button class="text-[#4A4A5A] text-sm font-medium px-4 py-1.5 rounded-full hover:bg-[#F5F0E8] transition">Steel</button>
        <button class="text-[#4A4A5A] text-sm font-medium px-4 py-1.5 rounded-full hover:bg-[#F5F0E8] transition">Wood</button>
        <button class="text-[#4A4A5A] text-sm font-medium px-4 py-1.5 rounded-full hover:bg-[#F5F0E8] transition">Hybrid</button>
        <button class="text-[#4A4A5A] text-sm font-medium px-4 py-1.5 rounded-full hover:bg-[#F5F0E8] transition">Operating</button>
        <div class="flex-1"></div>
        <span class="text-sm text-[#4A4A5A] self-center">128 coasters</span>
      </div>
    </section>

    <!-- Card / Profile Preview -->
    <section class="mb-12">
      <h2 class="font-display text-xl text-[#1A1A2E] mb-4">Profile Card</h2>
      <div class="bg-white rounded-xl shadow-card p-6 max-w-sm">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-full bg-[#00D4FF] flex items-center justify-center text-[#1A1A2E] font-display text-xl">JD</div>
          <div>
            <h3 class="font-semibold text-[#1A1A2E]">@jessicad</h3>
            <p class="text-sm text-[#4A4A5A]">Member since Jun 2026</p>
          </div>
          <span class="ml-auto text-xs font-medium bg-[#E85D75] text-white px-3 py-1 rounded-full">Admin</span>
        </div>
        <div class="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-[#F5F0E8]">
          <div class="text-center"><span class="block font-semibold text-[#1A1A2E]">24</span><span class="text-xs text-[#4A4A5A]">Ridden</span></div>
          <div class="text-center"><span class="block font-semibold text-[#1A1A2E]">78m</span><span class="text-xs text-[#4A4A5A]">Tallest</span></div>
          <div class="text-center"><span class="block font-semibold text-[#1A1A2E]">120</span><span class="text-xs text-[#4A4A5A]">Top Speed</span></div>
        </div>
      </div>
    </section>

    <!-- Live Badge -->
    <section class="mb-12">
      <h2 class="font-display text-xl text-[#1A1A2E] mb-4">Live Status Badge</h2>
      <div class="flex items-center gap-4">
        <span class="inline-flex items-center gap-2 text-sm font-medium text-[#4A4A5A] bg-[#F5F0E8] px-4 py-2 rounded-full">
          <span class="w-2 h-2 rounded-full bg-[#00D4FF] animate-pulse"></span>
          Updated 2 minutes ago
        </span>
        <span class="inline-flex items-center gap-2 text-sm font-medium text-[#4A4A5A] bg-[#F5F0E8] px-4 py-2 rounded-full">
          <span class="w-2 h-2 rounded-full bg-[#E85D75]"></span>
          1,247 rankings today
        </span>
      </div>
    </section>

    <!-- Skeleton Loading -->
    <section>
      <h2 class="font-display text-xl text-[#1A1A2E] mb-4">Skeleton Loading</h2>
      <div class="space-y-3">
        <div class="bg-white rounded-xl shadow-card p-4 flex items-center gap-4">
          <div class="w-10 h-8 bg-[#F5F0E8] rounded animate-pulse"></div>
          <div class="flex-1">
            <div class="h-5 w-48 bg-[#F5F0E8] rounded animate-pulse"></div>
            <div class="h-4 w-32 bg-[#F5F0E8] rounded animate-pulse mt-1.5"></div>
          </div>
          <div class="h-6 w-24 bg-[#F5F0E8] rounded-full animate-pulse"></div>
        </div>
        <div class="bg-white rounded-xl shadow-card p-4 flex items-center gap-4">
          <div class="w-10 h-8 bg-[#F5F0E8] rounded animate-pulse"></div>
          <div class="flex-1">
            <div class="h-5 w-56 bg-[#F5F0E8] rounded animate-pulse"></div>
            <div class="h-4 w-36 bg-[#F5F0E8] rounded animate-pulse mt-1.5"></div>
          </div>
          <div class="h-6 w-24 bg-[#F5F0E8] rounded-full animate-pulse"></div>
        </div>
      </div>
    </section>

    <p class="mt-12 text-xs text-[#4A4A5A] border-t border-[#F5F0E8] pt-6">CoasterRank Design System · All components are ready to use with Tailwind classes.</p>
  </div>
</body>
</html>
```

---

## Deliverable 5: Component Class Reference

| Component | Tailwind Classes |
|-----------|------------------|
| **Page Container** | `max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-10` |
| **Page Title** | `font-display text-2xl md:text-3xl text-[#1A1A2E]` |
| **Subtitle** | `text-sm text-[#4A4A5A] mt-1` |
| **Primary Button** | `bg-[#00D4FF] text-[#1A1A2E] font-semibold px-6 py-2.5 rounded-full hover:opacity-80 transition` |
| **Secondary Button** | `bg-[#E85D75] text-white font-semibold px-6 py-2.5 rounded-full hover:opacity-80 transition` |
| **Outline Button** | `border-2 border-[#00D4FF] text-[#1A1A2E] font-semibold px-6 py-2.5 rounded-full hover:bg-[#00D4FF] transition` |
| **Coaster Row** | `bg-white rounded-xl shadow-card p-4 flex items-center gap-4 hover:shadow-card-hover transition` |
| **Rank Number** | `font-display text-2xl text-[#4A4A5A] w-10 text-right` |
| **Coaster Name** | `font-semibold text-[#1A1A2E]` |
| **Park Name** | `text-sm text-[#4A4A5A]` |
| **Badge (First-place votes)** | `inline-flex items-center gap-1.5 bg-[#F5F0E8] px-3 py-1 rounded-full text-xs font-medium text-[#4A4A5A]` |
| **Dot indicator** | `w-1.5 h-1.5 rounded-full bg-[#E85D75]` |
| **Material Badge** | `text-xs font-medium text-[#4A4A5A] bg-[#F5F0E8] px-3 py-1 rounded-full` |
| **Filter Pill (active)** | `bg-[#00D4FF] text-[#1A1A2E] text-sm font-medium px-4 py-1.5 rounded-full` |
| **Filter Pill (inactive)** | `text-[#4A4A5A] text-sm font-medium px-4 py-1.5 rounded-full hover:bg-[#F5F0E8] transition` |
| **Filter Bar Container** | `flex flex-wrap gap-2 bg-white rounded-xl shadow-card p-3` |
| **Live Badge** | `inline-flex items-center gap-2 text-sm font-medium text-[#4A4A5A] bg-[#F5F0E8] px-4 py-2 rounded-full` |
| **Live Dot** | `w-2 h-2 rounded-full bg-[#00D4FF] animate-pulse` |
| **Skeleton Row** | `bg-[#F5F0E8] rounded animate-pulse` |

---

## Deliverable 6: Motion Spec

| Interaction | CSS Implementation |
|-------------|-------------------|
| **Rank Up** | `animate-rank-up` – 1.5s teal glow fade-out |
| **Rank Down** | `animate-rank-down` – 1.5s pink glow fade-out |
| **Hover Row** | `hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200` |
| **Loading Skeleton** | `animate-pulse` (Tailwind built-in) |
| **Page Fade-in** | `animate-fade-in` – 0.3s ease-in-out |
| **Drag Sort** | CSS `transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)` |

---

## Computing First-Place Votes

Here's a SQL snippet to compute this efficiently:

```sql
-- Add to your ranking job or a separate view
WITH first_place_counts AS (
  SELECT 
    coaster_id,
    COUNT(*) AS first_place_votes
  FROM user_coaster_rankings
  WHERE rank = 1  -- assumes rank 1 = first place
  GROUP BY coaster_id
)
SELECT 
  c.id,
  c.name,
  COALESCE(fpc.first_place_votes, 0) AS first_place_votes
FROM coasters c
LEFT JOIN first_place_counts fpc ON c.id = fpc.coaster_id
ORDER BY fpc.first_place_votes DESC NULLS LAST;
```

You can expose this via a Supabase view or join it into your existing coaster query.

---

## Summary: Next Steps

1. **Copy `tailwind.config.js`** into your project.
2. **Add Google Fonts** to your `index.html`:
   ```html
   <link href="https://fonts.googleapis.com/css2?family=Racing+Sans+One&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
   ```
3. **Replace existing Tailwind classes** with the ones from the Component Reference.
4. **Add the `design-system.html`** file to your repo for reference.
5. **Implement the first-place votes** query and expose it via your API.
6. **Apply the motion classes** to table rows and hover states.

This gives you a complete, cohesive brand identity without requiring
any new dependencies or major architectural changes. The existing
React components (BoardPage, MyCoastersPage, ProfilePage) can stay
structurally identical – you're just swapping classes and adding a few
new data fields.
