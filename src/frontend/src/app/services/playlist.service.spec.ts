import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Socket } from 'ngx-socket-io';

import { PlaylistService } from './playlist.service';

describe('PlaylistService', () => {
  let service: PlaylistService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: Socket, useValue: { on: jasmine.createSpy('on') } },
      ],
    });
    service = TestBed.inject(PlaylistService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
