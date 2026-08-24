import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage/storage.service";
import { StorageController } from "./storage/storage.controller";
import { AuthService } from "./auth/auth.service";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./common/auth.guard";
import { AccessService } from "./spaces/access.service";
import { SpacesService } from "./spaces/spaces.service";
import { SpacesController } from "./spaces/spaces.controller";
import { UploadsService } from "./uploads/uploads.service";
import { UploadsController } from "./uploads/uploads.controller";
import { MediaService } from "./media/media.service";
import { MediaController } from "./media/media.controller";
import { LibraryService } from "./library/library.service";
import { LibraryController } from "./library/library.controller";
import { SlideshowsService } from "./slideshows/slideshows.service";
import { SlideshowsController } from "./slideshows/slideshows.controller";
import { PresentationsService } from "./presentations/presentations.service";
import { PresentationsController } from "./presentations/presentations.controller";
import { SharesService } from "./shares/shares.service";
import { SharesController } from "./shares/shares.controller";
import { PublicController } from "./public/public.controller";
import { HealthController } from "./health.controller";

@Module({
  controllers: [
    HealthController,
    AuthController,
    SpacesController,
    UploadsController,
    MediaController,
    LibraryController,
    SlideshowsController,
    PresentationsController,
    SharesController,
    PublicController,
    StorageController,
  ],
  providers: [
    PrismaService,
    StorageService,
    AuthService,
    AuthGuard,
    AccessService,
    SpacesService,
    UploadsService,
    MediaService,
    LibraryService,
    SlideshowsService,
    PresentationsService,
    SharesService,
  ],
})
export class AppModule {}
