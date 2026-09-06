import {ValueDispatcher} from '../../events';
import type {Scene} from '../Scene';
import type {TimeEvent} from './TimeEvent';
import type {TimeEvents} from './TimeEvents';

/**
 * Manages time events during rendering and presentation.
 */
export class ReadOnlyTimeEvents implements TimeEvents {
  private disposed = false;
  private readonly disposeReload: () => void;

  public get onChanged() {
    return this.events.subscribable;
  }
  private readonly events = new ValueDispatcher<TimeEvent[]>([]);
  private lookup = new Map<string, number>();

  public constructor(private readonly scene: Scene) {
    this.disposeReload = scene.onReloaded.subscribe(this.handleReload);
  }

  /**
   * Release every subscription owned by this manager.
   *
   * @internal
   */
  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeReload();
    this.events.clear();
    this.lookup.clear();
  }

  public set() {
    // do nothing
  }

  public register(name: string, initialTime: number): number {
    let duration = this.lookup.get(name);
    if (duration === undefined) {
      const event = this.scene.meta.timeEvents
        .get()
        .find(event => event.name === name);
      duration = event ? event.targetTime - initialTime : 0;
      this.lookup.set(name, duration);
    }

    return duration;
  }

  /**
   * Called when the parent scene gets reloaded.
   */
  private handleReload = () => {
    this.lookup.clear();
  };
}
