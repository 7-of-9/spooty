import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackEntity } from './track/track.entity';
import { TrackModule } from './track/track.module';
import { PlaylistModule } from './playlist/playlist.module';
import { PlaylistEntity } from './playlist/playlist.entity';
import { LibraryModule } from './library/library.module';
import { resolve } from 'path';
import { EnvironmentEnum } from './environmentEnum';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { SharedModule } from './shared/shared.module';
import { AcquisitionOwnerGuard } from './shared/acquisition-owner';

@Module({
  imports: [
    SharedModule,
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        type: 'sqlite',
        database: resolve(
          process.cwd(),
          configService.get<string>(EnvironmentEnum.DB_PATH) ||
            '../../data/spooty.sqlite',
        ),
        entities: [TrackEntity, PlaylistEntity],
        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => [
        {
          rootPath: resolve(
            __dirname,
            configService.get<string>(EnvironmentEnum.FE_PATH),
          ),
          exclude: ['/api/(.*)'],
        },
      ],
      inject: [ConfigService],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        defaultJobOptions: {
          removeOnComplete: true,
        },
        connection: {
          host: configService.get<string>(EnvironmentEnum.REDIS_HOST),
          port: configService.get<number>(EnvironmentEnum.REDIS_PORT),
          // Bound Bull's blocking marker wait even if Redis disconnects while
          // reconnecting (ioredis.disconnect may have no new close event to
          // settle that command). Finite waits keep their server timeout +
          // grace; 10s is the fallback for an indefinite/offline blocking wait.
          // This is NOT commandTimeout: active jobs and their completion writes
          // still drain normally, with no deadline that aborts acquisition.
          blockingTimeout: 10000,
          blockingTimeoutGrace: 500,
        },
      }),
      inject: [ConfigService],
    }),
    TrackModule,
    PlaylistModule,
    LibraryModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: AcquisitionOwnerGuard }],
})
export class AppModule {}
