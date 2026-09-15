import { Controller, Get, Module, Param } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

@Controller('i18n')
class I18nController {
  @Get(':locale')
  locale(@Param('locale') locale: string) {
    const root = join(process.cwd(), '..', '..', 'packages', 'i18n', 'locales');
    const file = join(root, `${locale}.json`);
    const fallback = join(root, 'en.json');
    const path = existsSync(file) ? file : fallback;
    const pack = JSON.parse(readFileSync(path, 'utf8'));
    return { locale, version: pack.version ?? '0.1.0', messages: pack.messages ?? pack };
  }
}

@Module({ controllers: [I18nController] })
export class I18nModule {}
