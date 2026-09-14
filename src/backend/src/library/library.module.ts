import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { PlaylistModule } from '../playlist/playlist.module';
import { TrackModule } from '../track/track.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [ConfigModule, SharedModule, PlaylistModule, TrackModule],
  controllers: [LibraryController],
  providers: [LibraryService],
})
export class LibraryModule {}
