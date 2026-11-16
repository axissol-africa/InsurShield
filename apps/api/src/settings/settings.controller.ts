import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Needs } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { CreateRuleVersionDto, CreateTaxonomyItemDto, UpdateTaxonomyItemDto } from './dto/settings.dto.js';
import { SettingsService } from './settings.service.js';

/** Authoritative administration for all non-product platform rules and comparison vocabulary. */
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Needs('admin:rule:read')
  @Get('rules')
  rules(@CurrentUser() principal: Principal) { return this.settings.listRules(principal); }

  @Needs('admin:rule:read')
  @Get('rules/:key')
  ruleHistory(@Param('key') key: string, @CurrentUser() principal: Principal) { return this.settings.ruleHistory(key, principal); }

  @Needs('admin:rule:manage')
  @Post('rules/:key/versions')
  @HttpCode(HttpStatus.CREATED)
  createRule(@Param('key') key: string, @Body() dto: CreateRuleVersionDto, @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>) {
    return this.settings.addProvisional(key, dto, principal);
  }

  @Needs('admin:rule:confirm')
  @Post('rules/:key/versions/:versionId/confirm')
  confirmRule(@Param('key') key: string, @Param('versionId', ParseUUIDPipe) versionId: string, @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>) {
    return this.settings.confirm(key, versionId, principal);
  }

  @Needs('admin:taxonomy:read')
  @Get('comparison-taxonomy')
  taxonomy(@CurrentUser() principal: Principal) { return this.settings.listTaxonomy(principal); }

  @Needs('admin:taxonomy:manage')
  @Post('comparison-taxonomy')
  @HttpCode(HttpStatus.CREATED)
  createTaxonomy(@Body() dto: CreateTaxonomyItemDto, @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>) {
    return this.settings.createTaxonomy(dto, principal);
  }

  @Needs('admin:taxonomy:manage')
  @Patch('comparison-taxonomy/:id')
  updateTaxonomy(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaxonomyItemDto, @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>) {
    return this.settings.updateTaxonomy(id, dto, principal);
  }
}
