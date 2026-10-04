import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { PlaylistEntity } from '../playlist/playlist.entity';

export enum TrackStatusEnum {
  New,
  Searching,
  Queued,
  Downloading,
  Completed,
  Error,
  RetryWaiting,
}

@Entity()
export class TrackEntity {
  // Transient query context, populated from the shared exact-ID Spotify cache.
  searchAlbum?: string;
  @PrimaryGeneratedColumn()
  id?: number;

  @Column()
  artist: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  spotifyUrl: string;

  @Column({ type: 'varchar', nullable: true })
  audioFilename?: string | null;

  @Column({ type: 'integer', nullable: true })
  durationMs?: number | null;

  @Column({ type: 'varchar', nullable: true })
  acquisitionState?: 'no-candidate' | 'missing' | 'retry' | 'failed' | null;

  @Column({ type: 'bigint', nullable: true })
  retryAt?: number | null;

  @Column({ type: 'integer', default: 0 })
  searchLimit?: number;

  @Column({ type: 'integer', default: 10 })
  maxSearches?: number;

  @Column({ type: 'integer', default: 5 })
  networkRetryLimit?: number;

  @Column({ type: 'integer', default: 0 })
  networkAttempts?: number;

  @Column({ type: 'integer', default: 0 })
  operationAttempts?: number;

  @Column({ type: 'simple-json', nullable: true })
  youtubeCandidates?: Array<{
    url: string;
    videoId: string;
    durationSeconds: number | null;
    title: string;
    channel?: string;
    uploader?: string;
    identityAccepted?: boolean;
  }> | null;

  @Column({ type: 'simple-json', nullable: true })
  sourceEvidence?: any;

  @Column({ nullable: true })
  youtubeUrl?: string;

  @Column({ default: TrackStatusEnum.New })
  status?: TrackStatusEnum;

  @Column({ nullable: true })
  error?: string;

  @Column({ nullable: true })
  coverUrl?: string; // Track-specific album art (overrides playlist coverUrl)

  @Column({ default: Date.now() })
  createdAt?: number;

  @ManyToOne(() => PlaylistEntity, (playlist) => playlist.tracks, {
    onDelete: 'CASCADE',
  })
  playlist?: PlaylistEntity;
}
