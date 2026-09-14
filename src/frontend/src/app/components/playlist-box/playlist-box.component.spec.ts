import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { PlaylistBoxComponent } from './playlist-box.component';
import {
  PlaylistService,
  PlaylistStatusEnum,
} from '../../services/playlist.service';

describe('PlaylistListComponent', () => {
  let component: PlaylistBoxComponent;
  let fixture: ComponentFixture<PlaylistBoxComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlaylistBoxComponent],
      providers: [
        {
          provide: PlaylistService,
          useValue: {
            getTrackCount: () => of(0),
            getCompletedTrackCount: () => of(0),
            getStatus$: () => of(PlaylistStatusEnum.Completed),
            toggleCollapsed: jasmine.createSpy('toggleCollapsed'),
            delete: jasmine.createSpy('delete'),
            retryFailed: jasmine.createSpy('retryFailed'),
            setActive: jasmine.createSpy('setActive'),
          },
        },
      ],
    })
      .compileComponents();

    fixture = TestBed.createComponent(PlaylistBoxComponent);
    component = fixture.componentInstance;
    component.playlist = {
      id: 1,
      name: 'Playlist',
      spotifyUrl: 'https://open.spotify.com/playlist/test',
      active: false,
      createdAt: 1,
      collapsed: false,
    };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
