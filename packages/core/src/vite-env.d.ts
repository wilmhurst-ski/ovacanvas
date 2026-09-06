/// <reference types="vite/client" />

import 'vite/types/customEvent';

declare module 'vite/types/customEvent' {
  interface CustomEventMap {
    'ovacanvas:meta': {source: string; data: any};
    'ovacanvas:meta-ack': {source: string};
    'ovacanvas:export': {
      data: string;
      subDirectories: string[];
      mimeType: string;
      frame: number;
      name: string;
    };
    'ovacanvas:export-ack': {frame: number};
    'ovacanvas:assets': {urls: string[]};
  }
}
