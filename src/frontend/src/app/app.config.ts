import {ApplicationConfig, importProvidersFrom, provideZoneChangeDetection} from '@angular/core';
import {provideHttpClient} from "@angular/common/http";
import {SocketIoModule} from "ngx-socket-io";

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(),
    importProvidersFrom(SocketIoModule.forRoot({url: ''}))
  ],
};
