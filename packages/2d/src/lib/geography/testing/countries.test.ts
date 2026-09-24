import {describe, expect, it} from 'vitest';
import {
  COUNTRY_NAMES,
  WORLD_BORDERS_110M,
  WORLD_COUNTRIES,
  WORLD_COUNTRIES_110M,
  countriesFeature,
  countryBordersFeature,
  countryFeature,
  countryGroupFeature,
} from '../public/countries';

describe('country geometry', () => {
  it('knows every country by its data name and ISO numeric id', () => {
    expect(COUNTRY_NAMES.length).toBeGreaterThan(200);
    expect(COUNTRY_NAMES.find(c => c.name === 'Nigeria')?.id).toBe('566');
    expect(countryFeature('Nigeria').geometry.type).toBe('Feature');
    expect(countryFeature('nigeria').id).toBe('country-Nigeria');
    expect(countryFeature('566').id).toBe('country-Nigeria');
  });

  it('refuses a name that is not in the data', () => {
    expect(() => countryFeature('Atlantis')).toThrow(
      /unknown country "Atlantis"/,
    );
  });

  it('merges a region into one outline and keeps a group as separate features', () => {
    const region = countriesFeature(
      ['Nigeria', 'Ghana', 'Benin', 'Togo'],
      'west',
    );
    expect(region.id).toBe('west');
    expect(['Polygon', 'MultiPolygon']).toContain(region.geometry.type);
    const group = countryGroupFeature(['Nigeria', 'Ghana']);
    expect(group.geometry.type).toBe('FeatureCollection');
    expect(group.geometry.features).toHaveLength(2);
  });

  it('draws internal borders only', () => {
    const all = countryBordersFeature();
    expect(all.geometry.type).toBe('MultiLineString');
    const some = countryBordersFeature(['Nigeria', 'Benin', 'Niger']);
    expect(some.geometry.coordinates.length).toBeGreaterThan(0);
    expect(some.geometry.coordinates.length).toBeLessThan(
      all.geometry.coordinates.length,
    );
  });

  it('has the whole world as separate countries', () => {
    expect(WORLD_COUNTRIES.geometry.features.length).toBe(COUNTRY_NAMES.length);
  });
});

describe('the 1:110m world', () => {
  it('has the major countries and their borders, at a fraction of the detail', () => {
    const coarse = WORLD_COUNTRIES_110M.geometry.features.length;
    expect(coarse).toBeGreaterThan(150);
    expect(WORLD_BORDERS_110M.geometry.type).toBe('MultiLineString');
    const points = (g: unknown) => JSON.stringify(g).split('],[').length;
    expect(points(WORLD_COUNTRIES_110M.geometry)).toBeLessThan(
      points(WORLD_COUNTRIES.geometry) / 3,
    );
  });
});
