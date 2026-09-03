/**
 * Offline space-science knowledge base for the Spaceverse assistant.
 *
 * The chatbot prefers Gemini when GEMINI_API_KEY is set and reachable. When it
 * is not — no key, quota exhausted, network down, an expo laptop offline — this
 * module answers instead. It is a curated corpus plus a scored matcher, not a
 * language model: it will not improvise, but every answer it gives is correct
 * and it covers the topics this platform actually teaches (orbital mechanics,
 * the Kessler syndrome, the solar system, stellar physics, cosmology, launch
 * vehicles and the major missions).
 *
 * Matching: each entry lists `phrases` (multi-word, weighted 3) and `keywords`
 * (single tokens, weighted 1, matched on word boundaries so "hi" does not fire
 * on "which"). The highest-scoring entry above threshold wins.
 */

'use strict';

/** @type {{id:string, phrases?:string[], keywords?:string[], answer:string}[]} */
const ENTRIES = [
  // ---- conversational ----
  {
    id: 'greeting',
    phrases: ['good morning', 'good evening', 'how are you', 'what can you do', 'who are you', 'what are you'],
    keywords: ['hello', 'hey', 'hiya', 'greetings', 'yo'],
    answer:
      "Hi — I'm the Spaceverse assistant. Ask me about orbital mechanics and the Kessler syndrome, the planets and the Sun, stars and black holes, cosmology, or rockets and the big missions. Try \"what is the Kessler syndrome?\" or \"how do rockets work?\"."
  },
  {
    id: 'thanks',
    phrases: ['thank you', 'thanks a lot', 'that helps'],
    keywords: ['thanks', 'thx', 'ty'],
    answer: "Happy to help. Ask me anything else about space — orbits, planets, stars, missions."
  },

  // ---- orbital mechanics / space traffic (this app's core topic) ----
  {
    id: 'kessler',
    phrases: ['kessler syndrome', 'kessler effect', 'kessler cascade', 'collision cascade', 'runaway debris', 'ablation cascade'],
    keywords: ['kessler'],
    answer:
      "The Kessler syndrome, proposed by NASA's Donald Kessler in 1978, is a runaway chain reaction of orbital collisions. Each smash-up multiplies the debris population, and more debris means more collisions, so the cascade feeds itself. Past a critical object density in a given orbital shell it can continue even if all launches stop. The danger zone is low Earth orbit between roughly 700 and 1,000 km, where atmospheric drag is too weak to clean debris out for centuries. It is exactly the failure mode the Space Traffic Simulator in this app lets you provoke and study."
  },
  {
    id: 'orbit-regimes',
    phrases: ['leo meo geo', 'orbital regimes', 'types of orbit', 'low earth orbit', 'geostationary orbit', 'geosynchronous orbit', 'sun synchronous orbit', 'polar orbit'],
    keywords: ['leo', 'meo', 'geo', 'sso'],
    answer:
      "Orbits are grouped by altitude. LEO (Low Earth Orbit, ~160–2,000 km) holds the ISS, Starlink and most imaging satellites; a full lap takes about 90 minutes. MEO (~2,000–35,786 km) is home to navigation constellations like GPS and Galileo. GEO (35,786 km above the equator) matches Earth's rotation, so a satellite there appears fixed in the sky — ideal for communications and weather. Two useful LEO special cases: polar orbits pass near both poles for global coverage, and Sun-synchronous orbits keep a constant local solar time for consistent lighting."
  },
  {
    id: 'delta-v',
    phrases: ['delta v', 'delta-v', 'change in velocity', 'rocket equation', 'tsiolkovsky equation'],
    keywords: ['deltav'],
    answer:
      "Delta-v (Δv) is the total change in velocity a spacecraft must produce to complete a manoeuvre — it is the real 'currency' of spaceflight, not distance. Tsiolkovsky's rocket equation, Δv = Isp · g₀ · ln(m_start / m_end), ties it to exhaust velocity and the ratio of fuelled to dry mass. Because that relationship is logarithmic, small increases in required Δv demand disproportionately more propellant, which is why reaching orbit (~9.4 km/s of Δv including losses) needs a vehicle that is mostly fuel."
  },
  {
    id: 'hohmann',
    phrases: ['hohmann transfer', 'transfer orbit', 'change orbit efficiently', 'move between orbits'],
    keywords: ['hohmann'],
    answer:
      "A Hohmann transfer is the low-energy way to move between two circular orbits. You fire once to enter an elliptical path that just touches both orbits, coast half a lap, then fire again to circularise at the new altitude. It is propellant-optimal for most cases but slow; bi-elliptic transfers can beat it for very large ratio changes, and faster routes always cost more delta-v."
  },
  {
    id: 'escape-velocity',
    phrases: ['escape velocity', 'escape speed', 'how fast to leave earth', 'break free of gravity'],
    keywords: [],
    answer:
      "Escape velocity is the speed at which an object's kinetic energy cancels a body's gravitational potential, so it can coast away without further thrust. From Earth's surface it is about 11.2 km/s (40,270 km/h); from the Moon only 2.4 km/s; from the Sun's surface 618 km/s. It is independent of the escaping object's mass and, ignoring drag, independent of launch direction."
  },
  {
    id: 'orbital-decay',
    phrases: ['orbital decay', 'why satellites fall', 'atmospheric drag', 'reentry from orbit', 're-entry heating'],
    keywords: ['deorbit', 'decay'],
    answer:
      "Even in LEO the atmosphere is not perfectly empty. Trace gas drags on a satellite, lowering its orbit a little each pass; the lower it drops the denser the air and the faster it falls, so decay accelerates. Below ~400 km an un-boosted satellite reenters within months to a couple of years. On the way down, compression of the air ahead of the vehicle — not friction — heats it to thousands of degrees, which is what a heat shield is built to survive."
  },
  {
    id: 'conjunction',
    phrases: ['collision avoidance', 'conjunction analysis', 'close approach', 'avoidance maneuver', 'debris avoidance'],
    keywords: ['conjunction'],
    answer:
      "Operators track every catalogued object and screen for 'conjunctions' — predicted close approaches. When the collision probability for a screening crosses a threshold (often 1 in 10,000) and the object is manoeuvrable, it performs a small avoidance burn, typically a day or so ahead. The ISS does this several times a year. The Space Traffic Simulator here models how launch and break-up scenarios change conjunction rates."
  },
  {
    id: 'space-debris',
    phrases: ['space debris', 'space junk', 'orbital debris', 'how much junk in orbit', 'debris mitigation', 'anti satellite test', 'asat'],
    keywords: ['debris', 'junk'],
    answer:
      "Roughly 35,000 tracked objects larger than 10 cm orbit Earth, plus an estimated million pieces above 1 cm — spent rocket stages, dead satellites and fragments from explosions and anti-satellite (ASAT) tests. At orbital speed a 1 cm fragment hits with the energy of a small car on the motorway. Mitigation means passivating spent hardware, de-orbiting within 25 years (5 in newer rules), and reserving 'graveyard' orbits above GEO."
  },

  // ---- solar system ----
  {
    id: 'planets-count',
    phrases: ['how many planets', 'planets in the solar system', 'list the planets', 'order of the planets'],
    keywords: [],
    answer:
      "Eight: Mercury, Venus, Earth and Mars are the small rocky inner planets; Jupiter and Saturn are gas giants; Uranus and Neptune are ice giants. Pluto was reclassified a dwarf planet in 2006 and shares that class with Ceres, Eris, Haumea and Makemake."
  },
  {
    id: 'mercury',
    phrases: ['planet mercury', 'closest planet to the sun', 'smallest planet'],
    keywords: ['mercury'],
    answer:
      "Mercury is the innermost and smallest planet, only slightly larger than the Moon. A day (sunrise to sunrise) lasts 176 Earth days while its year is just 88, and with almost no atmosphere its surface swings from 430 °C in sunlight to −180 °C at night. It has a surprisingly large iron core and no moons."
  },
  {
    id: 'venus',
    phrases: ['planet venus', 'hottest planet', 'morning star', 'evening star'],
    keywords: ['venus'],
    answer:
      "Venus is Earth's near-twin in size but wrapped in a crushing CO₂ atmosphere 90 times Earth's surface pressure. A runaway greenhouse effect holds the surface near 465 °C — hotter than Mercury — everywhere, day or night. It rotates backwards and so slowly that its day is longer than its year."
  },
  {
    id: 'earth',
    phrases: ['planet earth', 'our planet', 'the blue planet', 'why is earth habitable'],
    keywords: [],
    answer:
      "Earth is the only known world with liquid surface water and life. It sits in the Sun's habitable zone, keeps a protective magnetic field generated by its molten iron core, and has a large stabilising Moon. Its atmosphere is 78% nitrogen and 21% oxygen, the oxygen itself a product of billions of years of photosynthesis."
  },
  {
    id: 'mars',
    phrases: ['planet mars', 'the red planet', 'life on mars', 'water on mars', 'mars rovers'],
    keywords: ['mars'],
    answer:
      "Mars is a cold desert world about half Earth's diameter, red from iron-oxide dust. It has the tallest volcano in the solar system (Olympus Mons, ~22 km) and a canyon system that would span the United States. Its thin CO₂ atmosphere is under 1% of Earth's pressure. Robotic explorers — Perseverance and Curiosity now, with Ingenuity the first powered flight on another world — are hunting for signs of ancient microbial life in dried river deltas."
  },
  {
    id: 'jupiter',
    phrases: ['planet jupiter', 'largest planet', 'great red spot', 'jupiter moons'],
    keywords: ['jupiter'],
    answer:
      "Jupiter is the largest planet — 11 Earths wide and more massive than all the others combined. It is mostly hydrogen and helium with no solid surface, banded by fast storm systems including the Great Red Spot, an anticyclone wider than Earth. It has 95 known moons; the four large Galilean ones include volcanic Io and Europa, whose subsurface ocean is a prime target in the search for life."
  },
  {
    id: 'saturn',
    phrases: ['planet saturn', 'the ringed planet', 'saturn rings', 'saturn moons', 'titan moon', 'enceladus'],
    keywords: ['saturn'],
    answer:
      "Saturn is the second-largest planet and least dense of all — it would float in water. Its rings are countless particles of water ice, from dust grains to house-sized chunks, spanning ~280,000 km but only tens of metres thick. Among 140+ moons, Titan has a thick atmosphere and methane lakes, and Enceladus jets water vapour from an under-ice ocean."
  },
  {
    id: 'uranus-neptune',
    phrases: ['planet uranus', 'planet neptune', 'ice giants', 'why is uranus tilted', 'farthest planet'],
    keywords: ['uranus', 'neptune'],
    answer:
      "Uranus and Neptune are ice giants — smaller than the gas giants, rich in water, ammonia and methane ices, the methane giving both a blue tint. Uranus is tipped almost 98°, effectively orbiting on its side, probably after a giant impact. Neptune, the outermost planet, has the strongest winds in the solar system at over 2,000 km/h. Both have faint rings and were each visited only once, by Voyager 2."
  },
  {
    id: 'pluto-dwarf',
    phrases: ['is pluto a planet', 'dwarf planet', 'why is pluto not a planet', 'planet nine'],
    keywords: ['pluto'],
    answer:
      "Pluto is a dwarf planet: it orbits the Sun and is round, but it has not 'cleared its neighbourhood' of other Kuiper Belt objects, which is the criterion it fails. NASA's New Horizons flyby in 2015 revealed a startlingly active world with nitrogen-ice glaciers and a smooth heart-shaped plain. The other recognised dwarf planets are Ceres, Eris, Haumea and Makemake."
  },
  {
    id: 'sun',
    phrases: ['what is the sun', 'the sun', 'how hot is the sun', 'how old is the sun', 'nuclear fusion in the sun'],
    keywords: ['sun'],
    answer:
      "The Sun is a G-type main-sequence star, a 4.6-billion-year-old sphere of plasma holding 99.86% of the solar system's mass. In its core, at ~15 million °C, hydrogen fuses to helium, converting about 4 million tonnes of mass to energy every second; that light takes 8 minutes 20 seconds to reach Earth. It is roughly halfway through its ~10-billion-year hydrogen-burning life."
  },
  {
    id: 'solar-wind-flares',
    phrases: ['solar wind', 'solar flare', 'coronal mass ejection', 'space weather', 'solar storm', 'sunspots'],
    keywords: ['flare', 'cme'],
    answer:
      "The Sun continuously sheds charged particles as the solar wind. Magnetic activity around sunspots can release sudden bursts — flares (radiation) and coronal mass ejections (billions of tonnes of plasma). When these hit Earth's magnetosphere they drive geomagnetic storms that brighten the aurora, can disturb radio and GPS, and in severe cases stress power grids. The app's simulator pulls live space-weather indices from NASA's DONKI service."
  },
  {
    id: 'aurora',
    phrases: ['what causes the aurora', 'northern lights', 'southern lights', 'aurora borealis'],
    keywords: ['aurora'],
    answer:
      "Auroras happen when charged particles from the solar wind are funnelled along Earth's magnetic field into the upper atmosphere near the poles. They excite oxygen and nitrogen atoms, which then glow — green and red from oxygen, blue and purple from nitrogen — typically 100–300 km up."
  },
  {
    id: 'moon-tides',
    phrases: ['why do we have tides', 'what causes tides', 'the moon', 'phases of the moon', 'why does the moon have phases', 'far side of the moon'],
    keywords: ['tides', 'moon'],
    answer:
      "The Moon's gravity pulls hardest on the ocean nearest it and least on the far side, raising a bulge on both sides; Earth's rotation carries us through them as two high and two low tides a day, with the Sun adding the stronger 'spring' and weaker 'neap' variations. The Moon's phases are simply how much of its sunlit half we see as it orbits. It is tidally locked, so the same face always points at us."
  },
  {
    id: 'eclipse',
    phrases: ['solar eclipse', 'lunar eclipse', 'what is an eclipse', 'why are eclipses rare', 'blood moon'],
    keywords: ['eclipse'],
    answer:
      "A solar eclipse is the Moon passing between Sun and Earth, its shadow tracking a narrow path of totality across the surface. A lunar eclipse is Earth's shadow falling on the full Moon, which turns coppery ('blood moon') from sunlight bent through our atmosphere. They are not monthly because the Moon's orbit is tilted ~5°, so the three bodies line up exactly only a few times a year."
  },
  {
    id: 'seasons',
    phrases: ['what causes the seasons', 'why do we have seasons', 'axial tilt'],
    keywords: ['seasons'],
    answer:
      "Seasons come from Earth's 23.5° axial tilt, not its distance from the Sun (we are actually closest in January). The hemisphere tilted toward the Sun gets more direct light and longer days — summer — while the other has winter; six months later it reverses."
  },
  {
    id: 'asteroids-comets-meteors',
    phrases: ['what is an asteroid', 'what is a comet', 'difference between meteor and meteorite', 'shooting star', 'asteroid belt', 'kuiper belt', 'oort cloud'],
    keywords: ['asteroid', 'comet', 'meteor', 'meteorite'],
    answer:
      "Asteroids are rocky leftovers from planet formation, most in the belt between Mars and Jupiter. Comets are icy bodies from the Kuiper Belt (beyond Neptune) or the distant Oort Cloud that grow a glowing coma and tail when the Sun warms them. A meteoroid is a small fragment; the streak it makes burning up is a meteor ('shooting star'); any piece that survives to the ground is a meteorite."
  },

  // ---- stars, black holes, cosmology ----
  {
    id: 'star-formation-lifecycle',
    phrases: ['how are stars formed', 'star formation', 'life cycle of a star', 'how do stars die', 'main sequence', 'red giant', 'supernova'],
    keywords: ['nebula', 'protostar', 'supernova'],
    answer:
      "Stars condense from cold clouds of gas and dust. Gravity pulls a clump together until its core hits ~10 million °C and hydrogen fusion ignites — a new star on the 'main sequence', where our Sun sits. When core hydrogen runs out it swells to a red giant. Sun-like stars then shed their outer layers and leave a white dwarf; stars above about 8 solar masses explode as a supernova, leaving a neutron star or a black hole."
  },
  {
    id: 'black-hole',
    phrases: ['what is a black hole', 'event horizon', 'can light escape a black hole', 'supermassive black hole', 'what is at the center of the galaxy'],
    keywords: ['blackhole'],
    answer:
      "A black hole is a region where mass is packed so tightly that escape velocity exceeds the speed of light, so nothing — not even light — gets out past the boundary called the event horizon. Stellar-mass black holes form when massive stars collapse; supermassive ones of millions to billions of solar masses sit at galaxy centres, including Sagittarius A* in the Milky Way. We 'see' them by the X-rays from infalling gas and, since 2019, by direct silhouette imaging with the Event Horizon Telescope."
  },
  {
    id: 'neutron-star',
    phrases: ['what is a neutron star', 'what is a pulsar', 'magnetar'],
    keywords: ['pulsar', 'neutron'],
    answer:
      "A neutron star is the collapsed core left by a supernova — about 1.4 Suns of mass squeezed into a city-sized ball so dense a teaspoon would weigh billions of tonnes. Many spin many times a second and beam radiation from their magnetic poles; when that beam sweeps past Earth we detect a pulsar. Those with extreme magnetic fields are called magnetars."
  },
  {
    id: 'big-bang-expansion',
    phrases: ['what is the big bang', 'how did the universe begin', 'is the universe expanding', 'age of the universe', 'cosmic microwave background', 'redshift'],
    keywords: ['bigbang'],
    answer:
      "The Big Bang is the model in which the universe began 13.8 billion years ago as an extremely hot, dense state and has been expanding and cooling ever since — space itself stretching, which is why distant galaxies show redshift and recede faster the farther they are (Hubble's law). Its strongest evidence is the cosmic microwave background, the faint uniform afterglow now cooled to 2.7 K."
  },
  {
    id: 'universe-size',
    phrases: ['how big is the universe', 'size of the universe', 'is the universe infinite', 'observable universe'],
    keywords: [],
    answer:
      "The observable universe is about 93 billion light-years across — larger than 13.8 billion because space expanded while the light travelled. It holds an estimated two trillion galaxies. Whether the whole universe is finite or infinite is unknown; it may simply extend far beyond what we can ever see."
  },
  {
    id: 'galaxy-milky-way',
    phrases: ['what is a galaxy', 'the milky way', 'how many stars in the milky way', 'andromeda galaxy', 'types of galaxies'],
    keywords: ['galaxy', 'galaxies'],
    answer:
      "A galaxy is a gravitationally bound system of stars, gas, dust and dark matter. The Milky Way is a barred spiral roughly 100,000 light-years wide with 100–400 billion stars; the Sun sits about 26,000 light-years from the centre and laps it every ~230 million years. Galaxies come as spirals, ellipticals and irregulars, and our larger neighbour Andromeda will merge with the Milky Way in about 4.5 billion years."
  },
  {
    id: 'dark-matter-energy',
    phrases: ['what is dark matter', 'what is dark energy', 'why is the universe accelerating'],
    keywords: ['darkmatter', 'darkenergy'],
    answer:
      "Ordinary matter is only ~5% of the universe. Dark matter (~27%) neither emits nor absorbs light but its gravity holds galaxies together and shapes cosmic structure. Dark energy (~68%) acts the opposite way, a pressure driving the expansion of the universe to accelerate. Both are inferred from their effects; their nature is one of the biggest open problems in physics."
  },
  {
    id: 'exoplanets',
    phrases: ['what is an exoplanet', 'planets around other stars', 'habitable zone', 'goldilocks zone', 'are we alone', 'how do we find exoplanets'],
    keywords: ['exoplanet', 'exoplanets'],
    answer:
      "An exoplanet is a planet orbiting another star; over 5,800 are confirmed. Most are found by the transit method — a tiny periodic dip in starlight as the planet crosses its star (Kepler, TESS) — or by the star's gravitational wobble. The 'habitable zone' is the orbital band where a rocky planet could hold liquid surface water. JWST is now sampling exoplanet atmospheres for water and other biosignatures."
  },
  {
    id: 'distances',
    phrases: ['what is a light year', 'how far is a light year', 'astronomical unit', 'what is a parsec'],
    keywords: ['lightyear', 'parsec'],
    answer:
      "A light-year is the distance light travels in a year — about 9.46 trillion km. An astronomical unit (AU) is the Earth–Sun distance, ~150 million km, handy inside the solar system. A parsec is ~3.26 light-years, defined by stellar parallax. The nearest star beyond the Sun, Proxima Centauri, is 4.24 light-years away."
  },
  {
    id: 'speed-of-light-relativity',
    phrases: ['speed of light', 'can anything go faster than light', 'what is relativity', 'time dilation', 'why can nothing travel faster than light'],
    keywords: ['relativity'],
    answer:
      "Light travels at 299,792 km/s in vacuum, and special relativity makes this the universe's speed limit for matter and information: as you accelerate toward it, the energy required diverges to infinity. Relativity also predicts time dilation — clocks moving fast or sitting deep in gravity run slow — an effect GPS satellites correct for every day."
  },
  {
    id: 'gravity',
    phrases: ['what is gravity', 'how does gravity work', 'newton law of gravity', 'curved spacetime'],
    keywords: ['gravity'],
    answer:
      "Gravity is the mutual attraction between anything with mass or energy. Newton described it as a force that falls off with the square of distance — enough to fly spacecraft across the solar system. Einstein's general relativity goes deeper: mass and energy curve spacetime, and objects simply follow the straightest available path through that curved geometry, which we feel as gravity."
  },
  {
    id: 'wormhole',
    phrases: ['what is a wormhole', 'einstein rosen bridge', 'can we travel through a wormhole'],
    keywords: ['wormhole'],
    answer:
      "A wormhole is a hypothetical tunnel through spacetime linking two separated points, allowed as a solution of general relativity's equations. No wormhole has ever been observed, and any traversable one would need a form of 'exotic' negative-energy matter to hold it open. For now it is a theoretical curiosity, not a travel option."
  },

  // ---- rockets & missions ----
  {
    id: 'rockets',
    phrases: ['how do rockets work', 'rocket propulsion', 'newton third law', 'why do rockets work in space', 'rocket staging', 'multistage rocket'],
    keywords: ['rocket', 'thrust'],
    answer:
      "A rocket throws mass — hot exhaust gas — out of its nozzle at high speed, and by Newton's third law the equal and opposite reaction pushes the rocket the other way. It needs no air to push against, so it works in vacuum. Rockets 'stage' — dropping empty tanks and engines mid-flight — because hauling dead mass wastes the logarithmically precious delta-v the rocket equation demands."
  },
  {
    id: 'ion-propulsion',
    phrases: ['ion propulsion', 'ion drive', 'electric propulsion', 'hall thruster'],
    keywords: ['ion'],
    answer:
      "Ion engines electrically accelerate a stream of charged xenon atoms to 30–50 km/s — ten times a chemical rocket's exhaust speed — so they sip propellant. Thrust is tiny (the push of a sheet of paper), but running for months or years they build up huge delta-v, which is why missions like Dawn and DART's follow-ons use them for deep-space cruising."
  },
  {
    id: 'iss',
    phrases: ['international space station', 'what is the iss', 'how big is the iss', 'how fast does the iss orbit'],
    keywords: ['iss'],
    answer:
      "The International Space Station is a ~420-tonne laboratory the size of a football field, orbiting at ~420 km and circling Earth every 90 minutes at 28,000 km/h. Crews of about seven, rotating every six months, have kept it continuously occupied since November 2000. It periodically fires thrusters to counter drag and dodge debris."
  },
  {
    id: 'telescopes',
    phrases: ['hubble space telescope', 'james webb space telescope', 'jwst', 'why put a telescope in space', 'difference between hubble and webb'],
    keywords: ['hubble', 'webb', 'telescope'],
    answer:
      "Space telescopes escape the atmosphere's blur and absorption. Hubble (launched 1990, ~540 km orbit) works mainly in visible and ultraviolet light. JWST (2021) is an infrared observatory with a 6.5 m segmented mirror parked 1.5 million km away at the Sun–Earth L2 point, shielded and chilled so it can see the first galaxies and probe exoplanet atmospheres."
  },
  {
    id: 'apollo-artemis',
    phrases: ['apollo program', 'first man on the moon', 'artemis program', 'nasa going back to the moon', 'artemis 2', 'artemis 3'],
    keywords: ['apollo', 'artemis'],
    answer:
      "Apollo landed twelve astronauts on the Moon between 1969 and 1972, starting with Armstrong and Aldrin on Apollo 11. NASA's Artemis programme aims to return: Artemis I flew an uncrewed Orion around the Moon in 2022, Artemis II sends a crew on a lunar flyby, and Artemis III targets a crewed landing near the lunar south pole, where permanently shadowed craters hold water ice. This app has a dedicated Artemis II mission page."
  },
  {
    id: 'voyager',
    phrases: ['voyager probe', 'voyager 1', 'voyager 2', 'farthest spacecraft', 'interstellar space', 'golden record'],
    keywords: ['voyager'],
    answer:
      "Voyager 1 and 2 launched in 1977, toured the outer planets, and are now the most distant human-made objects — Voyager 1 over 24 billion km away, both in interstellar space beyond the Sun's bubble of plasma. Each carries a Golden Record of sounds and images of Earth. Their plutonium power is fading and most instruments will be off by the late 2020s."
  },
  {
    id: 'simulator-help',
    phrases: ['how does the simulator work', 'what does this app do', 'space traffic simulator', 'how do i use spaceverse'],
    keywords: [],
    answer:
      "Spaceverse lets you explore a 3D and VR solar system, take planet quizzes, play the arcade, track real missions, and run the Space Traffic Simulator. In the simulator you set a scenario — a launch, a break-up, a collision — with altitude, inclination, velocity and mass, and it estimates the change in orbital congestion, collision risk and debris, then scores your choices for safety, sustainability and efficiency."
  }
];

