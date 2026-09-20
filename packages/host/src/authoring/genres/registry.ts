import type {PresentationGenre} from './types';

/**
 * Registry of decoupled presentation genres.
 *
 * @remarks
 * Decoupled from subject domains: genres represent presentation structures
 * (step-by-step, timeline, comparison), while subject domains declare which
 * genre IDs they are compatible with. Selection is purely structural.
 */
export class GenreRegistry {
  private readonly genres = new Map<string, PresentationGenre>();

  public register(genre: PresentationGenre): void {
    if (this.genres.has(genre.id)) {
      throw new Error(
        `Presentation genre "${genre.id}" is already registered.`,
      );
    }
    this.genres.set(genre.id, genre);
  }

  /**
   * Select the first genre whose structure matches the candidate intent.
   *
   * @remarks
   * Returns null if no registered genre matches. Contains zero subject-domain
   * branches or string literals.
   */
  public selectGenre(intent: unknown): PresentationGenre | null {
    if (typeof intent !== 'object' || intent === null) return null;
    for (const genre of this.genres.values()) {
      if (genre.matchesStructure(intent)) {
        return genre;
      }
    }
    return null;
  }

  public get(id: string): PresentationGenre | undefined {
    return this.genres.get(id);
  }

  public all(): readonly PresentationGenre[] {
    return Array.from(this.genres.values());
  }

  public clear(): void {
    this.genres.clear();
  }
}

/** Global default registry instance for the host authoring pipeline. */
export const defaultGenreRegistry = new GenreRegistry();
