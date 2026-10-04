import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LibraryService } from './library.service';

describe('LibraryService saved-file observation', () => {
  it('separates current observation, scan-ID polling and an explicit full recheck', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(LibraryService), http = TestBed.inject(HttpTestingController);
    const data = { playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } };
    service.fetch().subscribe(); http.expectOne('/api/library/view').flush(data);
    service.fetch('scan/one').subscribe(); http.expectOne('/api/library/view?scan=scan%2Fone').flush(data);
    service.fetch(undefined, true).subscribe(); http.expectOne('/api/library/view?refresh=1').flush(data);
    service.fetch('scan/one', true).subscribe(); http.expectOne('/api/library/view?scan=scan%2Fone').flush(data);
    http.verify();
  });
});