// Pre-tokenise once.
for (const e of ENTRIES) {
  e.phrases = (e.phrases || []).map((p) => p.toLowerCase());
  e.keywords = (e.keywords || []).map((k) => k.toLowerCase());
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'to', 'in', 'on', 'and', 'or',
  'what', 'why', 'how', 'do', 'does', 'did', 'me', 'my', 'i', 'you', 'it', 'that',
  'this', 'for', 'about', 'can', 'could', 'would', 'tell', 'explain', 'please', 'so',
  'with', 'from', 'be', 'as', 'at', 'by', 'we', 'us'
]);

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Best-matching answer for a free-text space question, or null if nothing in
 * the corpus is a confident match.
 * @param {string} question
 * @returns {string|null}
 */
function findAnswer(question) {
  const raw = String(question || '').toLowerCase();
  const tokens = tokenize(question);
  const contentTokens = tokens.filter((t) => !STOPWORDS.has(t));
  const tokenSet = new Set(tokens);
  const collapsed = raw.replace(/[^a-z0-9]/g, '');

  let best = null;
  let bestScore = 0;

  for (const entry of ENTRIES) {
    let score = 0;

    for (const phrase of entry.phrases) {
      if (raw.includes(phrase)) score += 3 + phrase.split(' ').length; // longer phrase = stronger signal
    }
    for (const kw of entry.keywords) {
      if (tokenSet.has(kw) || collapsed.includes(kw)) score += 2;
    }
    // Reward overlap between the question's content words and the entry id parts.
    for (const part of entry.id.split('-')) {
      if (part.length > 2 && contentTokens.includes(part)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  // Conversational entries are allowed to win on a low score; factual ones need
  // a clearer signal so we don't answer the wrong question confidently.
  const threshold = best && (best.id === 'greeting' || best.id === 'thanks') ? 2 : 3;
  return bestScore >= threshold ? best.answer : null;
}

const TOPIC_HINTS =
  "I can help with orbital mechanics and the Kessler syndrome, satellites and space debris, the planets and the Sun, the Moon, eclipses and seasons, stars, black holes and cosmology, and rockets and missions like Apollo, Artemis, Voyager, the ISS and JWST. Ask me one of those, or try the Space Traffic Simulator for a hands-on look at orbital congestion.";

/**
 * Always returns a useful string: a corpus answer when one matches, otherwise a
 * gentle prompt listing what the assistant knows.
 * @param {string} question
 */
function answerSpaceQuestion(question) {
  return findAnswer(question) || `That one is outside what I can answer offline. ${TOPIC_HINTS}`;
}

module.exports = { findAnswer, answerSpaceQuestion, TOPIC_HINTS, _entryCount: ENTRIES.length };
