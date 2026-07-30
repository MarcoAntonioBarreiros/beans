const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createBacillusBioprotectionSafety({ state, inoculants }) {
  function colonies() {
    return (inoculants.colonies || []).filter(colony => colony.type === 'bacillus');
  }

  function splitSharedFilms() {
    const owners = new Map();
    const films = state.level.biofilms || (state.level.biofilms = []);

    for (const colony of colonies()) {
      const entry = colony.bacillusState;
      const film = entry?.film || colony.linkedBiofilm;
      if (!film) continue;
      const owner = owners.get(film);
      if (!owner) {
        owners.set(film, colony.id);
        film.bacillusColonyId = colony.id;
        continue;
      }
      if (owner === colony.id) continue;

      const clone = {
        ...film,
        x: colony.x,
        y: colony.y,
        platform: colony.platform,
        radius: Math.min(film.radius || 18, 18),
        targetRadius: 28,
        growth: Math.min(film.growth || .08, .18),
        activated: false,
        bacillusManaged: true,
        bacillusColonyId: colony.id,
      };
      films.push(clone);
      colony.linkedBiofilm = clone;
      if (entry) entry.film = clone;
      owners.set(clone, colony.id);
    }
  }

  function constrainStressedFilms() {
    for (const colony of colonies()) {
      const entry = colony.bacillusState;
      const film = entry?.film || colony.linkedBiofilm;
      if (!entry || !film) continue;

      if (entry.mode === 'spores') {
        film.targetRadius = 0;
        film.radius = 0;
        film.growth = 0;
        film.functional = false;
        continue;
      }

      if (entry.mode !== 'sporulating' && colony.vigor > .08) continue;
      const base = 34 + entry.maturity * (48 + (colony.sourceCount || 1) * 6);
      const target = clamp(base * .18, 4, 24);
      film.targetRadius = target;
      film.radius = Math.min(film.radius || 0, target + 4);
      film.growth = Math.min(film.growth || 0, .28);
      film.functional = false;
    }
  }

  function update() {
    splitSharedFilms();
    constrainStressedFilms();
  }

  return { update };
}
