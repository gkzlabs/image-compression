/**
 * Angular 17 standalone bootstrap for @GKz/image-compression example.
 * Minimal — no NgModule, no router, no providers beyond what's required.
 */
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent).catch((err) => console.error(err));