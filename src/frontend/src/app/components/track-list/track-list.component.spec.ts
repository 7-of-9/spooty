import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { TrackListComponent } from './track-list.component';
import { TrackService } from '../../services/track.service';

describe('TrackListComponent', () => {
  let component: TrackListComponent;
  let fixture: ComponentFixture<TrackListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrackListComponent],
      providers: [
        {
          provide: TrackService,
          useValue: {
            getAllByPlaylist: () => of([]),
            delete: jasmine.createSpy('delete'),
            retry: jasmine.createSpy('retry'),
          },
        },
      ],
    })
      .compileComponents();

    fixture = TestBed.createComponent(TrackListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
