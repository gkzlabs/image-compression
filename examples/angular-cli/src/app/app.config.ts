import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';

// Angular 22 is zoneless by default: no `provideZoneChangeDetection`, and no
// `zone.js` polyfill in angular.json. Signal-based state in AppComponent keeps
// change detection working without either.
export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners()],
};
