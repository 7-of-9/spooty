import {Component} from '@angular/core';
import {LibraryPanelComponent} from "./components/library-panel/library-panel.component";
import {VersionService} from "./services/version.service";
import {PlaylistService} from "./services/playlist.service";

@Component({
    selector: 'app-root',
    imports: [LibraryPanelComponent],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss',
    standalone: true,
})
export class AppComponent {
  version = this.versionService.getVersion();

  constructor(
    private readonly versionService: VersionService,
    private readonly playlistService: PlaylistService,
  ) {
    this.playlistService.fetch();
  }
}
